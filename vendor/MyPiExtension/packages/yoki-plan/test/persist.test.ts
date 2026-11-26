import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PLAN_ARTIFACT_SOURCE, plansDir, writePlanArtifact } from "../persist.ts";

const tmpDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function makeCwd(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "yoki-plan-"));
	tmpDirs.push(dir);
	return dir;
}

describe("writePlanArtifact", () => {
	it("creates plans dir and writes frontmatter + steps", async () => {
		const cwd = await makeCwd();
		const date = new Date("2026-07-21T14:30:00.000Z");
		const result = await writePlanArtifact({
			cwd,
			date,
			topic: "plan-mode-feature",
			steps: [
				{ step: 1, text: "First step" },
				{ step: 2, text: "Second step" },
			],
			overview: "Short overview.",
		});

		expect(result.filename).toMatch(/_plan-mode-feature\.md$/);
		expect(result.relativePath).toContain(".pi/yoki/artifacts/plans/");
		expect(result.absolutePath).toBe(join(plansDir(cwd), result.filename));

		const body = await readFile(result.absolutePath, "utf8");
		expect(body).toContain(`source: ${PLAN_ARTIFACT_SOURCE}`);
		expect(body).toContain("status: ready");
		expect(body).toContain("steps_count: 2");
		expect(body).toContain("tags: [plan, plan-mode]");
		expect(body).toContain("Short overview.");
		expect(body).toContain("1. First step");
		expect(body).toContain("2. Second step");
	});

	it("derives topic from first step when omitted", async () => {
		const cwd = await makeCwd();
		const result = await writePlanArtifact({
			cwd,
			date: new Date("2026-01-01T00:00:00.000Z"),
			steps: [{ step: 1, text: "Wire agent settled handler" }],
		});
		expect(result.filename).toMatch(/wire-agent-settled-handler\.md$/);
	});
});
