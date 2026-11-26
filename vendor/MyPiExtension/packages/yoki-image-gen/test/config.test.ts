import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PKG = "../config.js";

function configDir(): string {
	return join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".config", "yoki-image-gen");
}

function configPath(): string {
	return join(configDir(), "config.json");
}

function writeConfigFile(raw: string): void {
	mkdirSync(configDir(), { recursive: true });
	writeFileSync(configPath(), raw, "utf8");
}

describe("yoki-image-gen config", () => {
	beforeEach(() => {
		rmSync(configDir(), { recursive: true, force: true });
	});

	afterEach(() => {
		rmSync(configDir(), { recursive: true, force: true });
		delete process.env.YOKI_IMAGE_API_KEY;
		delete process.env.YOKI_IMAGE_BASE_URL;
		delete process.env.YOKI_IMAGE_MODEL;
		delete process.env.YOKI_IMAGE_PROVIDER;
	});

	it("defaults to enabled when no config is present", async () => {
		const { isEnabled, loadConfig } = await import(PKG);
		expect(loadConfig().enabled).toBeUndefined();
		expect(isEnabled()).toBe(true);
	});

	it("defaults to enabled when the key is absent", async () => {
		writeConfigFile(JSON.stringify({ provider: "openai" }));
		const { isEnabled, loadConfig } = await import(PKG);
		expect(loadConfig().enabled).toBeUndefined();
		expect(isEnabled()).toBe(true);
	});

	it("respects explicit enabled:false", async () => {
		writeConfigFile(JSON.stringify({ enabled: false }));
		const { isEnabled, loadConfig } = await import(PKG);
		expect(loadConfig().enabled).toBe(false);
		expect(isEnabled()).toBe(false);
	});

	it("setEnabled persists and merges into existing config", async () => {
		writeConfigFile(JSON.stringify({ model: "gpt-image-1" }));
		const { isEnabled, loadConfig, setEnabled } = await import(PKG);
		expect(setEnabled(false)).toBe(true);
		expect(isEnabled()).toBe(false);
		expect(loadConfig().model).toBe("gpt-image-1");
		expect(setEnabled(true)).toBe(true);
		expect(isEnabled()).toBe(true);
		expect(loadConfig().enabled).toBe(true);
	});

	it("resolveAuth returns undefined without any key", async () => {
		const { resolveAuth } = await import(PKG);
		expect(resolveAuth()).toBeUndefined();
	});

	it("resolveAuth prefers YOKI_IMAGE_* env", async () => {
		process.env.YOKI_IMAGE_API_KEY = "sk-test";
		process.env.YOKI_IMAGE_BASE_URL = "https://example.com/v1";
		process.env.YOKI_IMAGE_MODEL = "gpt-image-1";
		process.env.YOKI_IMAGE_PROVIDER = "openai";
		const { resolveAuth } = await import(PKG);
		const auth = resolveAuth();
		expect(auth).toMatchObject({
			provider: "openai",
			baseUrl: "https://example.com/v1",
			apiKey: "sk-test",
			model: "gpt-image-1",
		});
	});
});

describe("yoki-image-gen helpers", () => {
	it("mapCountForModel clamps to 1..4 and forces 1 for dall-e-3", async () => {
		const { mapCountForModel } = await import("../helpers.js");
		expect(mapCountForModel("gpt-image-1", 9)).toBe(4);
		expect(mapCountForModel("gpt-image-1", 0)).toBe(1);
		expect(mapCountForModel("dall-e-3", 3)).toBe(1);
	});

	it("mapQualityForModel maps labels for dalle vs gpt-image", async () => {
		const { mapQualityForModel } = await import("../helpers.js");
		expect(mapQualityForModel("dall-e-3", "high")).toBe("hd");
		expect(mapQualityForModel("gpt-image-1", "hd")).toBe("high");
		expect(mapQualityForModel("gpt-image-1", "auto")).toBeUndefined();
	});

	it("resolveProviderId infers openrouter from host", async () => {
		const { resolveProviderId } = await import("../helpers.js");
		expect(resolveProviderId(undefined, "https://openrouter.ai/api/v1")).toBe("openrouter");
		expect(resolveProviderId(undefined, "https://api.openai.com/v1")).toBe("openai");
		expect(resolveProviderId("openai", "https://openrouter.ai/api/v1")).toBe("openai");
	});

	it("parseDataUrl and extensionForMime", async () => {
		const { extensionForMime, parseDataUrl } = await import("../helpers.js");
		expect(parseDataUrl("data:image/png;base64,AAAA")).toEqual({
			mimeType: "image/png",
			data: "AAAA",
		});
		expect(parseDataUrl("https://example.com/a.png")).toBeUndefined();
		expect(extensionForMime("image/jpeg")).toBe(".jpg");
		expect(extensionForMime("image/unknown")).toBe(".png");
	});
});
