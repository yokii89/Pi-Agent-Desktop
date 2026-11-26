/**
 * Regression tests for public package API exports
 * Zones: package boundary, extension interop
 * Guards stable public subpaths and the removal of deep lib wildcard exports
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function assertPackagePathNotExported(specifier: string): Promise<void> {
	await assert.rejects(
		() => import(specifier),
		(error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
	);
}

test("Public package subpaths expose the stable extension API", async () => {
	const [root, inbound, outbound, delivery, activity, updates, commands, sections, status, voice, keyboard] =
		await Promise.all([
			import("@yoki/pi-telegram"),
			import("@yoki/pi-telegram/inbound"),
			import("@yoki/pi-telegram/outbound"),
			import("@yoki/pi-telegram/delivery"),
			import("@yoki/pi-telegram/activity"),
			import("@yoki/pi-telegram/updates"),
			import("@yoki/pi-telegram/commands"),
			import("@yoki/pi-telegram/sections"),
			import("@yoki/pi-telegram/status"),
			import("@yoki/pi-telegram/voice"),
			import("@yoki/pi-telegram/keyboard"),
		]);

	assert.deepEqual(Object.keys(root), ["default"]);
	assert.deepEqual(Object.keys(inbound).sort(), ["registerTelegramInboundHandler"]);
	assert.deepEqual(Object.keys(outbound).sort(), ["recordTelegramRuntimeEvent", "registerTelegramOutboundHandler"]);
	assert.deepEqual(Object.keys(delivery).sort(), [
		"deleteTelegramView",
		"editTelegramView",
		"sendTelegramChatAction",
		"sendTelegramView",
	]);
	assert.deepEqual(Object.keys(activity).sort(), ["registerTelegramActivityHandler"]);
	assert.deepEqual(Object.keys(updates).sort(), ["registerTelegramUpdateHandler"]);
	assert.deepEqual(Object.keys(commands).sort(), ["registerTelegramCommand"]);
	assert.deepEqual(Object.keys(sections).sort(), ["getTelegramSectionDiagnostics", "registerTelegramSection"]);
	assert.deepEqual(Object.keys(status).sort(), ["registerTelegramStatusLineProvider"]);
	assert.deepEqual(Object.keys(voice).sort(), [
		"TELEGRAM_VOICE_REPLY_MODES",
		"computeVoicePromptContribution",
		"computeVoiceTurnFlags",
		"getTelegramVoiceReplyMode",
		"getTelegramVoiceSendTranscript",
		"isVoiceTurn",
		"registerTelegramVoiceSynthesisProvider",
		"registerTelegramVoiceTranscriptionProvider",
		"shouldSuppressPreviewForVoice",
	]);
	assert.deepEqual(Object.keys(keyboard), []);
});

test("Activity API declares the Pi lifecycle compatibility floor", async () => {
	const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
		peerDependencies?: Record<string, string>;
	};
	assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-coding-agent"], ">=0.80.6");
	assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-agent-core"], ">=0.80.6");
	assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-ai"], ">=0.80.6");
});

test("Package-private lib implementation paths are not exported", async () => {
	await assertPackagePathNotExported("@yoki/pi-telegram/lib/updates.ts");
	await assertPackagePathNotExported("@yoki/pi-telegram/lib/sections.ts");
	await assertPackagePathNotExported("@yoki/pi-telegram/api/updates.ts");
});
