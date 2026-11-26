import { configPath, loadJsonConfigWithLegacyFallback, saveJsonConfig } from "@yoki/yoki-config";

export const CONFIG_PATH = configPath("yoki-warp-notify");

export interface YokiWarpConfig {
	/** Master switch — `false` silences every emission without uninstalling.
	 *  Read fresh on each emit so `/warp-notify on|off` takes effect live. */
	readonly enabled?: boolean;
	readonly blockingTools?: readonly string[];
	readonly heartbeatMs?: number;
}

export const DEFAULT_BLOCKING_TOOLS: readonly string[] = ["ask_user_question"];
export const DEFAULT_HEARTBEAT_MS = 15000;

export function loadConfig(): YokiWarpConfig {
	return loadJsonConfigWithLegacyFallback<YokiWarpConfig>("yoki-warp-notify");
}

/** Notifications default ON — a trial user should never have to configure
 *  anything to see the first notification. Only an explicit `false` disables. */
export function isEnabled(): boolean {
	return loadConfig().enabled !== false;
}

/** Persist the master switch (merging into the existing config object) so
 *  `/warp-notify on|off` survives restarts. Best-effort, mirrors saveJsonConfig. */
export function setEnabled(enabled: boolean): boolean {
	return saveJsonConfig(CONFIG_PATH, { ...loadConfig(), enabled });
}

export function getHeartbeatMs(): number {
	const config = loadConfig();
	const ms = config.heartbeatMs;
	if (ms === 0) return 0; // explicitly disabled
	if (typeof ms !== "number" || ms <= 0) return DEFAULT_HEARTBEAT_MS;
	return ms;
}

export function getBlockingTools(): ReadonlySet<string> {
	const config = loadConfig();
	const list = Array.isArray(config.blockingTools) ? config.blockingTools : DEFAULT_BLOCKING_TOOLS;
	const filtered = list.filter((s): s is string => typeof s === "string" && s.length > 0);
	return new Set(filtered);
}
