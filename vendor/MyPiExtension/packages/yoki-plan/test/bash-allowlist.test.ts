import { describe, expect, it } from "vitest";
import { isSafeCommand } from "../bash-allowlist.ts";

describe("isSafeCommand", () => {
	it("allows common read-only commands", () => {
		expect(isSafeCommand("ls -la")).toBe(true);
		expect(isSafeCommand("cat package.json")).toBe(true);
		expect(isSafeCommand("rg foo src")).toBe(true);
		expect(isSafeCommand("git status")).toBe(true);
		expect(isSafeCommand("git log --oneline -5")).toBe(true);
		expect(isSafeCommand("npm list")).toBe(true);
		expect(isSafeCommand("head -n 20 README.md")).toBe(true);
		expect(isSafeCommand("pwd")).toBe(true);
		expect(isSafeCommand("  find . -name '*.ts'")).toBe(true);
	});

	it("blocks destructive commands even if partially allowlisted", () => {
		expect(isSafeCommand("rm -rf /")).toBe(false);
		expect(isSafeCommand("git commit -m 'x'")).toBe(false);
		expect(isSafeCommand("npm install lodash")).toBe(false);
		expect(isSafeCommand("echo hi > file.txt")).toBe(false);
		expect(isSafeCommand("cat foo | tee out")).toBe(false);
		expect(isSafeCommand("sudo ls")).toBe(false);
		expect(isSafeCommand("mkdir tmp")).toBe(false);
	});

	it("blocks unknown non-allowlisted commands", () => {
		expect(isSafeCommand("python script.py")).toBe(false);
		expect(isSafeCommand("node build.js")).toBe(false);
		expect(isSafeCommand("curl -X POST https://evil")).toBe(true); // curl is allowlisted
		expect(isSafeCommand("docker run alpine")).toBe(false);
	});
});
