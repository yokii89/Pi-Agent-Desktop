import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { app } from "electron";

interface RuntimeManager {
  startAgentRuntime(): Promise<{ nodeVersion: string }>;
  runAgentRuntimeSqliteSmokeTest(): Promise<{ conversationId: number; reply: string }>;
  disposeAgentRuntime(): Promise<void>;
}

interface ProtobufType {
  encode(value: { text: string }): { finish(): Uint8Array };
  decode(value: Uint8Array): { text: string };
}

interface Protobuf {
  parse(source: string): { root: { lookupType(name: string): ProtobufType } };
}

const configuredReportPath = process.env.PIDESK_RUNTIME_CHECK_REPORT;
if (!configuredReportPath) throw new Error("Missing runtime check report path.");
const reportPath: string = configuredReportPath;
// Use an isolated profile: verification must never open the user's application settings or sessions.
app.setPath("userData", path.join(path.dirname(reportPath), "profile"));

const hostRequire = createRequire(__filename);
const timeout = setTimeout(() => {
  console.error("Electron Durable verification timed out.");
  app.exit(1);
}, 150_000);

async function main(): Promise<void> {
  await app.whenReady();
  const aiRequire = createRequire(
    realpathSync(path.join(app.getAppPath(), "node_modules/@earendil-works/pi-ai/package.json")),
  );
  const google = aiRequire("@google/genai") as { GoogleGenAI?: unknown };
  assert.equal(typeof google.GoogleGenAI, "function");
  const googleRequire = createRequire(aiRequire.resolve("@google/genai"));
  if (app.isPackaged) {
    for (const resolved of [
      aiRequire.resolve("@google/genai"),
      googleRequire.resolve("protobufjs"),
    ]) {
      assert(resolved.startsWith(`${app.getAppPath()}${path.sep}`));
    }
  }
  const protobuf = googleRequire("protobufjs") as Protobuf;
  const message = protobuf
    .parse('syntax = "proto3"; message Integrity { string text = 1; }')
    .root.lookupType("Integrity");
  assert.equal(message.decode(message.encode({ text: "PiDesk" }).finish()).text, "PiDesk");

  const manager = hostRequire(
    path.join(app.getAppPath(), "dist/main/agentRuntime/agentRuntimeManager.js"),
  ) as RuntimeManager;
  try {
    const [first, second] = await Promise.all([
      manager.startAgentRuntime(),
      manager.startAgentRuntime(),
    ]);
    assert.equal(first.nodeVersion, second.nodeVersion);
    const result = await manager.runAgentRuntimeSqliteSmokeTest();
    assert.equal(result.reply, "PiDesk Durable SQLite round-trip passed.");
    assert(Number.isSafeInteger(result.conversationId));
    if (app.isPackaged) assert(app.getAppPath().endsWith("app.asar"));
    await manager.disposeAgentRuntime();
    await assert.rejects(manager.startAgentRuntime(), /closing/);
    await writeFile(
      reportPath,
      `${JSON.stringify(
        {
          packaged: app.isPackaged,
          appPath: app.getAppPath(),
          electron: process.versions.electron,
          utilityNode: first.nodeVersion,
          dependencies: { googleGenaiImport: "passed", protobufRoundTrip: "passed" },
          ...result,
          shutdown: "passed",
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await manager.disposeAgentRuntime();
  }
}

main().then(
  () => {
    clearTimeout(timeout);
    app.exit(0);
  },
  (error: unknown) => {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  },
);
