import { describe, expect, it } from "vitest";
import { getNormalModeTools, getPlanModeTools, isWriteTool, uniqueToolNames } from "../tools.ts";

describe("uniqueToolNames", () => {
	it("dedupes while preserving order", () => {
		expect(uniqueToolNames(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
	});
});

describe("getPlanModeTools", () => {
	it("removes write tools and keeps preferred plan tools", () => {
		const result = getPlanModeTools(["read", "bash", "edit", "write", "custom-tool"]);
		expect(result).toContain("read");
		expect(result).toContain("bash");
		expect(result).toContain("custom-tool");
		expect(result).toContain("grep");
		expect(result).toContain("ask_user_question");
		expect(result).not.toContain("edit");
		expect(result).not.toContain("write");
	});

	it("honors extra blocked and extra plan tools", () => {
		const result = getPlanModeTools(["read", "edit", "my-write"], ["my-write"], ["questionnaire"]);
		expect(result).not.toContain("my-write");
		expect(result).toContain("questionnaire");
	});
});

describe("getNormalModeTools", () => {
	it("restores edit/write and keeps unmanaged tools", () => {
		const result = getNormalModeTools(["bash", "custom-x"]);
		expect(result).toContain("edit");
		expect(result).toContain("write");
		expect(result).toContain("custom-x");
	});
});

describe("isWriteTool", () => {
	it("detects built-in and extra write tools", () => {
		expect(isWriteTool("edit")).toBe(true);
		expect(isWriteTool("write")).toBe(true);
		expect(isWriteTool("read")).toBe(false);
		expect(isWriteTool("patch", ["patch"])).toBe(true);
	});
});
