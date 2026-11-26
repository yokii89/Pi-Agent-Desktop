import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	CONFIG_PATH,
	DEFAULT_BLOCKING_TOOLS,
	DEFAULT_HEARTBEAT_MS,
	getBlockingTools,
	getHeartbeatMs,
	isEnabled,
	loadConfig,
	setEnabled,
} from "../config.ts";

function writeConfigFile(contents: string): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, contents, "utf-8");
}
function removeConfigFile(): void {
	rmSync(CONFIG_PATH, { force: true });
}

beforeEach(removeConfigFile);
afterEach(removeConfigFile);

describe("loadConfig", () => {
	it("returns {} when the config file is missing", () => {
		expect(loadConfig()).toEqual({});
	});
	it("returns {} on a malformed JSON file", () => {
		writeConfigFile("{not json");
		expect(loadConfig()).toEqual({});
	});
	it("returns {} when the file parses to a non-object (string, number)", () => {
		writeConfigFile('"hello"');
		expect(loadConfig()).toEqual({});
		writeConfigFile("42");
		expect(loadConfig()).toEqual({});
	});
	it("returns the parsed shape when the file is a valid JSON object", () => {
		writeConfigFile(JSON.stringify({ blockingTools: ["a", "b"] }));
		expect(loadConfig()).toEqual({ blockingTools: ["a", "b"] });
	});
});

describe("getBlockingTools", () => {
	it("falls back to the default set when no config is present", () => {
		expect([...getBlockingTools()]).toEqual([...DEFAULT_BLOCKING_TOOLS]);
	});
	it("uses the configured list when present", () => {
		writeConfigFile(JSON.stringify({ blockingTools: ["ask_user_question", "my_custom_tool"] }));
		expect(getBlockingTools()).toEqual(new Set(["ask_user_question", "my_custom_tool"]));
	});
	it("returns an empty set when the config explicitly lists no tools", () => {
		writeConfigFile(JSON.stringify({ blockingTools: [] }));
		expect(getBlockingTools().size).toBe(0);
	});
	it("filters out non-string and empty entries", () => {
		writeConfigFile(JSON.stringify({ blockingTools: ["ok", "", null, 42, "also_ok"] }));
		expect(getBlockingTools()).toEqual(new Set(["ok", "also_ok"]));
	});
	it("falls back to defaults when blockingTools is not an array", () => {
		writeConfigFile(JSON.stringify({ blockingTools: "ask_user_question" }));
		expect([...getBlockingTools()]).toEqual([...DEFAULT_BLOCKING_TOOLS]);
	});
});

describe("isEnabled / setEnabled", () => {
	it("defaults to enabled when no config is present", () => {
		expect(isEnabled()).toBe(true);
	});
	it("defaults to enabled when the key is absent", () => {
		writeConfigFile(JSON.stringify({ heartbeatMs: 1000 }));
		expect(isEnabled()).toBe(true);
	});
	it("is disabled only on an explicit false", () => {
		writeConfigFile(JSON.stringify({ enabled: false }));
		expect(isEnabled()).toBe(false);
	});
	it("setEnabled(false) persists and isEnabled reads it back", () => {
		expect(setEnabled(false)).toBe(true);
		expect(isEnabled()).toBe(false);
		expect(loadConfig().enabled).toBe(false);
	});
	it("setEnabled(true) merges into an existing config instead of replacing it", () => {
		writeConfigFile(JSON.stringify({ heartbeatMs: 5000, blockingTools: ["ask_user_question"] }));
		expect(setEnabled(false)).toBe(true);
		const config = loadConfig();
		expect(config.enabled).toBe(false);
		expect(config.heartbeatMs).toBe(5000);
		expect(config.blockingTools).toEqual(["ask_user_question"]);
	});
});

describe("getHeartbeatMs", () => {
	it("returns the default when no config is present", () => {
		expect(getHeartbeatMs()).toBe(DEFAULT_HEARTBEAT_MS);
	});
	it("returns 0 when explicitly disabled", () => {
		writeConfigFile(JSON.stringify({ heartbeatMs: 0 }));
		expect(getHeartbeatMs()).toBe(0);
	});
	it("returns the default for negative values", () => {
		writeConfigFile(JSON.stringify({ heartbeatMs: -100 }));
		expect(getHeartbeatMs()).toBe(DEFAULT_HEARTBEAT_MS);
	});
	it("returns the default for non-number values", () => {
		writeConfigFile(JSON.stringify({ heartbeatMs: "fast" }));
		expect(getHeartbeatMs()).toBe(DEFAULT_HEARTBEAT_MS);
	});
	it("returns the configured value for positive numbers", () => {
		writeConfigFile(JSON.stringify({ heartbeatMs: 5000 }));
		expect(getHeartbeatMs()).toBe(5000);
	});
});
