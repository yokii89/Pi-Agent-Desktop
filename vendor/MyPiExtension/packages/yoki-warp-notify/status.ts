/**
 * yoki-warp-notify — User-facing diagnostics for the `/warp-notify` command.
 *
 * Trial-experience backbone: the extension is silent-by-design outside Warp
 * (and on Warp builds that cannot render notifications), which left users
 * guessing why "nothing happens". readStatus() assembles the facts from
 * protocol.ts (env vars) and config.ts; formatStatus() renders them with a
 * concrete next-action hint whenever notifications are not active.
 *
 * Pure presentation — the only I/O is the env/config reads those modules
 * already perform on every call.
 */

import { CONFIG_PATH, getBlockingTools, getHeartbeatMs, isEnabled } from "./config.ts";
import {
	BROKEN_VERSIONS,
	type Channel,
	detectWarpEnvironment,
	isBrokenVersion,
	negotiateProtocolVersion,
	parseWarpVersion,
	readClientVersion,
} from "./protocol.ts";

export interface WarpNotifyStatus {
	readonly inWarp: boolean;
	readonly supportsStructured: boolean;
	readonly disabledByConfig: boolean;
	readonly active: boolean;
	readonly termProgram: string | undefined;
	readonly clientVersion: string | undefined;
	readonly channel: Channel | undefined;
	readonly protocolEnv: string | undefined;
	readonly negotiatedVersion: number;
	readonly versionGated: boolean;
	/** Present only when notifications are NOT active — why. */
	readonly reason: string | undefined;
	/** Present only when notifications are NOT active — what to do next. */
	readonly hint: string | undefined;
	readonly heartbeatMs: number;
	readonly blockingTools: readonly string[];
	readonly configPath: string;
}

function formatVersionTuple(tuple: readonly number[]): string {
	return tuple.join(".");
}

export function readStatus(): WarpNotifyStatus {
	const warp = detectWarpEnvironment();
	const enabled = isEnabled();
	const protocolEnv = process.env.WARP_CLI_AGENT_PROTOCOL_VERSION;
	const clientVersion = readClientVersion();
	const parsed = parseWarpVersion(clientVersion);
	const versionGated = warp.isWarp && isBrokenVersion(parsed);

	let reason: string | undefined;
	let hint: string | undefined;
	if (!warp.isWarp) {
		reason = "not running inside the Warp terminal";
		hint = "Notifications are a Warp feature — start Pi from a Warp tab (TERM_PROGRAM=WarpTerminal).";
	} else if (!enabled) {
		reason = "disabled in config (enabled: false)";
		hint = 'Run /warp-notify on, or set "enabled": true in the config file.';
	} else if (!warp.supportsStructured && protocolEnv === undefined) {
		reason = "Warp did not advertise the structured cli-agent protocol";
		hint = "This Warp build predates CLI-agent notifications — update Warp and restart Pi.";
	} else if (!warp.supportsStructured) {
		const build = `${clientVersion ?? "unknown"}${parsed ? ` (${parsed.channel})` : ""}`;
		const threshold = parsed ? BROKEN_VERSIONS[parsed.channel] : null;
		reason = `known-broken Warp build ${build}`;
		hint = `Update Warp — notifications are gated off at or below ${threshold ? formatVersionTuple(threshold) : "the fixed version"}.`;
	}

	return {
		inWarp: warp.isWarp,
		supportsStructured: warp.supportsStructured,
		disabledByConfig: !enabled,
		active: warp.isWarp && warp.supportsStructured && enabled,
		termProgram: process.env.TERM_PROGRAM,
		clientVersion,
		channel: parsed?.channel,
		protocolEnv,
		negotiatedVersion: negotiateProtocolVersion(),
		versionGated,
		reason,
		hint,
		heartbeatMs: getHeartbeatMs(),
		blockingTools: [...getBlockingTools()],
		configPath: CONFIG_PATH,
	};
}

export function formatStatus(status: WarpNotifyStatus): string {
	const lines: string[] = ["yoki-warp-notify status"];
	lines.push(`  notifications : ${status.active ? "ACTIVE" : `OFF — ${status.reason}`}`);
	if (!status.active && status.hint !== undefined) {
		lines.push(`  next step     : ${status.hint}`);
	}
	lines.push(
		`  terminal      : ${status.inWarp ? "Warp" : `not Warp (TERM_PROGRAM=${status.termProgram ?? "unset"})`}`,
	);
	if (status.inWarp) {
		lines.push(
			`  warp build    : ${status.clientVersion ?? "unknown"}${status.channel ? ` (${status.channel})` : ""}`,
		);
		lines.push(
			`  protocol      : WARP_CLI_AGENT_PROTOCOL_VERSION=${status.protocolEnv ?? "unset"} → v${status.negotiatedVersion}`,
		);
	}
	lines.push(`  heartbeat     : ${status.heartbeatMs > 0 ? `${status.heartbeatMs} ms` : "disabled"}`);
	lines.push(`  blocking tools: ${status.blockingTools.join(", ") || "none"}`);
	lines.push(`  config        : ${status.configPath}`);
	return lines.join("\n");
}

export function buildStatusReport(): string {
	return formatStatus(readStatus());
}

/** One-line startup notice for a Warp session where notifications cannot run.
 *  Fired once by index.ts so a trial user is never left with silent "nothing
 *  happened" — the /warp-notify command is the advertised follow-up. */
export function formatUnavailableNotice(status: WarpNotifyStatus): string {
	return `yoki-warp-notify: notifications are OFF (${status.reason}). Run /warp-notify for a diagnosis.`;
}
