import { describe, expect, it } from "vitest";
import {
	appendStatus,
	formatAttachReceipt,
	formatDetachReceipt,
	formatIdleNotice,
	formatJobExitNotice,
	formatJobLine,
	formatJobList,
	formatStopReceipt,
	formatTimeoutError,
} from "../core/format.ts";
import type { JobRecord } from "../types.ts";

const job: JobRecord = {
	id: "J-7",
	command: "curl -o isubs.tar.zst https://example.com/isubs",
	label: "下载 isubs",
	mode: "long",
	status: "running",
	reason: "curl download",
	startedAt: 0,
	lastOutputAt: 1_000,
	detached: true,
	outputBytes: 2_048,
	outputLines: 40,
};

describe("appendStatus", () => {
	it("appends a status only when there is one", () => {
		expect(appendStatus("out", "Command exited with code 1")).toBe("out\n\nCommand exited with code 1");
		expect(appendStatus("out", "")).toBe("out");
		expect(appendStatus("", "Command aborted")).toBe("Command aborted");
	});
});

describe("detach receipt", () => {
	it("says the process is alive, gives the job id, and names the next steps", () => {
		const text = formatDetachReceipt({
			job,
			reason: "budget",
			tail: "line 40",
			tailLines: 20,
			now: 60_000,
		});
		expect(text).toContain("Job J-7 (下载 isubs) moved to the background");
		expect(text).toContain("soft budget reached");
		expect(text).toContain("nothing was killed");
		expect(text).toContain('tool_execution_inspect_output({ job: "J-7" })');
		expect(text).toContain('bash_job_stop({ job: "J-7" })');
		expect(text).toContain("line 40");
	});

	it("explains an idle yield differently from a budget yield", () => {
		const text = formatDetachReceipt({ job, reason: "idle", tail: "", tailLines: 20, now: 0 });
		expect(text).toContain("no output for a while");
		expect(text).toContain("(no output yet)");
	});
});

describe("attach receipt", () => {
	it("confirms immediately and links the inspect tool", () => {
		const text = formatAttachReceipt(job);
		expect(text).toContain("started in the background (mode=long)");
		expect(text).toContain("woken when it exits");
	});

	it("says a timeout will be ignored when one was passed", () => {
		expect(formatAttachReceipt(job, 30)).toContain("timeout=30s you passed is ignored");
	});

	it("tells the truth about services never being auto-killed", () => {
		expect(formatAttachReceipt({ ...job, mode: "detach" })).toContain("never auto-killed");
	});
});

describe("exit notice", () => {
	it("reports the exit code, duration, and tail", () => {
		const text = formatJobExitNotice(
			{ ...job, status: "exited", exitCode: 0, exitedAt: 2 * 3_600_000 + 3 * 60_000 },
			"download 100%",
		);
		expect(text).toContain("finished: exit 0 after 2h03m");
		expect(text).toContain("download 100%");
		expect(text).toContain('tool_execution_inspect_output({ job: "J-7" })');
	});

	it("names the killer when a job was killed", () => {
		const text = formatJobExitNotice({ ...job, status: "killed", killedBy: "timeout", exitedAt: 1_000 }, "");
		expect(text).toContain("killed (timeout)");
		expect(text).toContain("(no output)");
	});
});

describe("small receipts", () => {
	it("formats a job line with status, duration and size", () => {
		const line = formatJobLine(job, 60_000);
		expect(line).toContain("J-7");
		expect(line).toContain("running");
		expect(line).toContain("1m");
		expect(line).toContain("mode=long");
		expect(line).toContain("2.0KB/40 lines");
	});

	it("lists jobs, including the empty case", () => {
		expect(formatJobList([], 0)).toBe("No bash jobs in this session.");
		const list = formatJobList([job, { ...job, id: "J-8", status: "exited", exitCode: 0 }], 60_000);
		expect(list).toContain("2 bash job(s), 1 running");
		expect(list).toContain("J-8");
	});

	it("formats the idle notice as a warning, not as a result", () => {
		expect(formatIdleNotice(job, 121, 59)).toContain("no output for 121s — moving to background in 59s");
	});

	it("keeps pi's timeout wording so users see a familiar message", () => {
		expect(formatTimeoutError(30, "partial")).toBe("partial\n\nCommand timed out after 30 seconds");
	});

	it("does not claim a stop that did not happen", () => {
		expect(formatStopReceipt(job, false)).toContain("could not be stopped");
		expect(formatStopReceipt({ ...job, status: "exited", exitCode: 0 }, false)).toContain("already exited");
		expect(formatStopReceipt({ ...job, killedBy: "model" }, true)).toContain("killed the whole process tree");
	});
});
