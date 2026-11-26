import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONFIG_PATH, setEnabled } from "../config.ts";
import { BROKEN_VERSIONS } from "../protocol.ts";
import { buildStatusReport, formatStatus, formatUnavailableNotice, readStatus } from "../status.ts";

const WARP_ENV_VARS = ["TERM_PROGRAM", "WARP_CLI_AGENT_PROTOCOL_VERSION", "WARP_CLIENT_VERSION"] as const;

function setWorkingWarpEnv(): void {
	process.env.TERM_PROGRAM = "WarpTerminal";
	process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1";
	process.env.WARP_CLIENT_VERSION = "v0.2026.05.01.00.00.stable_01";
}

function setBrokenWarpEnv(): void {
	process.env.TERM_PROGRAM = "WarpTerminal";
	process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1";
	process.env.WARP_CLIENT_VERSION = "v0.2026.01.01.00.00.stable_01";
}

beforeEach(() => {
	for (const k of WARP_ENV_VARS) delete process.env[k];
	rmSync(CONFIG_PATH, { force: true });
});
afterEach(() => {
	rmSync(CONFIG_PATH, { force: true });
});

describe("readStatus", () => {
	it("reports active in a working Warp environment", () => {
		setWorkingWarpEnv();
		const status = readStatus();
		expect(status.active).toBe(true);
		expect(status.reason).toBeUndefined();
		expect(status.hint).toBeUndefined();
		expect(status.channel).toBe("stable");
		expect(status.negotiatedVersion).toBe(1);
	});

	it("reports not-in-Warp as the first blocker outside Warp", () => {
		const status = readStatus();
		expect(status.active).toBe(false);
		expect(status.inWarp).toBe(false);
		expect(status.reason).toContain("not running inside the Warp terminal");
	});

	it("reports the disabled-by-config state with an actionable hint", () => {
		setWorkingWarpEnv();
		setEnabled(false);
		const status = readStatus();
		expect(status.active).toBe(false);
		expect(status.disabledByConfig).toBe(true);
		expect(status.reason).toContain("disabled in config");
		expect(status.hint).toContain("/warp-notify on");
	});

	it("attributes missing structured support to the absent protocol env var", () => {
		process.env.TERM_PROGRAM = "WarpTerminal";
		const status = readStatus();
		expect(status.active).toBe(false);
		expect(status.supportsStructured).toBe(false);
		expect(status.reason).toContain("did not advertise");
		expect(status.hint).toContain("update Warp");
	});

	it("attributes missing structured support to the broken-version gate", () => {
		setBrokenWarpEnv();
		const status = readStatus();
		expect(status.active).toBe(false);
		expect(status.versionGated).toBe(true);
		expect(status.reason).toContain("known-broken Warp build");
		expect(status.hint).toContain(BROKEN_VERSIONS.stable!.join("."));
	});

	it("carries the config values through", () => {
		setWorkingWarpEnv();
		const status = readStatus();
		expect(status.heartbeatMs).toBe(15000);
		expect(status.blockingTools).toEqual(["ask_user_question"]);
		expect(status.configPath).toBe(CONFIG_PATH);
	});
});

describe("formatStatus", () => {
	it("shows ACTIVE without a hint block when everything works", () => {
		setWorkingWarpEnv();
		const report = formatStatus(readStatus());
		expect(report).toContain("notifications : ACTIVE");
		expect(report).not.toContain("next step");
		expect(report).toContain("warp build    : v0.2026.05.01.00.00.stable_01 (stable)");
		expect(report).toContain("heartbeat     : 15000 ms");
	});

	it("shows OFF with a next-step hint when blocked", () => {
		process.env.TERM_PROGRAM = "WarpTerminal";
		const report = formatStatus(readStatus());
		expect(report).toContain("OFF —");
		expect(report).toContain("next step     :");
		// In Warp, so the terminal line stays "Warp" even though notifications are off.
		expect(report).toContain("terminal      : Warp");
	});

	it("renders a disabled heartbeat as 'disabled'", () => {
		process.env.TERM_PROGRAM = "WarpTerminal";
		const report = formatStatus({ ...readStatus(), heartbeatMs: 0 });
		expect(report).toContain("heartbeat     : disabled");
	});
});

describe("buildStatusReport", () => {
	it("composes readStatus + formatStatus", () => {
		setWorkingWarpEnv();
		expect(buildStatusReport()).toContain("yoki-warp-notify status");
	});
});

describe("formatUnavailableNotice", () => {
	it("is a single line pointing at /warp-notify", () => {
		setBrokenWarpEnv();
		const notice = formatUnavailableNotice(readStatus());
		expect(notice.split("\n")).toHaveLength(1);
		expect(notice).toContain("notifications are OFF");
		expect(notice).toContain("/warp-notify");
	});
});
