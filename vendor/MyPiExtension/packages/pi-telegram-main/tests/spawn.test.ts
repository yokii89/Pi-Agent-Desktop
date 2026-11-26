/**
 * Regression tests for operator Telegram spawn control
 */

import assert from "node:assert/strict";
import type { spawn as SpawnFn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	buildTelegramSpawnScriptPlan,
	confirmAndRunTelegramSpawn,
	createTelegramSpawnRateLimitState,
	evaluateTelegramSpawnGate,
	handleTelegramSpawnConfirmationCallback,
	resolveTelegramSpawnScriptPath,
	runTelegramSpawnScript,
	TELEGRAM_SPAWN_CALLBACK_CANCEL,
	TELEGRAM_SPAWN_CALLBACK_CONFIRM,
	TELEGRAM_SPAWN_MIN_INTERVAL_MS,
} from "../lib/spawn.ts";

test("resolveTelegramSpawnScriptPath picks platform script under package scripts/", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-telegram-spawn-pkg-"));
	mkdirSync(join(root, "scripts"), { recursive: true });
	writeFileSync(join(root, "scripts", "pi-telegram-spawn.ps1"), "#");
	writeFileSync(join(root, "scripts", "pi-telegram-spawn.sh"), "#");
	assert.match(
		resolveTelegramSpawnScriptPath({
			packageRoot: root,
			platform: "win32",
		}),
		/pi-telegram-spawn\.ps1$/,
	);
	assert.match(
		resolveTelegramSpawnScriptPath({
			packageRoot: root,
			platform: "linux",
		}),
		/pi-telegram-spawn\.sh$/,
	);
});

test("buildTelegramSpawnScriptPlan uses whitelist args without shell interpolation", () => {
	const plan = buildTelegramSpawnScriptPlan("D:\\Code\\proj", {
		packageRoot: "D:\\pkg",
		platform: "win32",
	});
	assert.equal(plan.command, "powershell.exe");
	assert.deepEqual(plan.args.slice(0, 4), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
	assert.equal(plan.args.includes("-Cwd"), true);
	assert.equal(plan.args.includes("D:\\Code\\proj"), true);
});

test("evaluateTelegramSpawnGate requires threaded mode and rate limit", () => {
	assert.equal(
		evaluateTelegramSpawnGate({
			isThreadedModeAvailable: false,
			nowMs: 1000,
		}).ok,
		false,
	);
	assert.equal(
		evaluateTelegramSpawnGate({
			isThreadedModeAvailable: true,
			nowMs: 1000,
		}).ok,
		true,
	);
	assert.equal(
		evaluateTelegramSpawnGate({
			isThreadedModeAvailable: true,
			nowMs: 1000,
			lastSpawnAtMs: 900,
			minIntervalMs: TELEGRAM_SPAWN_MIN_INTERVAL_MS,
		}).ok,
		false,
	);
	assert.equal(
		evaluateTelegramSpawnGate({
			isThreadedModeAvailable: true,
			nowMs: 1000 + TELEGRAM_SPAWN_MIN_INTERVAL_MS,
			lastSpawnAtMs: 1000,
			minIntervalMs: TELEGRAM_SPAWN_MIN_INTERVAL_MS,
		}).ok,
		true,
	);
});

test("confirmAndRunTelegramSpawn marks rate limit and runs whitelist runner", async () => {
	const state = createTelegramSpawnRateLimitState();
	let ran = 0;
	const result = await confirmAndRunTelegramSpawn({
		isThreadedModeAvailable: () => true,
		getCwd: () => "/repo",
		getNowMs: () => 5000,
		rateLimitState: state,
		runSpawn: async () => {
			ran += 1;
			return { ok: true, message: "started" };
		},
	});
	assert.equal(result.ok, true);
	assert.equal(ran, 1);
	assert.equal(state.lastSpawnAtMs, 5000);

	const blocked = await confirmAndRunTelegramSpawn({
		isThreadedModeAvailable: () => true,
		getCwd: () => "/repo",
		getNowMs: () => 5100,
		rateLimitState: state,
		runSpawn: async () => {
			ran += 1;
			return { ok: true, message: "started" };
		},
	});
	assert.equal(blocked.ok, false);
	assert.equal(ran, 1);
});

test("handleTelegramSpawnConfirmationCallback cancel and confirm", async () => {
	const edits: string[] = [];
	const cancelled = await handleTelegramSpawnConfirmationCallback(
		{
			id: "q1",
			data: TELEGRAM_SPAWN_CALLBACK_CANCEL,
			message: { chat: { id: 1 }, message_id: 2 },
		},
		{
			answerCallbackQuery: async () => undefined,
			editInteractiveMessage: async (_c, _m, text) => {
				edits.push(text);
			},
			runSpawn: async () => ({ ok: true, message: "ok" }),
		},
	);
	assert.equal(cancelled, true);
	assert.equal(edits.length, 1);

	const confirmed = await handleTelegramSpawnConfirmationCallback(
		{
			id: "q2",
			data: TELEGRAM_SPAWN_CALLBACK_CONFIRM,
			message: { chat: { id: 1 }, message_id: 3 },
		},
		{
			answerCallbackQuery: async () => undefined,
			editInteractiveMessage: async (_c, _m, text) => {
				edits.push(text);
			},
			runSpawn: async () => ({ ok: true, message: "spawn-ok" }),
		},
	);
	assert.equal(confirmed, true);
	assert.equal(edits.at(-1), "spawn-ok");
});

test("runTelegramSpawnScript surfaces missing script", async () => {
	const result = await runTelegramSpawnScript({
		cwd: tmpdir(),
		packageRoot: join(tmpdir(), "missing-pkg-root-xyz"),
		platform: "win32",
		spawnProcess: (() => {
			throw new Error("should not spawn");
		}) as unknown as typeof SpawnFn,
	});
	assert.equal(result.ok, false);
	assert.match(result.message, /script missing|失败/);
});

test("runTelegramSpawnScript treats zero exit as success when script exists", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-telegram-spawn-run-"));
	mkdirSync(join(root, "scripts"), { recursive: true });
	writeFileSync(join(root, "scripts", "pi-telegram-spawn.ps1"), "# ok");
	const result = await runTelegramSpawnScript({
		cwd: tmpdir(),
		packageRoot: root,
		platform: "win32",
		spawnProcess: ((_cmd, _args, _opts) => {
			const child = new EventEmitter() as EventEmitter & {
				stdout: EventEmitter;
				stderr: EventEmitter;
			};
			child.stdout = new EventEmitter();
			child.stderr = new EventEmitter();
			queueMicrotask(() => child.emit("close", 0));
			return child as ReturnType<typeof SpawnFn>;
		}) as typeof SpawnFn,
	});
	assert.equal(result.ok, true);
	assert.match(result.message, /启动|实例/);
});
