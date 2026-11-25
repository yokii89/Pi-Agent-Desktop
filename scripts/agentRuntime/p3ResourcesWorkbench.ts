import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { app, type BrowserWindow } from "electron";
import type { IpcResult, PiSlashCommand, SessionSummary } from "../../src/shared/ipc";

const hostRequire = createRequire(__filename);
function production<T>(module: string): T {
  return hostRequire(path.join(app.getAppPath(), "dist/main", `${module}.js`)) as T;
}
async function until(check: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Resource acceptance timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
async function previous(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

/** Real composer completion, private-port expansion and SQLite recovery in Electron and ASAR. */
export async function checkP3ResourcesWorkbench(
  window: BrowserWindow,
  reportPath: string,
): Promise<Record<string, unknown>> {
  const evaluate = <T>(source: string): Promise<T> =>
    window.webContents.executeJavaScript(source, true) as Promise<T>;
  const runtime = production<{
    listRuntimeSnapshots(hidden?: boolean): { sessionId: string; state: string }[];
  }>("session/runtimeCoordinator");
  const sessions = production<{
    desktopSessions: { close(id: string): Promise<void>; updateModel(): Promise<void> };
  }>("agentRuntime/desktopSessions").desktopSessions;
  const store = production<{
    saveDurableModel(value: unknown): unknown;
    durableCatalog(): SessionSummary[];
  }>("settings/durableStore");
  for (const row of runtime.listRuntimeSnapshots(true)) await sessions.close(row.sessionId);
  const workspace = path.join(app.getPath("userData"), "acceptance workspace 中文");
  const agentDir = production<{ getPiAgentDir(): string }>("session/piInfo").getPiAgentDir();
  assert(agentDir.startsWith(app.getPath("userData")));
  assert.equal(app.getPath("home"), app.getPath("userData"));
  const settingsFile = path.join(agentDir, "settings.json");
  const instructionsFile = path.join(workspace, "AGENTS.md");
  const originalSettings = await previous(settingsFile);
  const originalInstructions = await previous(instructionsFile);
  const packageRoot = path.join(app.getPath("userData"), "resource package 中文");
  const skillFile = path.join(packageRoot, "skills/acceptance/SKILL.md");
  await mkdir(path.dirname(skillFile), { recursive: true });
  await mkdir(path.join(agentDir, "prompts"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "resource-acceptance", pi: { skills: ["./skills/acceptance"] } }),
  );
  const skill = (version: string) =>
    `---\nname: acceptance\ndescription: Validate Durable skills\n---\nP3_SKILL_BODY_${version}\nRead references/check.md relative to this skill directory.`;
  await writeFile(skillFile, skill("V1"));
  const promptFile = path.join(agentDir, "prompts/audit.md");
  await writeFile(
    promptFile,
    "---\ndescription: Audit selected files\n---\nP3_TEMPLATE $1 :: $2 :: $ARGUMENTS",
  );
  await writeFile(settingsFile, JSON.stringify({ packages: [packageRoot] }));
  await writeFile(instructionsFile, "P3_RESOURCE_INSTRUCTIONS_V1");
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    requests.push(JSON.parse(raw) as Record<string, unknown>);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({ id: "p3-resources", object: "chat.completion.chunk", created: 1, model: "p3-resources", choices: [{ index: 0, delta: { role: "assistant", content: `P3_RESOURCE_OK_${requests.length}` }, finish_reason: "stop" }] })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  store.saveDurableModel({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    api: "openai-completions",
    apiKey: "local-resource-only",
    modelId: "p3-resources",
    contextWindow: 128000,
    maxTokens: 1024,
    reasoning: false,
  });
  await sessions.updateModel();
  const reload = async () => {
    await new Promise<void>((resolve) => {
      window.webContents.once("did-finish-load", () => resolve());
      window.webContents.reload();
    });
    await until(
      () =>
        evaluate<boolean>(
          "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='New task')",
        ),
      "workbench reload",
    );
  };
  const compose = async (name: string, args: string) => {
    await until(
      () => evaluate<boolean>("!!document.querySelector('[contenteditable=\"true\"]')"),
      "composer",
    );
    await evaluate("document.querySelector('[contenteditable=\"true\"]').focus()");
    await window.webContents.insertText(`/${name}`);
    await until(
      () =>
        evaluate<boolean>(
          `Array.from(document.querySelectorAll('[role="option"]')).some(b=>b.textContent.includes(${JSON.stringify(name)}))`,
        ),
      `${name} completion`,
    );
    await evaluate(
      `Array.from(document.querySelectorAll('[role="option"]')).find(b=>b.textContent.includes(${JSON.stringify(name)})).click()`,
    );
    await window.webContents.insertText(args);
    await until(
      () =>
        evaluate<boolean>("!!document.querySelector('button[aria-label=\"Send\"]:not(:disabled)')"),
      "send enabled",
    );
    await evaluate("document.querySelector('button[aria-label=\"Send\"]').click()");
  };
  try {
    await reload();
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='New task').click()",
    );
    await compose("skill:acceptance", "changes");
    await until(
      () =>
        evaluate<boolean>(
          "Array.from(document.querySelectorAll('[data-kind=\"assistant\"]')).some(el=>el.textContent.includes('P3_RESOURCE_OK_1'))",
        ),
      "skill answer",
    );
    await until(
      () => runtime.listRuntimeSnapshots().every((row) => row.state !== "busy"),
      "skill settled",
    );
    assert.equal(requests.length, 1);
    assert(JSON.stringify(requests[0]).includes("P3_SKILL_BODY_V1"));
    assert(JSON.stringify(requests[0]).includes("P3_RESOURCE_INSTRUCTIONS_V1"));
    assert(JSON.stringify(requests[0]).includes("Base directory:"));
    const summary = store
      .durableCatalog()
      .find((item) => item.firstUserMessage === "/skill:acceptance changes");
    assert(summary);
    await compose("audit", '"api server" security');
    await until(
      () =>
        evaluate<boolean>(
          "Array.from(document.querySelectorAll('[data-kind=\"assistant\"]')).some(el=>el.textContent.includes('P3_RESOURCE_OK_2'))",
        ),
      "template answer",
    );
    await until(
      () => runtime.listRuntimeSnapshots().every((row) => row.state !== "busy"),
      "template settled",
    );
    assert.equal(requests.length, 2);
    assert(
      JSON.stringify(requests[1]).includes(
        "P3_TEMPLATE api server :: security :: api server security",
      ),
    );
    assert(
      await evaluate<boolean>(
        "Array.from(document.querySelectorAll('[data-kind=\"user\"]')).some(el=>el.textContent.includes('/skill:acceptance changes'))",
      ),
    );
    assert(
      await evaluate<boolean>(
        "Array.from(document.querySelectorAll('[data-kind=\"user\"]')).some(el=>el.textContent.includes('/audit'))",
      ),
    );
    await writeFile(
      path.join(
        path.dirname(reportPath),
        `${app.isPackaged ? "packaged" : "development"}-p3-resources.png`,
      ),
      (await window.webContents.capturePage()).toPNG(),
    );
    for (const row of runtime.listRuntimeSnapshots(true)) await sessions.close(row.sessionId);
    await writeFile(instructionsFile, "P3_RESOURCE_INSTRUCTIONS_V2");
    await writeFile(skillFile, skill("V2"));
    const reopened = await evaluate<IpcResult<string>>(
      `window.pidesk.session.start({sessionFile:${JSON.stringify(summary.file)},cwd:${JSON.stringify(workspace)}})`,
    );
    assert(reopened.ok && reopened.data);
    const commands = await evaluate<IpcResult<PiSlashCommand[]>>(
      `window.pidesk.session.getCommands(${JSON.stringify(reopened.data)})`,
    );
    assert(commands.ok && commands.data);
    assert(
      commands.data.some(
        (command) =>
          command.name === "skill:acceptance" &&
          command.source === "skill" &&
          command.filePath === skillFile,
      ),
    );
    const sent = await evaluate<IpcResult<unknown>>(
      `window.pidesk.session.prompt({sessionId:${JSON.stringify(reopened.data)},text:"/skill:acceptance recovered"})`,
    );
    assert(sent.ok);
    await until(
      () =>
        requests.length === 3 &&
        runtime.listRuntimeSnapshots().every((row) => row.state !== "busy"),
      "resource SQLite recovery",
    );
    assert(JSON.stringify(requests[2]).includes("P3_RESOURCE_INSTRUCTIONS_V2"));
    assert(JSON.stringify(requests[2]).includes("P3_SKILL_BODY_V2"));
    return {
      skillCompletion: "passed",
      templateCompletion: "passed",
      skillExpansion: "passed",
      templateArguments: "passed",
      originalCommandHistory: "passed",
      instructionsRefreshedBeforeRecovery: "passed",
      reopenedCommandCatalog: "passed",
      localRequests: requests.length,
    };
  } finally {
    for (const row of runtime.listRuntimeSnapshots(true))
      await sessions.close(row.sessionId).catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (originalSettings) await writeFile(settingsFile, originalSettings);
    else await rm(settingsFile, { force: true });
    if (originalInstructions) await writeFile(instructionsFile, originalInstructions);
    else await rm(instructionsFile, { force: true });
    await rm(promptFile, { force: true });
  }
}
