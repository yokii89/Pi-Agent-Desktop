import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_YOKI_SEGMENTS, projectYokiDomain, projectYokiRoot, REL } from "../project-paths.ts";

describe("PROJECT_YOKI_SEGMENTS", () => {
	it("is .pi then yoki", () => {
		expect([...PROJECT_YOKI_SEGMENTS]).toEqual([".pi", "yoki"]);
	});
});

describe("projectYokiRoot", () => {
	it("joins cwd with .pi/yoki segments", () => {
		expect(projectYokiRoot("/repo")).toBe(join("/repo", ".pi", "yoki"));
	});
});

describe("projectYokiDomain", () => {
	it("appends the domain name under the project root", () => {
		expect(projectYokiDomain("/repo", "workflows")).toBe(join("/repo", ".pi", "yoki", "workflows"));
	});

	it("appends rest segments under the domain", () => {
		expect(projectYokiDomain("/repo", "artifacts", "research", "x.md")).toBe(
			join("/repo", ".pi", "yoki", "artifacts", "research", "x.md"),
		);
	});
});

describe("REL", () => {
	it("uses forward-slash relative prefixes only", () => {
		expect(REL.root).toBe(".pi/yoki");
		expect(REL.artifacts).toBe(".pi/yoki/artifacts");
		expect(REL.workflows).toBe(".pi/yoki/workflows");
		expect(REL.guidance).toBe(".pi/yoki/guidance");
		expect(REL.todo).toBe(".pi/yoki/todo");
		for (const value of Object.values(REL)) {
			expect(value.includes("\\")).toBe(false);
			expect(value.startsWith(".pi/yoki")).toBe(true);
		}
	});

	it("todo domain segments join to .pi/yoki/todo/tasks.json", () => {
		expect(projectYokiDomain("/repo", "todo", "tasks.json")).toBe(join("/repo", ".pi", "yoki", "todo", "tasks.json"));
		expect(REL.todo.split("/")).toEqual([".pi", "yoki", "todo"]);
	});
});
