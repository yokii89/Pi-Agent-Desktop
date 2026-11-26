import * as fs from "node:fs";
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		openSync: vi.fn(),
		writeSync: vi.fn(),
		closeSync: vi.fn(),
	};
});

import { CONFIG_PATH, setEnabled } from "../config.ts";
import { createWorkflowQuestionTransport } from "../workflow-transport.ts";

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

function primeFs(): { open: Mock; write: Mock; close: Mock } {
	(fs.openSync as unknown as Mock).mockReturnValue(42);
	(fs.writeSync as unknown as Mock).mockReturnValue(0);
	(fs.closeSync as unknown as Mock).mockReturnValue(undefined);
	return {
		open: fs.openSync as unknown as Mock,
		write: fs.writeSync as unknown as Mock,
		close: fs.closeSync as unknown as Mock,
	};
}

beforeEach(() => {
	for (const k of WARP_ENV_VARS) delete process.env[k];
	(fs.openSync as unknown as Mock).mockReset();
	(fs.writeSync as unknown as Mock).mockReset();
	(fs.closeSync as unknown as Mock).mockReset();
	rmSync(CONFIG_PATH, { force: true });
});

function osc777Payloads(write: Mock) {
	return write.mock.calls
		.filter((c) => String(c[1]).startsWith("\x1b]777;notify;"))
		.map((c) => {
			const json = String(c[1])
				.replace(/^\x1b\]777;notify;warp:\/\/cli-agent;/, "")
				.replace(/\x07$/, "");
			return JSON.parse(json);
		});
}

describe("createWorkflowQuestionTransport", () => {
	it("asked emits session_start then question_asked for the runId", () => {
		setWorkingWarpEnv();
		const { write } = primeFs();
		const transport = createWorkflowQuestionTransport("/tmp/projects/widget");
		transport.asked("run-xyz");
		const payloads = osc777Payloads(write);
		expect(payloads).toHaveLength(2);
		expect(payloads[0].event).toBe("session_start");
		expect(payloads[0].session_id).toBe("run-xyz");
		expect(payloads[0].project).toBe("widget");
		expect(payloads[1].event).toBe("question_asked");
		expect(payloads[1].session_id).toBe("run-xyz");
	});

	it("resolved emits a single tool_complete for the runId", () => {
		setWorkingWarpEnv();
		const { write } = primeFs();
		const transport = createWorkflowQuestionTransport("/tmp/projects/widget");
		transport.resolved("run-xyz");
		const payloads = osc777Payloads(write);
		expect(payloads).toHaveLength(1);
		expect(payloads[0].event).toBe("tool_complete");
		expect(payloads[0].session_id).toBe("run-xyz");
		expect(payloads[0].tool_name).toBe("ask_user_question");
		expect(payloads[0].tool_input).toBeUndefined();
	});

	it("writes nothing when supportsStructured is false (outside Warp)", () => {
		// no Warp env vars set (beforeEach cleared them) → supportsStructured is false
		const { open } = primeFs();
		const transport = createWorkflowQuestionTransport("/tmp");
		transport.asked("run-xyz");
		transport.resolved("run-xyz");
		expect(open).not.toHaveBeenCalled();
	});

	it("writes nothing on a broken Warp build", () => {
		setBrokenWarpEnv();
		const { open } = primeFs();
		const transport = createWorkflowQuestionTransport("/tmp");
		transport.asked("run-xyz");
		transport.resolved("run-xyz");
		expect(open).not.toHaveBeenCalled();
	});

	it("writes nothing while notifications are disabled by config", () => {
		setWorkingWarpEnv();
		setEnabled(false);
		const { write } = primeFs();
		const transport = createWorkflowQuestionTransport("/tmp/projects/widget");
		transport.asked("run-xyz");
		transport.resolved("run-xyz");
		expect(osc777Payloads(write)).toHaveLength(0);
	});

	it("resumes writing after a live re-enable (setEnabled(true))", () => {
		setWorkingWarpEnv();
		setEnabled(false);
		const { write } = primeFs();
		const transport = createWorkflowQuestionTransport("/tmp/projects/widget");
		transport.asked("run-a");
		setEnabled(true);
		transport.asked("run-b");
		const payloads = osc777Payloads(write);
		expect(payloads).toHaveLength(2);
		expect(payloads[0].session_id).toBe("run-b");
	});
});
