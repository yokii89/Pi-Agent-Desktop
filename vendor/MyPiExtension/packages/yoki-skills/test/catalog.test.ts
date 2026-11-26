import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BUNDLED_SKILLS, CODEX_SOURCE_AUDIT, validatePiSkillSource } from "../extensions/pi-codex-skills/catalog.ts";

test("only ready audited assets are in the installable catalog", () => {
	const ready = CODEX_SOURCE_AUDIT.filter((asset) => asset.status === "ready").map((asset) => asset.name);
	assert.deepEqual(BUNDLED_SKILLS.map((asset) => asset.name), ready);
	assert.equal(BUNDLED_SKILLS.length, 2);
	assert.ok(CODEX_SOURCE_AUDIT.every((asset) => asset.status === "ready"));
});

test("frontmatter audit distinguishes Pi load errors from Codex compatibility warnings", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-codex-skills-"));
	try {
		await writeFile(join(root, "SKILL.md"), "---\nname: invalid name\ndescription: x\ndisable-model-invocation: maybe\n---\n", "utf8");
		await mkdir(join(root, "agents"));
		await writeFile(join(root, "agents", "openai.yaml"), "ui: ignored\n", "utf8");
		const diagnostics = validatePiSkillSource(root);
		assert.equal(diagnostics.some((item) => item.severity === "error"), false);
		assert.match(diagnostics.map((item) => item.message).join("\n"), /Name is outside/);
		assert.match(diagnostics.map((item) => item.message).join("\n"), /not interpreted by Pi/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
