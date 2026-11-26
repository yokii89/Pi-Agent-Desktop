import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { app, type BrowserWindow } from "electron";
import type { RuntimeModelConfig } from "../../src/shared/durableProtocol";
import type { PideskSettings, SessionPushMessage, SessionSummary } from "../../src/shared/ipc";
import { checkBuiltinsWorkbench } from "./builtinsWorkbench";
import { checkImageWorkbench } from "./imageWorkbench";
import { checkInteractionsWorkbench } from "./interactionsWorkbench";
import { checkNewApiWorkbench } from "./newApiWorkbench";
import { checkP2Workbench } from "./p2Workbench";
import { checkP3ResourcesWorkbench } from "./p3ResourcesWorkbench";
import { checkP3ViewsWorkbench } from "./p3ViewsWorkbench";
import { checkP3Workbench } from "./p3Workbench";

interface HostManager {
  request(command: { op: "snapshot"; sessionId: string }): Promise<unknown>;
  subscribe(update: (value: unknown) => void, fault: (error: Error) => void): () => void;
}

const hostRequire = createRequire(__filename);
function production<T>(module: string): T {
  return hostRequire(path.join(app.getAppPath(), "dist/main", `${module}.js`)) as T;
}

async function until(check: () => boolean | Promise<boolean>, label: string, ms = 20_000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function chunk(response: ServerResponse, delta: unknown, finish: string | null = null): void {
  response.write(
    `data: ${JSON.stringify({ id: "chat-workbench", object: "chat.completion.chunk", created: 1, model: "desktop-acceptance", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
  );
}
function finish(response: ServerResponse): void {
  response.end("data: [DONE]\n\n");
}

/** Exercise the built renderer, preload, production IPC and isolated utility writer together. */
export async function checkWorkbench(
  reportPath: string,
  getWriter: () => Electron.UtilityProcess | undefined,
): Promise<Record<string, unknown>> {
  const directory = path.join(app.getPath("userData"), "acceptance workspace 中文");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "fixture.txt"), "Workbench tool result from disk.");
  const reply = `WORKBENCH_OK_${randomUUID().replaceAll("-", "")}`;
  const recoveredReply = `RECOVERED_OK_${randomUUID().replaceAll("-", "")}`;
  const prompt = `Read fixture.txt for desktop acceptance ${randomUUID()}.`;
  const pushes: SessionPushMessage[] = [];
  const requests: Record<string, unknown>[] = [];
  let held = false;
  let resumed = false;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(request.headers.authorization, "Bearer local-acceptance-only");
      let body = "";
      for await (const value of request) body += String(value);
      const parsed = JSON.parse(body) as Record<string, unknown>;
      requests.push(parsed);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      if (requests.length === 1) {
        chunk(response, { role: "assistant", content: "Reading fixture." });
        chunk(response, {
          tool_calls: [
            {
              index: 0,
              id: "read-acceptance",
              type: "function",
              function: { name: "read", arguments: '{"path":"fixture.txt"}' },
            },
          ],
        });
        chunk(response, {}, "tool_calls");
        finish(response);
      } else if (requests.length === 2) {
        assert(JSON.stringify(parsed).includes("Workbench tool result from disk."));
        chunk(response, { role: "assistant", content: reply });
        chunk(response, {}, "stop");
        finish(response);
      } else if (!resumed) {
        held = true;
        chunk(response, { role: "assistant", content: "FAULT_INJECTION_PARTIAL" });
      } else {
        chunk(response, { role: "assistant", content: recoveredReply });
        chunk(response, {}, "stop");
        finish(response);
      }
    } catch {
      response.destroy(new Error("Invalid workbench acceptance request."));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const store = production<{
    saveDurableModel(value: RuntimeModelConfig): unknown;
    durableCatalog(): SessionSummary[];
  }>("settings/durableStore");
  const settings = production<{ updateSettings(value: Partial<PideskSettings>): unknown }>(
    "settings/settings",
  );
  const manager = production<{ agentRuntimeManager: HostManager }>(
    "agentRuntime/agentRuntimeManager",
  ).agentRuntimeManager;
  const sessions = production<{
    desktopSessions: { close(id: string): Promise<void>; updateModel(): Promise<void> };
  }>("agentRuntime/desktopSessions").desktopSessions;
  const unsubscribe = production<{
    subscribeSessionEvents(listener: (push: SessionPushMessage) => void): () => void;
  }>("session/sessionEvents").subscribeSessionEvents((message) => pushes.push(message));
  settings.updateSettings({
    locale: "en-US",
    splashEnabled: false,
    showInTray: false,
    projects: [{ id: "acceptance", name: "Acceptance workspace", dir: directory }],
    lastProjectId: "acceptance",
  });
  store.saveDurableModel({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    api: "openai-completions",
    apiKey: "local-acceptance-only",
    modelId: "desktop-acceptance",
    contextWindow: 128000,
    maxTokens: 1024,
    reasoning: false,
  });
  production<{ registerIpc(): void }>("ipc/index").registerIpc();
  let win: BrowserWindow | undefined;
  const faultMessages: string[] = [];
  const unsubscribeFault = manager.subscribe(
    () => {},
    (error) => faultMessages.push(error.message),
  );
  try {
    await production<{ desktopSessions: { initialize(): Promise<void> } }>(
      "agentRuntime/desktopSessions",
    ).desktopSessions.initialize();
    win = production<{ createMainWindow(): BrowserWindow }>(
      "window/createMainWindow",
    ).createMainWindow();
    const window = win;
    const evaluate = <T>(source: string): Promise<T> =>
      window.webContents.executeJavaScript(source, true) as Promise<T>;
    const text = (): Promise<string> => evaluate<string>("document.body.innerText");
    const assistantHas = (value: string): Promise<boolean> =>
      evaluate<boolean>(
        `Array.from(document.querySelectorAll('[data-kind="assistant"]')).some(el => el.textContent.includes(${JSON.stringify(value)}))`,
      );
    const ready = () =>
      until(
        () =>
          evaluate<boolean>(
            "!!document.querySelector('[contenteditable=\"true\"]') && !!window.pidesk",
          ),
        "workbench ready",
      );
    const newTask = async () => {
      await until(
        () =>
          evaluate<boolean>(
            "!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'New task')",
          ),
        "new task button",
      );
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'New task').click()",
      );
      await ready();
    };
    const send = async (message: string) => {
      await evaluate("document.querySelector('[contenteditable=\"true\"]').focus()");
      await window.webContents.insertText(message);
      await until(
        () =>
          evaluate<boolean>(
            "!!document.querySelector('button[aria-label=\"Send\"]:not(:disabled)')",
          ),
        "enabled Send button",
      );
      await evaluate("document.querySelector('button[aria-label=\"Send\"]').click()");
    };
    const expandHistory = async () => {
      await until(
        () => evaluate<boolean>("!!document.querySelector('[data-project-row-hit]')"),
        "project history toggle",
      );
      await evaluate(
        "document.querySelector('[data-project-row-hit][aria-expanded=\"false\"]')?.click()",
      );
    };
    const reload = async () => {
      await new Promise<void>((resolve) => {
        window.webContents.once("did-finish-load", () => resolve());
        window.webContents.reload();
      });
      await ready();
    };
    const openHistory = async () => {
      await expandHistory();
      await until(
        () =>
          evaluate<boolean>(
            `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${JSON.stringify(prompt)})`,
          ),
        "saved sidebar history",
      );
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(prompt)}).click()`,
      );
    };
    await ready();
    if (process.env.PIDESK_RUNTIME_CHECK_EXTENSIONS_ONLY === "1")
      return { extensions: await checkP3ViewsWorkbench(window, reportPath) };
    if (process.env.PIDESK_RUNTIME_CHECK_NEWAPI_ONLY === "1")
      return { newapi: await checkNewApiWorkbench(window, reportPath) };
    await newTask();
    await send(prompt);
    await until(() => assistantHas(reply), "saved assistant rendered");
    await until(
      () => pushes.some((push) => push.type === "event" && push.payload.type === "agent_settled"),
      "completed run settlement",
    );
    assert.equal(requests.length, 2);
    assert.equal(
      await evaluate<number>("document.querySelectorAll('[data-kind=\"user\"]').length"),
      1,
    );
    assert((await text()).includes("fixture.txt"));
    const summary = store.durableCatalog().find((item) => item.firstUserMessage === prompt);
    assert(summary, "UI-created session must be in the durable catalog.");
    const sessionId = pushes.find(
      (push) => push.type === "event" && push.payload.type === "agent_settled",
    )?.sessionId;
    assert(sessionId);
    const countBeforeReload = pushes.filter(
      (push) => push.type === "event" && push.payload.type === "message_end",
    ).length;
    await reload();
    await openHistory();
    await until(() => assistantHas(reply), "renderer reload hydration");
    assert.equal(requests.length, 2, "Hydration must not issue another model request.");
    assert.equal(
      pushes.filter((push) => push.type === "event" && push.payload.type === "message_end").length,
      countBeforeReload,
    );
    await sessions.close(sessionId);
    await newTask();
    await openHistory();
    await until(() => assistantHas(reply), "SQLite close and reopen in UI");
    assert.equal(requests.length, 2);
    assert.equal(
      await evaluate<number>("document.querySelectorAll('[data-kind=\"user\"]').length"),
      1,
    );
    await writeFile(
      path.join(
        path.dirname(reportPath),
        `${app.isPackaged ? "packaged" : "development"}-restored.png`,
      ),
      (await window.webContents.capturePage()).toPNG(),
    );
    console.log("Workbench creation, send, tool execution and history restoration passed.");

    const writer = getWriter();
    assert(writer, "Capture the exact production utility process before fault injection.");
    const faultStart = pushes.length;
    await send("Hold this generation for a utility process failure acceptance check.");
    await until(() => held, "provider generation in progress");
    await until(
      () => evaluate<boolean>("!!document.querySelector('button[aria-label=\"Stop\"]')"),
      "running UI before failure",
    );
    const pending = manager.request({ op: "snapshot", sessionId: summary.id });
    assert(writer.kill(), "Exact verification utility process must be terminated.");
    await assert.rejects(pending, /exited|unavailable/i);
    await until(() => faultMessages.length > 0, "manager fault notification");
    await until(
      () => pushes.slice(faultStart).some((push) => push.type === "exit" && push.payload !== 0),
      "session fault exit envelope",
    );
    assert.equal(pushes.slice(faultStart).filter((push) => push.type === "exit").length, 1);
    assert.equal(pushes.slice(faultStart).filter((push) => push.type === "error").length, 1);
    await until(
      () =>
        evaluate<boolean>(
          "!!document.querySelector('button[aria-label=\"Send\"]') && !document.querySelector('button[aria-label=\"Stop\"]')",
        ),
      "UI leaves running state",
    );
    assert((await text()).includes("Interrupted"), "The crashed run must have a terminal status.");
    await until(
      () => evaluate<boolean>("!!document.querySelector('[role=\"alert\"]')"),
      "fault displayed in transcript",
    );
    await writeFile(
      path.join(
        path.dirname(reportPath),
        `${app.isPackaged ? "packaged" : "development"}-fault.png`,
      ),
      (await window.webContents.capturePage()).toPNG(),
    );
    resumed = true;
    await newTask();
    await openHistory();
    await until(
      () => assistantHas(recoveredReply),
      "interrupted SQLite work resumes after writer restart",
    );
    await until(
      () =>
        pushes
          .slice(faultStart)
          .some((push) => push.type === "event" && push.payload.type === "agent_settled"),
      "recovered run settles",
    );
    assert(await assistantHas(reply), "Previously saved answer must survive process failure.");
    assert.equal(
      await evaluate<number>("document.querySelectorAll('[data-kind=\"user\"]').length"),
      2,
    );
    console.log("Utility process failure settlement and SQLite recovery passed.");
    const result: Record<string, unknown> = {
      createAndSend: "passed",
      toolExecution: "passed",
      rendererReload: "passed",
      sqliteReopen: "passed",
      noHistoryReplay: "passed",
      utilityFaultSettlement: "passed",
      pendingRequestSettlement: "passed",
      utilityRecovery: "passed",
      localRequests: requests.length,
      sessionRef: summary.ref,
      renderedUsers: await evaluate<number>(
        "document.querySelectorAll('[data-kind=\"user\"]').length",
      ),
    };
    result.p2 = await checkP2Workbench(window, reportPath);
    result.images = await checkImageWorkbench(window, reportPath);
    result.p3 = await checkP3Workbench(window, reportPath);
    result.p3Resources = await checkP3ResourcesWorkbench(window, reportPath);
    result.p3Views = await checkP3ViewsWorkbench(window, reportPath);
    result.builtins = await checkBuiltinsWorkbench(window, reportPath);
    result.interactions = await checkInteractionsWorkbench(window, reportPath, getWriter);
    result.newapi = await checkNewApiWorkbench(window, reportPath);
    const liveAuth = process.env.PIDESK_RUNTIME_CHECK_LIVE_AUTH;
    if (liveAuth) {
      // Explicit --live authorization only. Read credentials in main and never serialize them to logs or reports.
      const saved = JSON.parse(await readFile(liveAuth, "utf8")) as {
        newapi?: { access?: string; baseUrl?: string; api?: string; preferredModel?: string };
      };
      const account = saved.newapi;
      assert(
        account?.access && account.baseUrl && account.preferredModel,
        "No configured public gateway account.",
      );
      assert(account.api === "openai-responses" || account.api === "openai-completions");
      const url = new URL(account.baseUrl);
      assert.equal(url.protocol, "https:");
      if (!url.pathname.endsWith("/v1")) url.pathname = `${url.pathname.replace(/\/$/, "")}/v1`;
      const liveModel: RuntimeModelConfig = {
        baseUrl: url.href.replace(/\/$/, ""),
        api: account.api,
        apiKey: account.access,
        modelId: account.preferredModel,
        contextWindow: 128000,
        maxTokens: 256,
        reasoning: false,
      };
      for (const id of new Set(
        pushes.filter((push) => push.type !== "exit").map((push) => push.sessionId),
      ))
        await sessions.close(id);
      store.saveDurableModel(liveModel);
      await sessions.updateModel();
      await newTask();
      const marker = `PUBLIC_OK_${randomUUID().replaceAll("-", "")}`;
      const liveStart = pushes.length;
      console.log(
        `Sending a real public model request to ${url.host} (${account.preferredModel}).`,
      );
      await send(`Reply with exactly ${marker}. Do not call any tools.`);
      await until(() => assistantHas(marker), "real public provider answer in workbench", 100_000);
      await until(
        () =>
          pushes
            .slice(liveStart)
            .some((push) => push.type === "event" && push.payload.type === "agent_settled"),
        "real public provider settlement",
        20_000,
      );
      const liveSummary = store
        .durableCatalog()
        .find((item) => item.firstUserMessage?.includes(marker));
      assert(liveSummary);
      result.publicProvider = {
        host: url.host,
        api: account.api,
        model: account.preferredModel,
        response: marker,
        status: "passed",
      };
      await writeFile(
        path.join(path.dirname(reportPath), "public-provider.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      await reload();
      await expandHistory();
      await until(
        () =>
          evaluate<boolean>(
            `Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes(${JSON.stringify(marker)}))`,
          ),
        "public session in history",
      );
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes(${JSON.stringify(marker)})).click()`,
      );
      await until(() => assistantHas(marker), "real public response restored from SQLite");
      result.publicProviderRestore = "passed";
      console.log("Real public model request, UI settlement and saved history restoration passed.");
    }
    return result;
  } catch (error) {
    if (win && !win.isDestroyed()) {
      await writeFile(
        path.join(path.dirname(reportPath), "workbench-failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      const body = await win.webContents.executeJavaScript("document.body.innerText");
      await writeFile(path.join(path.dirname(reportPath), "workbench-failure.txt"), String(body));
    }
    throw error;
  } finally {
    unsubscribe();
    unsubscribeFault();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Any explicitly authorized real credential was persisted only with safeStorage in this isolated profile.
    await rm(path.join(app.getPath("userData"), "durable/v1/model.bin"), { force: true });
  }
}
