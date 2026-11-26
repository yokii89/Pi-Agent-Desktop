import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockPi } from "../../yoki-test-utils/pi.js";

function configDir(): string {
	return join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".config", "yoki-image-gen");
}

function writeEnabledFlag(enabled: boolean): void {
	const dir = configDir();
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "config.json"), JSON.stringify({ enabled }), "utf8");
}

describe("yoki-image-gen extension factory", () => {
	beforeEach(() => {
		rmSync(configDir(), { recursive: true, force: true });
		vi.resetModules();
	});

	afterEach(() => {
		rmSync(configDir(), { recursive: true, force: true });
	});

	it("registers /image-gen always and generate_image when enabled", async () => {
		const factory = (await import("../index.js")).default;
		const { captured, pi } = createMockPi();
		factory(pi);

		expect(captured.commands.has("image-gen")).toBe(true);
		expect(captured.tools.has("generate_image")).toBe(true);
	});

	it("skips generate_image when started disabled; /image-gen on registers it live", async () => {
		writeEnabledFlag(false);
		const factory = (await import("../index.js")).default;
		const { captured, pi } = createMockPi();
		factory(pi);

		expect(captured.commands.has("image-gen")).toBe(true);
		expect(captured.tools.has("generate_image")).toBe(false);

		const handler = captured.commands.get("image-gen")?.handler;
		expect(handler).toBeTypeOf("function");
		await handler?.("on", {
			hasUI: true,
			ui: { notify: () => {} },
		} as never);
		expect(captured.tools.has("generate_image")).toBe(true);
	});

	it("execute returns disabled error after /image-gen off", async () => {
		const factory = (await import("../index.js")).default;
		const { captured, pi } = createMockPi();
		factory(pi);

		const tool = captured.tools.get("generate_image");
		expect(tool).toBeDefined();

		writeEnabledFlag(false);
		const result = await tool!.execute("tc-1", { prompt: "a red circle" }, undefined, undefined, {
			cwd: process.env.HOME ?? ".",
		} as never);
		expect(result.content[0]).toMatchObject({ type: "text" });
		expect((result.content[0] as { text: string }).text).toContain("disabled");
	});
});
