/**
 * Settings. Every threshold in docs/design/129 §5.3 is a knob here; the defaults are the
 * conservative ones the doc argues for, and the direction of every clamp is "worse for
 * throughput, better for not breaking the user's machine".
 *
 * The file is optional: a missing or malformed `bash-jobs.json` falls back to defaults
 * instead of failing the extension load. A broken settings file must never take bash down.
 */

import { readFileSync } from "node:fs";
import { configPath } from "../infra/paths.ts";

export type WakeMode = "followUp" | "steer" | "off";

export interface OutputLimits {
	/** Bytes kept per job (doc 129 §5.3: 262144). */
	maxBytes: number;
	/** Lines kept per job (doc 129 §5.3: 4000). */
	maxLines: number;
	/**
	 * Tee committed lines (ANSI-stripped) to `<agentDir>/bash-jobs/logs/<sessionId>/<jobId>.log`
	 * so the desktop host can follow a job's stdout. On by default; disk is bounded per file.
	 */
	tee: boolean;
	/** Hard cap per tee log file; past it the tee stops writing and marks the truncation. */
	teeMaxBytes: number;
}

export interface BashJobsConfig {
	/**
	 * Escape valve (doc 129 D1). `false` leaves the built-in bash untouched and registers
	 * only `tool_execution_inspect_output` / `bash_job_stop`, which then report "no jobs".
	 */
	replaceBuiltinBash: boolean;
	/** Soft budget for a blocking `finish` call; at this point the call yields, the process keeps running. */
	finishSoftBudgetSec: number;
	/**
	 * How long `mode:long` still blocks before it really becomes a background job (doc 06 §7).
	 * `0` restores the old "return immediately" behaviour for every long call.
	 */
	longGraceSec: number;
	/** Silence long enough to warn once (no interruption). */
	idleWarnSec: number;
	/** Silence long enough to yield to the background. Never kills. */
	idleDetachSec: number;
	/** When the caller passed an explicit `timeout`, does it kill (pi's native semantics) or yield? */
	explicitTimeoutKills: boolean;
	/** How a finished background job wakes the model. */
	wakeOnExit: WakeMode;
	/** Keep job processes alive when the pi session ends (D3: "don't close the project I started"). */
	keepOnSessionEnd: boolean;
	/** How long an orphaned job stays visible after a restart. */
	orphanTtlHours: number;
	/** Coalescing window shared with doc 132's event watches; one wake queue, one window. */
	wakeCoalesceMs: number;
	/** Upper bound on wake messages per hour per session — a fountain guard, not a budget. */
	maxWakePerHour: number;
	/** Default `tailLines` for the inspect tool. */
	inspectTailLines: number;
	/** Hard cap on `tailLines` regardless of what the model asks for. */
	inspectMaxTailLines: number;
	/** Hard cap on the inspect tool's long-poll `waitMs`. */
	inspectWaitMaxMs: number;
	/**
	 * Caps on the text handed back to the model for one call. pi's own bash trims at 50KB/2000 lines
	 * and writes the rest to a file; the ring (`output`) deliberately holds more than the model reads.
	 */
	resultMaxBytes: number;
	resultMaxLines: number;
	/** Extra command patterns, `mode=detach` (doc 129 §5.2 — the default set is not a closed list). */
	extraDetachPatterns: string[];
	/** Extra command patterns, `mode=long`. */
	extraLongPatterns: string[];
	output: OutputLimits;
}

export const DEFAULT_CONFIG: BashJobsConfig = {
	replaceBuiltinBash: true,
	finishSoftBudgetSec: 600,
	longGraceSec: 180,
	idleWarnSec: 300,
	idleDetachSec: 420,
	explicitTimeoutKills: true,
	wakeOnExit: "followUp",
	keepOnSessionEnd: true,
	orphanTtlHours: 24,
	wakeCoalesceMs: 5_000,
	maxWakePerHour: 24,
	inspectTailLines: 80,
	inspectMaxTailLines: 1_000,
	inspectWaitMaxMs: 120_000,
	resultMaxBytes: 51_200,
	resultMaxLines: 2_000,
	extraDetachPatterns: [],
	extraLongPatterns: [],
	output: { maxBytes: 262_144, maxLines: 4_000, tee: true, teeMaxBytes: 8_388_608 },
};

/** Smallest accepted values: below these the extension would spin instead of waiting. */
const FLOOR = {
	finishSoftBudgetSec: 5,
	longGraceSec: 0,
	idleWarnSec: 5,
	idleDetachSec: 5,
	orphanTtlHours: 1,
	wakeCoalesceMs: 0,
	maxWakePerHour: 1,
	inspectTailLines: 1,
	inspectMaxTailLines: 1,
	inspectWaitMaxMs: 0,
	maxBytes: 4_096,
	maxLines: 32,
	teeMaxBytes: 4_096,
} as const;

function positiveNumber(value: unknown, fallback: number, floor: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(floor, Math.floor(value));
}

function stringArray(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return fallback;
	const kept = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
	return kept.length > 0 ? kept : fallback;
}

/**
 * Extra command patterns. A settings file is hand-edited, so an expression that does not compile is
 * dropped here instead of throwing inside `classifyCommand` on every later bash call.
 */
function patternList(value: unknown, fallback: string[]): string[] {
	return stringArray(value, fallback).filter((pattern) => {
		try {
			new RegExp(pattern, "i");
			return true;
		} catch {
			return false;
		}
	});
}

function wakeMode(value: unknown, fallback: WakeMode): WakeMode {
	return value === "followUp" || value === "steer" || value === "off" ? value : fallback;
}

/**
 * Merge a parsed settings object over the defaults.
 *
 * `idleDetachSec < finishSoftBudgetSec` is the doc's own invariant ("先到者"), and the
 * policy takes the earlier of the two, so no cross-field rewriting is needed here — the
 * values are kept exactly as configured and the state machine decides.
 */
export function normalizeConfig(raw: unknown): BashJobsConfig {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...DEFAULT_CONFIG };
	const input = raw as Record<string, unknown>;
	const output = (typeof input.output === "object" && input.output !== null ? input.output : {}) as Record<
		string,
		unknown
	>;
	const config: BashJobsConfig = {
		replaceBuiltinBash:
			typeof input.replaceBuiltinBash === "boolean" ? input.replaceBuiltinBash : DEFAULT_CONFIG.replaceBuiltinBash,
		finishSoftBudgetSec: positiveNumber(
			input.finishSoftBudgetSec,
			DEFAULT_CONFIG.finishSoftBudgetSec,
			FLOOR.finishSoftBudgetSec,
		),
		// `0` is meaningful here (detach immediately), so the floor is 0 rather than a "spin-safe" 5s.
		longGraceSec: positiveNumber(input.longGraceSec, DEFAULT_CONFIG.longGraceSec, FLOOR.longGraceSec),
		idleWarnSec: positiveNumber(input.idleWarnSec, DEFAULT_CONFIG.idleWarnSec, FLOOR.idleWarnSec),
		idleDetachSec: positiveNumber(input.idleDetachSec, DEFAULT_CONFIG.idleDetachSec, FLOOR.idleDetachSec),
		explicitTimeoutKills:
			typeof input.explicitTimeoutKills === "boolean"
				? input.explicitTimeoutKills
				: DEFAULT_CONFIG.explicitTimeoutKills,
		wakeOnExit: wakeMode(input.wakeOnExit, DEFAULT_CONFIG.wakeOnExit),
		keepOnSessionEnd:
			typeof input.keepOnSessionEnd === "boolean" ? input.keepOnSessionEnd : DEFAULT_CONFIG.keepOnSessionEnd,
		orphanTtlHours: positiveNumber(input.orphanTtlHours, DEFAULT_CONFIG.orphanTtlHours, FLOOR.orphanTtlHours),
		wakeCoalesceMs: positiveNumber(input.wakeCoalesceMs, DEFAULT_CONFIG.wakeCoalesceMs, FLOOR.wakeCoalesceMs),
		maxWakePerHour: positiveNumber(input.maxWakePerHour, DEFAULT_CONFIG.maxWakePerHour, FLOOR.maxWakePerHour),
		inspectTailLines: positiveNumber(input.inspectTailLines, DEFAULT_CONFIG.inspectTailLines, FLOOR.inspectTailLines),
		inspectMaxTailLines: positiveNumber(
			input.inspectMaxTailLines,
			DEFAULT_CONFIG.inspectMaxTailLines,
			FLOOR.inspectMaxTailLines,
		),
		inspectWaitMaxMs: positiveNumber(input.inspectWaitMaxMs, DEFAULT_CONFIG.inspectWaitMaxMs, FLOOR.inspectWaitMaxMs),
		resultMaxBytes: positiveNumber(input.resultMaxBytes, DEFAULT_CONFIG.resultMaxBytes, FLOOR.maxBytes),
		resultMaxLines: positiveNumber(input.resultMaxLines, DEFAULT_CONFIG.resultMaxLines, FLOOR.maxLines),
		extraDetachPatterns: patternList(input.extraDetachPatterns, DEFAULT_CONFIG.extraDetachPatterns),
		extraLongPatterns: patternList(input.extraLongPatterns, DEFAULT_CONFIG.extraLongPatterns),
		output: {
			maxBytes: positiveNumber(output.maxBytes, DEFAULT_CONFIG.output.maxBytes, FLOOR.maxBytes),
			maxLines: positiveNumber(output.maxLines, DEFAULT_CONFIG.output.maxLines, FLOOR.maxLines),
			tee: typeof output.tee === "boolean" ? output.tee : DEFAULT_CONFIG.output.tee,
			teeMaxBytes: positiveNumber(output.teeMaxBytes, DEFAULT_CONFIG.output.teeMaxBytes, FLOOR.teeMaxBytes),
		},
	};
	// A tail larger than the max makes the "clamped" message a lie, so keep them ordered.
	config.inspectMaxTailLines = Math.max(config.inspectMaxTailLines, config.inspectTailLines);
	return config;
}

/** Read `bash-jobs.json` if it exists. Never throws: a bad file means "use the defaults". */
export function loadConfig(path: string = configPath()): BashJobsConfig {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return { ...DEFAULT_CONFIG, output: { ...DEFAULT_CONFIG.output } };
	}
	try {
		return normalizeConfig(JSON.parse(text));
	} catch {
		return { ...DEFAULT_CONFIG, output: { ...DEFAULT_CONFIG.output } };
	}
}
