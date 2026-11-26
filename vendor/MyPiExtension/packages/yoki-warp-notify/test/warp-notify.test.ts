import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return { ...actual, openSync: vi.fn(), writeSync: vi.fn(), closeSync: vi.fn() };
});

import {
	createWarpTransport,
	formatOSC0,
	formatOSC777,
	formatPopTitleStack,
	formatPushTitleStack,
	type WarpTransportRuntime,
} from "../warp-notify.ts";

function primeFs(): { open: Mock; write: Mock; close: Mock } {
	(fs.openSync as unknown as Mock).mockReturnValue(7);
	(fs.writeSync as unknown as Mock).mockReturnValue(0);
	(fs.closeSync as unknown as Mock).mockReturnValue(undefined);
	return {
		open: fs.openSync as unknown as Mock,
		write: fs.writeSync as unknown as Mock,
		close: fs.closeSync as unknown as Mock,
	};
}

beforeEach(() => {
	(fs.openSync as unknown as Mock).mockReset();
	(fs.writeSync as unknown as Mock).mockReset();
	(fs.closeSync as unknown as Mock).mockReset();
});

afterEach(() => vi.restoreAllMocks());

const runtime = (windows: boolean, stdoutWrite = vi.fn(), stdoutTty = true): WarpTransportRuntime => ({
	isWindows: () => windows,
	isStdoutTty: () => stdoutTty,
	writeStdout: stdoutWrite,
});

describe("OSC formatters", () => {
	it("format OSC 777 and title-stack sequences", () => {
		expect(formatOSC777("warp://cli-agent", '{"event":"stop"}')).toBe(
			'\x1b]777;notify;warp://cli-agent;{"event":"stop"}\x07',
		);
		expect(formatOSC0("⣾ Pi")).toBe("\x1b]0;⣾ Pi\x07");
		expect(formatPushTitleStack()).toBe("\x1b[22;0t");
		expect(formatPopTitleStack()).toBe("\x1b[23;0t");
	});
});

describe("Unix transport", () => {
	it("writes to /dev/tty", () => {
		const { open, write, close } = primeFs();
		createWarpTransport(runtime(false))(formatOSC777("warp://cli-agent", "body"));
		expect(open).toHaveBeenCalledWith("/dev/tty", "w");
		expect(write).toHaveBeenCalledWith(7, "\x1b]777;notify;warp://cli-agent;body\x07");
		expect(close).toHaveBeenCalledWith(7);
	});

	it("silently skips an unavailable controlling terminal", () => {
		const open = (fs.openSync as unknown as Mock).mockImplementation(() => {
			throw new Error("ENXIO");
		});
		expect(() => createWarpTransport(runtime(false))(formatOSC0("Pi"))).not.toThrow();
		expect(open).toHaveBeenCalledOnce();
		expect(fs.writeSync).not.toHaveBeenCalled();
	});
});

describe("Windows ConPTY transport", () => {
	it("writes OSC bytes to stdout when it is a TTY", () => {
		const { open } = primeFs();
		const stdoutWrite = vi.fn();
		createWarpTransport(runtime(true, stdoutWrite))(formatOSC777("warp://cli-agent", "body"));
		expect(stdoutWrite).toHaveBeenCalledWith("\x1b]777;notify;warp://cli-agent;body\x07");
		expect(open).not.toHaveBeenCalled();
	});

	it("does not emit to piped stdout", () => {
		const stdoutWrite = vi.fn();
		createWarpTransport(runtime(true, stdoutWrite, false))(formatOSC0("Pi"));
		expect(stdoutWrite).not.toHaveBeenCalled();
	});

	it("swallows stdout write failures and carries title stack bytes", () => {
		const failing = vi.fn(() => {
			throw new Error("EPIPE");
		});
		expect(() => createWarpTransport(runtime(true, failing))(formatPushTitleStack())).not.toThrow();
		const stdoutWrite = vi.fn();
		createWarpTransport(runtime(true, stdoutWrite))(formatPopTitleStack());
		expect(stdoutWrite).toHaveBeenCalledWith("\x1b[23;0t");
	});
});
