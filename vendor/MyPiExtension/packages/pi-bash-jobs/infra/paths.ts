/**
 * On-disk locations. Kept apart from `persist.ts` so config loading does not depend on the
 * snapshot module (and tests can point both at a temp dir through HOME/USERPROFILE).
 */

import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Pi's agent directory — the same resolution pi itself uses: `PI_CODING_AGENT_DIR` wins,
 * otherwise `~/.pi/agent`. Snapshots and the settings file both live here, so they follow
 * the agent dir when a user relocates it.
 */
export function agentDir(env: NodeJS.ProcessEnv = process.env): string {
	const configured = env.PI_CODING_AGENT_DIR?.trim();
	if (configured) return configured;
	// `getAgentDir()` reads the same env var and resolves `~`; using it keeps this extension in
	// the same directory as pi's own settings/models when a user relocates the agent dir.
	return getAgentDir();
}

/** `~/.pi/agent/bash-jobs.json` — the settings file a user may edit by hand. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
	return join(agentDir(env), "bash-jobs.json");
}

/** `~/.pi/agent/bash-jobs/<sessionId>.json` — one snapshot per session (doc 129 §7.1). */
export function snapshotDir(env: NodeJS.ProcessEnv = process.env): string {
	return join(agentDir(env), "bash-jobs");
}

export function snapshotPath(sessionId: string, env: NodeJS.ProcessEnv = process.env): string {
	return join(snapshotDir(env), `${sessionId}.json`);
}

/**
 * `<agentDir>/bash-jobs/logs/<sessionId>/` — per-job tee logs (方案 B). The desktop host derives
 * the same path by convention (agentDir + snapshot filename + job id), so the on-disk layout is
 * a contract: do not move it without updating PiDesk's job log resolver.
 */
export function jobLogDir(sessionId: string, env: NodeJS.ProcessEnv = process.env): string {
	return join(snapshotDir(env), "logs", sessionId);
}

export function jobLogPath(sessionId: string, jobId: string, env: NodeJS.ProcessEnv = process.env): string {
	return join(jobLogDir(sessionId, env), `${jobId}.log`);
}
