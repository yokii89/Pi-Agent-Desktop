import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { app, type BrowserWindow, dialog } from "electron";
import type { SessionSummary } from "../../src/shared/ipc";

const hostRequire = createRequire(__filename);
function production<T>(module: string): T {
  return hostRequire(path.join(app.getAppPath(), "dist/main", `${module}.js`)) as T;
}
async function until(check: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`P2 acceptance timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
function answer(response: ServerResponse, text: string, done = true) {
  response.write(
    `data: ${JSON.stringify({ id: "p2", object: "chat.completion.chunk", created: 1, model: "p2", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: done ? "stop" : null }] })}\n\n`,
  );
  if (done) response.end("data: [DONE]\n\n");
}

/** Actual renderer acceptance for P1 queue/retry/compaction plus P2 service consumers. */
export async function checkP2Workbench(
  window: BrowserWindow,
  reportPath: string,
): Promise<Record<string, unknown>> {
  const evaluate = <T>(source: string): Promise<T> =>
    window.webContents.executeJavaScript(source, true) as Promise<T>;
  const runtime = production<{
    listRuntimeSnapshots(hidden?: boolean): { sessionId: string; state: string }[];
    listLiveSessionSnapshots(): unknown[];
  }>("session/runtimeCoordinator");
  const sessions = production<{
    desktopSessions: { close(id: string): Promise<void>; updateModel(): Promise<void> };
  }>("agentRuntime/desktopSessions").desktopSessions;
  for (const row of runtime.listRuntimeSnapshots(true)) await sessions.close(row.sessionId);
  const workspace = path.join(app.getPath("userData"), "acceptance workspace 中文");
  await mkdir(workspace, { recursive: true });
  let scenario = "queue";
  let held: ServerResponse | undefined;
  let retry = 0;
  let compactions = 0;
  let calls = 0;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* Drain the actual model request. */
    }
    calls++;
    if (scenario === "retry" && retry++ === 0) {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ error: { message: "P2 temporary overload", type: "overloaded_error" } }),
      );
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    if (scenario === "queue" && !held) {
      held = response;
      answer(response, "P2_ACTIVE_PARTIAL", false);
    } else if (scenario === "compact") {
      compactions++;
      held = response;
      answer(response, "P2_COMPACT_SUMMARY", false);
    } else answer(response, scenario === "retry" ? "P2_RETRY_OK" : "P2_FOLLOWUP_OK");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const store = production<{
    saveDurableModel(value: unknown): unknown;
    durableCatalog(): SessionSummary[];
  }>("settings/durableStore");
  store.saveDurableModel({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    api: "openai-completions",
    apiKey: "local-p2-only",
    modelId: "p2",
    contextWindow: 128000,
    maxTokens: 1024,
    reasoning: false,
  });
  await sessions.updateModel();
  const newTask = async () => {
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='New task').click()",
    );
    await until(
      () => evaluate<boolean>("!!document.querySelector('[contenteditable=\"true\"]')"),
      "new task editor",
    );
  };
  const enter = async (text: string, queue = false) => {
    await evaluate("document.querySelector('[contenteditable=\"true\"]').focus()");
    await window.webContents.insertText(text);
    const label = queue ? "Queue message" : "Send";
    await until(
      () =>
        evaluate<boolean>(
          `!!document.querySelector('button[aria-label="${label}"]:not(:disabled)')`,
        ),
      label,
    );
    await evaluate(`document.querySelector('button[aria-label="${label}"]').click()`);
  };
  const hasAssistant = (text: string) =>
    evaluate<boolean>(
      `Array.from(document.querySelectorAll('[data-kind="assistant"]')).some(el=>el.textContent.includes(${JSON.stringify(text)}))`,
    );
  const screenshot = async (name: string) =>
    writeFile(
      path.join(
        path.dirname(reportPath),
        `${app.isPackaged ? "packaged" : "development"}-p2-${name}.png`,
      ),
      (await window.webContents.capturePage()).toPNG(),
    );
  try {
    await newTask();
    await enter("P2 queue active");
    await until(() => !!held, "active queue generation");
    await enter("P2 withdraw this", true);
    await until(
      () => evaluate<boolean>("!!document.querySelector('[data-queue-row=\"P2 withdraw this\"]')"),
      "queued row displayed",
    );
    await evaluate(
      'document.querySelector(\'[data-queue-row="P2 withdraw this"] [data-queue-action="delete"]\').click()',
    );
    await until(
      () => evaluate<boolean>("!document.querySelector('[data-queue-row=\"P2 withdraw this\"]')"),
      "queue item withdrawn",
    );
    await enter("/steer P2 steering", true);
    await until(
      () => evaluate<boolean>("!!document.querySelector('[data-queue-row=\"P2 steering\"]')"),
      "steering row displayed",
    );
    await enter("P2 follow-up", true);
    await until(
      () => evaluate<boolean>("!!document.querySelector('[data-queue-row=\"P2 follow-up\"]')"),
      "follow-up row displayed",
    );
    assert(runtime.listLiveSessionSnapshots().length > 0);
    await screenshot("queue");
    scenario = "finish";
    answer(held as ServerResponse, " P2_ACTIVE_OK");
    await until(() => hasAssistant("P2_FOLLOWUP_OK"), "queued inputs delivered");
    await until(
      () => runtime.listRuntimeSnapshots().every((row) => row.state !== "busy"),
      "queue settled",
    );
    assert(!(await evaluate<string>("document.body.innerText")).includes("Couldn't"));
    const queueSummary = store
      .durableCatalog()
      .find((item) => item.firstUserMessage === "P2 queue active");
    assert(queueSummary?.ref);
    const queueTranscript = await production<{
      sessionRepository: {
        transcript(ref: unknown): Promise<{ messages: { role: string; content: unknown }[] }>;
      };
    }>("session/sessionRepository").sessionRepository.transcript(queueSummary.ref);
    const queueUsers = queueTranscript.messages
      .filter((message) => message.role === "user")
      .map((message) => JSON.stringify(message.content));
    assert.equal(queueUsers.filter((text) => text.includes("P2 steering")).length, 1);
    assert.equal(queueUsers.filter((text) => text.includes("P2 follow-up")).length, 1);
    assert(!queueUsers.some((text) => text.includes("P2 withdraw this")));

    scenario = "retry";
    await newTask();
    await enter("P2 retry");
    await until(() => retry === 1, "first failed model attempt");
    await until(
      () => evaluate<boolean>("document.body.innerText.includes('Auto retry 2/3')"),
      "retry status rendered",
    );
    await screenshot("retry");
    await until(() => hasAssistant("P2_RETRY_OK"), "retry recovered in UI");
    await until(
      () => runtime.listRuntimeSnapshots().every((row) => row.state !== "busy"),
      "retry settled",
    );
    assert.equal(retry, 2);

    scenario = "finish";
    await enter(`P2 compact preparation ${"context ".repeat(11000)}`);
    await until(() => hasAssistant("P2_FOLLOWUP_OK"), "compaction preparation saved");
    await until(
      () => runtime.listRuntimeSnapshots().every((row) => row.state !== "busy"),
      "compaction preparation settled",
    );
    scenario = "compact";
    held = undefined;
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Compact context').click()",
    );
    await until(() => compactions === 1, "manual compaction request");
    await until(
      () => evaluate<boolean>("document.body.innerText.includes('Manual context compact…')"),
      "compaction pending UI",
    );
    assert(runtime.listRuntimeSnapshots().some((row) => row.state === "busy"));
    await screenshot("compaction");
    answer(held as unknown as ServerResponse, " complete");
    await until(
      () => runtime.listRuntimeSnapshots().every((row) => row.state !== "busy"),
      "compaction settled",
    );
    assert(!(await evaluate<string>("document.body.innerText")).includes("Compaction failed"));

    // Repository readers must leave closed SQLite cold and never issue another model call.
    const summaries = store.durableCatalog();
    const saved = summaries.find((item) => item.firstUserMessage === "P2 retry");
    assert(saved?.ref);
    for (const row of runtime.listRuntimeSnapshots(true)) await sessions.close(row.sessionId);
    const before = calls;
    const repository = production<{
      sessionRepository: { transcript(ref: unknown): Promise<{ messages: unknown[] }> };
    }>("session/sessionRepository").sessionRepository;
    assert((await repository.transcript(saved.ref)).messages.length >= 2);
    assert.equal(calls, before);
    assert.equal(runtime.listLiveSessionSnapshots().length, 0);

    // Legacy fixture lives under this isolated profile, never the user's agent directory.
    const oldRoot = production<{ getPiAgentDir(): string }>("session/piInfo").getPiAgentDir;
    const originalRoot = oldRoot();
    // The acceptance host sets PI_CODING_AGENT_DIR to its isolated profile before module loading.
    assert(
      originalRoot.startsWith(app.getPath("userData")),
      "Legacy acceptance must use the isolated agent directory.",
    );
    const encoding = production<{ encodeCwdToSessionDir(cwd: string): string }>(
      "session/sessionHistory",
    ).encodeCwdToSessionDir;
    const legacyDir = path.join(originalRoot, "sessions", encoding(workspace));
    await mkdir(legacyDir, { recursive: true });
    const legacyFile = path.join(legacyDir, "p2-legacy.jsonl");
    const records = [
      { type: "session", id: "p2-legacy", cwd: workspace, timestamp: new Date().toISOString() },
      ...Array.from({ length: 205 }, (_, i) => ({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: `P2_OLD_${i}` }] },
      })),
    ];
    await writeFile(legacyFile, `${records.map((row) => JSON.stringify(row)).join("\n")}\n`);
    const original = await readFile(legacyFile);
    // Use preload for boundary checks, then drive history opening through the sidebar after reload.
    const start = await evaluate<{ ok: boolean; error?: string }>(
      `window.pidesk.session.start({sessionFile:${JSON.stringify(legacyFile)},cwd:${JSON.stringify(workspace)}})`,
    );
    assert.equal(start.ok, false);
    assert(start.error?.includes("read-only"));
    const first = await evaluate<{
      ok: boolean;
      data: { nextBefore: number; messages: unknown[] };
    }>(`window.pidesk.session.readTranscript(${JSON.stringify(legacyFile)})`);
    assert(first.ok && first.data.messages.length === 100);
    const second = await evaluate<{ ok: boolean; data: { messages: unknown[] } }>(
      `window.pidesk.session.readTranscript(${JSON.stringify(legacyFile)},${first.data.nextBefore})`,
    );
    assert(second.ok && second.data.messages.length === 100);
    assert.deepEqual(await readFile(legacyFile), original);
    await new Promise<void>((resolve) => {
      window.webContents.once("did-finish-load", () => resolve());
      window.webContents.reload();
    });
    await until(
      () => evaluate<boolean>("!!document.querySelector('[data-project-row-hit]')"),
      "legacy sidebar project",
    );
    await evaluate(
      "document.querySelector('[data-project-row-hit][aria-expanded=\"false\"]')?.click()",
    );
    await until(
      () =>
        evaluate<boolean>(
          "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='P2_OLD_0')",
        ),
      "legacy sidebar entry",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='P2_OLD_0').click()",
    );
    await until(
      () =>
        evaluate<boolean>(
          "document.body.innerText.includes('Legacy history is read-only.') && document.querySelectorAll('[data-kind=\"user\"]').length===100",
        ),
      "legacy read-only UI",
    );
    assert.equal(
      await evaluate<boolean>("!!document.querySelector('[contenteditable=\"true\"]')"),
      false,
    );
    for (const count of [200, 205]) {
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Load earlier history').click()",
      );
      await until(
        () =>
          evaluate<boolean>(`document.querySelectorAll('[data-kind="user"]').length===${count}`),
        "legacy earlier page",
      );
    }
    await screenshot("legacy");
    const saveDialog = dialog.showSaveDialog;
    try {
      for (const [format, method, key] of [
        ["md", "exportMarkdown", saved.file],
        ["html", "exportHtml", saved.file],
        ["md", "exportMarkdown", legacyFile],
        ["html", "exportHtml", legacyFile],
      ]) {
        const target = path.join(
          path.dirname(reportPath),
          `${app.isPackaged ? "packaged" : "development"}-p2-${key === legacyFile ? "legacy" : "durable"}.${format}`,
        );
        dialog.showSaveDialog = (async () => ({
          canceled: false,
          filePath: target,
        })) as typeof dialog.showSaveDialog;
        const result = await evaluate<{ ok: boolean }>(
          `window.pidesk.session.${method}({file:${JSON.stringify(key)},title:"P2 export"})`,
        );
        assert(result.ok, `${method} must export saved history.`);
        assert(
          (await readFile(target, "utf8")).includes(
            key === legacyFile ? "P2_OLD_0" : "P2_RETRY_OK",
          ),
        );
      }
    } finally {
      dialog.showSaveDialog = saveDialog;
    }
    assert.deepEqual(await readFile(legacyFile), original);
    return {
      queueWithdrawal: "passed",
      steeringAndFollowUp: "passed",
      automaticRetry: "passed",
      manualCompaction: "passed",
      coldRepositoryRead: "passed",
      legacyReadOnlyAndPaging: "passed",
      legacyReadOnlyUi: "passed",
      durableAndLegacyExport: "passed",
      localRequests: calls,
    };
  } finally {
    held?.destroy();
    for (const row of runtime.listRuntimeSnapshots(true))
      await sessions.close(row.sessionId).catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
