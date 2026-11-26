import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { app, utilityProcess } from "electron";
import { checkWorkbench } from "./workbench";

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
app.setPath("userData", mkdtempSync(path.join(path.dirname(reportPath), "profile-")));
app.setPath("home", app.getPath("userData"));
process.env.PI_CODING_AGENT_DIR = path.join(app.getPath("userData"), "legacy-agent");

const hostRequire = createRequire(__filename);
const timeout = setTimeout(() => {
  console.error("Electron Durable verification timed out.");
  app.exit(1);
}, 300_000);

async function main(): Promise<void> {
  await app.whenReady();
  for (const retired of [
    "session/piSession",
    "session/piLauncher",
    "session/piModelList",
    "session/sessionIpc",
    "session/piAuth",
    "session/piCredentials",
    "session/piSettings",
    "extension/packageCli",
    "extension/extensionWorkerArgs",
    "extension/workerSafe",
    "mcp/mcpProbe",
    "mcp/piVersion",
    "models/modelOverridesIpc",
  ])
    assert(
      !existsSync(path.join(app.getAppPath(), "dist/main", `${retired}.js`)),
      `Retired executor was packaged: ${retired}`,
    );
  for (const name of ["plugin-creator", "skill-creator"])
    assert(
      readFileSync(path.join(app.getAppPath(), "assets/skills", name, "SKILL.md"), "utf8").includes(
        "Durable",
      ),
    );
  assert(
    readFileSync(
      path.join(app.getAppPath(), "assets/skills/plugin-creator/references/durable-extension.md"),
      "utf8",
    ).includes('"engine": "durable"'),
  );
  if (app.isPackaged) assert(!existsSync(path.join(app.getAppPath(), "vendor/MyPiExtension")));
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

  const originalFork = utilityProcess.fork;
  let writer: Electron.UtilityProcess | undefined;
  utilityProcess.fork = (...args: Parameters<typeof utilityProcess.fork>) => {
    const child = originalFork(...args);
    if (args[2]?.serviceName === "PiDesk Durable Agent Runtime") writer = child;
    return child;
  };
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
    const workbench = await checkWorkbench(reportPath, () => writer);
    await (
      hostRequire(path.join(app.getAppPath(), "dist/main/extension/extensionWorkerManager.js")) as {
        disposeExtensionWorker(): Promise<void>;
      }
    ).disposeExtensionWorker();
    await manager.disposeAgentRuntime();
    await assert.rejects(manager.startAgentRuntime(), /closing/);
    const report = `${JSON.stringify(
      {
        packaged: app.isPackaged,
        appPath: app.getAppPath(),
        electron: process.versions.electron,
        utilityNode: first.nodeVersion,
        dependencies: { googleGenaiImport: "passed", protobufRoundTrip: "passed" },
        nativeBoundary: {
          retiredExecutors: "absent",
          bundledDurableSkills: "passed",
          archivedExtensions: app.isPackaged ? "excluded" : "source-only",
        },
        ...result,
        workbench,
        shutdown: "passed",
      },
      null,
      2,
    )}\n`;
    await writeFile(reportPath, report);
    if (workbench.publicProvider) {
      await writeFile(path.join(path.dirname(reportPath), "public-provider.json"), report);
    }
  } finally {
    utilityProcess.fork = originalFork;
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
