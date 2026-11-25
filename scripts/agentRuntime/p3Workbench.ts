import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { app, type BrowserWindow } from "electron";

const hostRequire = createRequire(__filename);
function production<T>(module: string): T {
  return hostRequire(path.join(app.getAppPath(), "dist/main", `${module}.js`)) as T;
}
async function until(check: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Native extension acceptance timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

/** Load a compiled extension through package discovery, the private port and the real composer. */
export async function checkP3Workbench(
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
  for (const row of runtime.listRuntimeSnapshots(true)) await sessions.close(row.sessionId);
  const workspace = path.join(app.getPath("userData"), "acceptance workspace 中文");
  const agentDir = production<{ getPiAgentDir(): string }>("session/piInfo").getPiAgentDir();
  assert(
    agentDir.startsWith(app.getPath("userData")),
    "Native package acceptance must use an isolated agent directory.",
  );
  const settingsFile = path.join(agentDir, "settings.json");
  let original: Buffer | undefined;
  try {
    original = await readFile(settingsFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const packageRoot = path.join(app.getPath("userData"), "native extension 包");
  await mkdir(packageRoot, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await copyFile(
    path.join(app.getAppPath(), "dist/agentRuntime/agentRuntime/examples/desktopExtension.js"),
    path.join(packageRoot, "desktop.js"),
  );
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: "native-acceptance",
      type: "module",
      pidesk: {
        runtime: {
          engine: "durable",
          apiVersion: 1,
          id: "example",
          entry: "./desktop.js",
          capabilities: ["agent", "commands"],
        },
      },
    }),
  );
  await writeFile(settingsFile, JSON.stringify({ packages: [packageRoot] }));
  production<{ invalidateCatalog(): void }>("extension/contributionCatalog").invalidateCatalog();
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    requests.push(JSON.parse(raw) as Record<string, unknown>);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const first = requests.length === 1;
    const delta = first
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "native-workspace",
              type: "function",
              function: { name: "example__workspace", arguments: "{}" },
            },
          ],
        }
      : { role: "assistant", content: "P3_NATIVE_OK" };
    response.write(
      `data: ${JSON.stringify({ id: "p3", object: "chat.completion.chunk", created: 1, model: "p3", choices: [{ index: 0, delta, finish_reason: first ? "tool_calls" : "stop" }] })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  production<{ saveDurableModel(value: unknown): unknown }>(
    "settings/durableStore",
  ).saveDurableModel({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    api: "openai-completions",
    apiKey: "local-p3-only",
    modelId: "p3",
    contextWindow: 128000,
    maxTokens: 1024,
    reasoning: false,
  });
  await sessions.updateModel();
  const command = "/example:review changes";
  try {
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='New task').click()",
    );
    await until(
      () => evaluate<boolean>("!!document.querySelector('[contenteditable=\"true\"]')"),
      "new task",
    );
    await evaluate("document.querySelector('[contenteditable=\"true\"]').focus()");
    await window.webContents.insertText("/example");
    await until(
      () =>
        evaluate<boolean>(
          "Array.from(document.querySelectorAll('[role=\"option\"]')).some(b=>b.textContent.includes('example:review'))",
        ),
      "native command completion",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('[role=\"option\"]')).find(b=>b.textContent.includes('example:review')).click()",
    );
    await window.webContents.insertText("changes");
    await until(
      () =>
        evaluate<boolean>("!!document.querySelector('button[aria-label=\"Send\"]:not(:disabled)')"),
      "send enabled",
    );
    await evaluate("document.querySelector('button[aria-label=\"Send\"]').click()");
    const hasAnswer = () =>
      evaluate<boolean>(
        "Array.from(document.querySelectorAll('[data-kind=\"assistant\"]')).some(el=>el.textContent.includes('P3_NATIVE_OK'))",
      );
    await until(hasAnswer, "native tool answer");
    await until(
      () => runtime.listRuntimeSnapshots().every((row) => row.state !== "busy"),
      "native session settled",
    );
    assert.equal(requests.length, 2);
    assert(
      JSON.stringify(requests[0]).includes(
        `Review the following work in ${workspace}`.replaceAll("\\", "\\\\"),
      ),
      "The model receives the expanded prompt.",
    );
    assert(JSON.stringify(requests[0]).includes("example__workspace"));
    assert(
      JSON.stringify(requests[1]).includes(workspace.replaceAll("\\", "\\\\")),
      "The tool returns the actual session workspace.",
    );
    assert(
      await evaluate<boolean>(
        `Array.from(document.querySelectorAll('[data-kind="user"]')).some(el=>el.textContent.includes(${JSON.stringify(command)}))`,
      ),
    );
    const row = runtime.listRuntimeSnapshots().find((item) => item.state === "idle");
    assert(row);
    const rejected = await evaluate<{ ok: boolean; error?: string }>(
      `window.pidesk.session.prompt({sessionId:${JSON.stringify(row.sessionId)},text:"/missing-native",streamingBehavior:"followUp"})`,
    );
    assert.equal(rejected.ok, false);
    assert(rejected.error?.includes("unavailable"));
    assert.equal(
      runtime.listRuntimeSnapshots().find((item) => item.sessionId === row.sessionId)?.state,
      "idle",
    );
    await sessions.close(row.sessionId);
    await new Promise<void>((resolve) => {
      window.webContents.once("did-finish-load", () => resolve());
      window.webContents.reload();
    });
    await until(
      () => evaluate<boolean>("!!document.querySelector('[data-project-row-hit]')"),
      "restored sidebar",
    );
    await evaluate(
      "document.querySelector('[data-project-row-hit][aria-expanded=\"false\"]')?.click()",
    );
    await until(
      () =>
        evaluate<boolean>(
          `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(command)})`,
        ),
      "command history title",
    );
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(command)}).click()`,
    );
    await until(hasAnswer, "native SQLite reopen");
    assert.equal(requests.length, 2);
    assert.equal(
      await evaluate<number>("document.querySelectorAll('[data-kind=\"user\"]').length"),
      1,
    );
    assert(
      await evaluate<boolean>(
        `Array.from(document.querySelectorAll('[data-kind="user"]')).some(el=>el.textContent.includes(${JSON.stringify(command)}))`,
      ),
    );
    await writeFile(
      path.join(
        path.dirname(reportPath),
        `${app.isPackaged ? "packaged" : "development"}-p3-native.png`,
      ),
      (await window.webContents.capturePage()).toPNG(),
    );
    return {
      packageDiscovery: "passed",
      nativeCommandCompletion: "passed",
      promptExpansion: "passed",
      nativeToolExecution: "passed",
      originalCommandHistory: "passed",
      unknownCommandSettlement: "passed",
      sqliteReopen: "passed",
      localRequests: requests.length,
    };
  } finally {
    for (const row of runtime.listRuntimeSnapshots(true))
      await sessions.close(row.sessionId).catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (original) await writeFile(settingsFile, original);
    else await rm(settingsFile, { force: true });
    production<{ invalidateCatalog(): void }>("extension/contributionCatalog").invalidateCatalog();
  }
}
