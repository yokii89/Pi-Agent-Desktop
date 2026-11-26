import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSnapshot, loadSnapshot, projectJobRecord, saveSnapshot, trimTail } from "../state/persist.ts";
import type { JobRecord } from "../types.ts";

const dirs: string[] = [];

function env(): NodeJS.ProcessEnv {
	const dir = mkdtempSync(join(tmpdir(), "bash-jobs-"));
	dirs.push(dir);
	return { ...process.env, PI_CODING_AGENT_DIR: dir } as NodeJS.ProcessEnv;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function record(overrides: Partial<JobRecord> = {}): JobRecord {
	return {
		id: "J-1",
		command: "pnpm dev",
		mode: "detach",
		status: "running",
		reason: "vite",
		startedAt: 1_000,
		lastOutputAt: 1_000,
		detached: true,
		outputBytes: 10,
		outputLines: 2,
		...overrides,
	};
}

describe("snapshot round trip", () => {
	it("writes and reads jobs back with their tails", () => {
		const environment = env();
		const file = buildSnapshot("sess-1", [{ record: record(), tail: "ready on 5173" }], 5_000);
		expect(saveSnapshot(file, environment)).toBe(true);
		const loaded = loadSnapshot("sess-1", { now: 10_000, env: environment });
		expect(loaded).toHaveLength(1);
		expect(loaded[0]?.record.command).toBe("pnpm dev");
		expect(loaded[0]?.tail).toBe("ready on 5173");
	});

	it("returns nothing for a session with no snapshot", () => {
		expect(loadSnapshot("missing", { env: env() })).toEqual([]);
	});

	it("ignores a corrupt file instead of throwing", () => {
		const environment = env();
		saveSnapshot(buildSnapshot("broken", [], 0), environment);
		const path = join(environment.PI_CODING_AGENT_DIR as string, "bash-jobs", "broken.json");
		writeFileSync(path, "{not json", "utf8");
		expect(loadSnapshot("broken", { env: environment })).toEqual([]);
	});

	it("ignores a snapshot from another version", () => {
		const environment = env();
		saveSnapshot({ ...buildSnapshot("old", [{ record: record(), tail: "" }], 0), version: 99 }, environment);
		expect(loadSnapshot("old", { env: environment })).toEqual([]);
	});

	it("drops jobs older than the orphan TTL", () => {
		const environment = env();
		const hour = 60 * 60 * 1000;
		saveSnapshot(
			buildSnapshot(
				"ttl",
				[
					{ record: record({ id: "J-1", startedAt: 0 }), tail: "" },
					{ record: record({ id: "J-2", startedAt: 47 * hour }), tail: "" },
				],
				48 * hour,
			),
			environment,
		);
		const loaded = loadSnapshot("ttl", { now: 48 * hour, orphanTtlHours: 24, env: environment });
		expect(loaded.map((entry) => entry.record.id)).toEqual(["J-2"]);
	});

	it("caps the number of persisted jobs, newest first", () => {
		const jobs = Array.from({ length: 30 }, (_, index) => ({
			record: record({ id: `J-${index + 1}`, startedAt: index }),
			tail: "",
		}));
		const file = buildSnapshot("many", jobs, 0);
		expect(file.jobs).toHaveLength(20);
		expect(file.jobs[0]?.record.id).toBe("J-30");
	});

	it("reserves the watchers field for doc 132 and never writes garbage there", () => {
		const file = buildSnapshot("watch", [], 0);
		expect(file.watchers).toEqual([]);
	});
});

describe("trimTail", () => {
	it("keeps the last 200 lines", () => {
		const tail = Array.from({ length: 250 }, (_, index) => `line ${index}`).join("\n");
		const trimmed = trimTail(tail).split("\n");
		expect(trimmed).toHaveLength(200);
		expect(trimmed[199]).toBe("line 249");
	});

	it("leaves a short tail untouched", () => {
		expect(trimTail("a\nb")).toBe("a\nb");
	});
});

describe("projectJobRecord", () => {
	it("records a kill we issued as killed, not as running", () => {
		// Session shutdown kills and then snapshots in the same tick, so the exit is never observed.
		// Writing "running" would make the next session present a dead process as an orphan.
		expect(projectJobRecord(record({ killedBy: "user" }))).toMatchObject({ status: "killed", killedBy: "user" });
	});

	it("leaves everything else alone", () => {
		const running = record();
		expect(projectJobRecord(running)).toBe(running);
		const exited = record({ status: "exited", exitCode: 0 });
		expect(projectJobRecord(exited)).toBe(exited);
	});

	it("buildSnapshot applies the projection", () => {
		const file = buildSnapshot("sess-1", [{ record: record({ killedBy: "user" }), tail: "" }], 5_000);
		expect(file.jobs[0]?.record.status).toBe("killed");
	});
});
