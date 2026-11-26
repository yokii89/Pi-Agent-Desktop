/**
 * pi-bash-jobs — bash gains a third state: background job.
 *
 * The problem this solves (docs/design/129 in PiDesk): pi's bash has two outcomes, "blocked until
 * exit" and "killed by timeout". A dev server or a 15-hour download is neither. This extension
 * replaces the bash tool so a call can **yield** — the process keeps running, the model gets a
 * job id, and `tool_execution_inspect_output` / `bash_job_stop` become the way to follow or end
 * it. Killing only ever happens on two explicit paths: a caller-supplied `timeout`, or a person
 * / the model asking for it.
 *
 * Wiring rules that must stay true (doc 129 §7.2, §8):
 *  - `onUpdate` keeps streaming `tool_execution_update` events, so PiDesk's tool row renders
 *    output exactly as before — no new IPC, no protocol change;
 *  - wakes go through one queue (`wake.ts`) and carry `customType: "bash-job"`;
 *  - the job registry is the only source of truth; nothing here re-derives job state.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatJobExitNotice, formatJobList } from "./core/format.ts";
import { createJobRegistry } from "./core/jobs.ts";
import { createWakeQueue } from "./core/wake.ts";
import { jobLogDir } from "./infra/paths.ts";
import { createRingBuffer } from "./infra/ring.ts";
import { isProcessAlive } from "./infra/shell.ts";
import { createJobLogTee, type JobLogTee } from "./infra/tee.ts";
import { loadConfig } from "./state/config.ts";
import { buildSnapshot, loadSnapshot, saveSnapshot } from "./state/persist.ts";
import { createBashJobsTool } from "./tools/bashTool.ts";
import { createInspectTool } from "./tools/inspectTool.ts";
import { createStopTool } from "./tools/stopTool.ts";

/** How many lines of a job's tail a snapshot keeps for orphan display after a restart. */
const SNAPSHOT_TAIL_LINES = 200;
/** Persist writes are debounced: a chatty job must not write a file per line. */
const PERSIST_DEBOUNCE_MS = 500;

export default function bashJobsExtension(pi: ExtensionAPI): void {
	const config = loadConfig();
	const registry = createJobRegistry();
	/** Jobs the model stopped itself: the tool result already says so, no wake needed. */
	const stopNotified = new Set<string>();
	/** Current session id, if any. Used to track the current session's jobs. */
	let sessionId: string | undefined;
	let currentContext: ExtensionContext | undefined;
	/** Debounced snapshot timer.（PERSIST_DEBOUNCE_MS）*/
	let persistTimer: NodeJS.Timeout | undefined;
	/** Per-session job log tee (方案 B): recreated per session, flushed on settle/shutdown. */
	let tee: JobLogTee | undefined;

	const snapshotNow = () => {
		if (!sessionId) return;
		// Settled jobs age out here rather than on a timer of their own: the snapshot is the only
		// place TTL matters, and a background sweep would keep the process awake for nothing.
		registry.prune(config.orphanTtlHours * 60 * 60 * 1000);
		const jobs = registry.list().map((job) => ({
			record: job.snapshot(),
			tail: job.ring.tail(SNAPSHOT_TAIL_LINES),
		}));
		saveSnapshot(buildSnapshot(sessionId, jobs, Date.now()));
	};
	const schedulePersist = () => {
		if (persistTimer || !sessionId) return;
		persistTimer = setTimeout(() => {
			persistTimer = undefined;
			snapshotNow();
		}, PERSIST_DEBOUNCE_MS);
		// A pending snapshot must not keep pi alive on its own.
		persistTimer.unref?.();
	};

	// One wake queue for every path that wants the model's attention (seam #2 of doc 132 §10).
	// It is recreated per session because `dispose()` is final — a queue that outlived a session
	// shutdown would silently swallow every later wake.
	const createSessionWakeQueue = () =>
		createWakeQueue({
			coalesceMs: config.wakeCoalesceMs,
			maxPerHour: config.maxWakePerHour,
			send: (text) => {
				pi.sendMessage(
					{
						customType: "bash-job",
						content: [{ type: "text", text }],
						display: true,
						details: { kind: "bash-job" },
					},
					{ triggerTurn: true, deliverAs: config.wakeOnExit === "steer" ? "steer" : "followUp" },
				);
			},
		});
	let wake = createSessionWakeQueue();

	registry.onEvent((event) => {
		if (event.type !== "settled") {
			if (event.type === "started") schedulePersist();
			return;
		}
		schedulePersist();
		// A settled job's log must be complete on disk even if the flush debounce is pending:
		// the desktop host stops tailing (and shows the log) as soon as it sees the exit.
		tee?.flushAll();
		// Only a job that outlived its turn needs a wake: a blocking call already returned its
		// result, and telling the model "your command finished" twice is pure noise.
		if (!event.job.detached) return;
		if (config.wakeOnExit === "off") return;
		if (stopNotified.delete(event.job.id)) return;
		const job = registry.get(event.job.id);
		const tail = job ? job.ring.tail(20) : "";
		wake.enqueue({ key: `job:${event.job.id}`, text: formatJobExitNotice(event.job, tail) });
	});

	/** 新会话开始的事件处理函数，是扩展中状态切换最复杂的部分。它要做的事很多：因为一个会话结束后，后台作业的进程可能还活着，而新的会话可能要用到它们。*/
	pi.on("session_start", (_event, ctx) => {
		currentContext = ctx;
		wake.dispose(); // Drop the old wake queue.
		wake = createSessionWakeQueue(); // Create a new one.
		// The old tee belongs to the old session's directory; flush and drop it before the id flips.
		tee?.dispose();
		tee = undefined;
		const nextSessionId = ctx.sessionManager.getSessionId();
		if (sessionId !== undefined && sessionId !== nextSessionId) {
			// Write the previous session's snapshot, but do **not** clear the jobs: their processes
			// are still ours, and killing them on `/new` would close a dev server the user was told
			// would stay up. They stay inspectable in the new session instead of becoming invisible
			// background processes nobody owns.
			snapshotNow(); // Write the previous session's snapshot.
		}
		sessionId = nextSessionId;
		tee = config.output.tee
			? createJobLogTee({ dir: jobLogDir(sessionId), maxBytes: config.output.teeMaxBytes })
			: undefined;
		/**尝试恢复孤儿作业 */
		// 如果注册表里还有作业就说明扩展还存活，作业都还在内存，无需从磁盘读。只有注册表为空时才才需要从磁盘读。
		if (registry.list().length > 0) return;
		const restored = loadSnapshot(sessionId, { orphanTtlHours: config.orphanTtlHours });
		if (restored.length === 0) return;
		const entries = restored.map((entry) => {
			const ring = createRingBuffer(config.output);
			if (entry.tail) ring.append(entry.tail);
			return { record: entry.record, ring };
		});
		registry.restore(entries);
		// Orphans are read-only by contract: we cannot observe their exit any more, so say so
		// instead of pretending the job is still ours (doc 129 §7.4 / doc 104 F2). A pid that is
		// still alive is worth naming separately — "the dev server from last time is still up".
		const orphans = entries.filter((entry) => entry.record.status === "running");
		if (currentContext && orphans.length > 0) {
			const alive = orphans.filter((entry) => isProcessAlive(entry.record.pid)).length;
			const aliveNote =
				alive > 0 ? ` ${alive} of them still have a live process; exit and output are no longer observable.` : "";
			currentContext.ui.notify(
				`${orphans.length} bash job(s) restored from a previous run as orphaned.${aliveNote}`,
				"info",
			);
		}
	});

	pi.on("session_shutdown", () => {
		if (persistTimer) clearTimeout(persistTimer);
		persistTimer = undefined;
		// Kill *before* snapshotting: `registry.kill` marks `killedBy` synchronously, and
		// `buildSnapshot` turns a kill-pending record into `killed`. Snapshotting first would file
		// these jobs as "running", and the next session would present a dead process as an orphan.
		if (!config.keepOnSessionEnd) {
			for (const job of registry.list()) {
				if (job.status === "running") registry.kill(job.id, "user");
			}
		}
		snapshotNow();
		wake.dispose();
		tee?.dispose();
		tee = undefined;
	});

	if (config.replaceBuiltinBash) {
		pi.registerTool(createBashJobsTool({ config, registry, tee: () => tee }));
	}
	pi.registerTool(createInspectTool({ registry, config }));
	pi.registerTool(
		createStopTool({
			registry,
			onModelStopped: (jobId) => stopNotified.add(jobId),
		}),
	);

	pi.registerCommand("bash-jobs", {
		description: "List bash jobs in this session (running / exited / orphaned)",
		handler: async (_args, ctx) => {
			const jobs = registry.list().map((job) => job.snapshot());
			ctx.ui.notify(formatJobList(jobs, Date.now()), "info");
		},
	});
}
