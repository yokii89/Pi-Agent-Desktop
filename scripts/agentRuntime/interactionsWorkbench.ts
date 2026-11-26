import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { app, type BrowserWindow } from "electron";
import type { IpcResult } from "../../src/shared/ipc";
import type { NativeJob, NativeSessionState, PlanAction } from "../../src/shared/nativeBuiltins";

const hostRequire = createRequire(__filename);
function production<T>(module: string): T {
  return hostRequire(path.join(app.getAppPath(), "dist/main", `${module}.js`)) as T;
}
async function until(check: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Interaction acceptance timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
function unwrap<T>(result: IpcResult<T>): T {
  assert(result.ok && result.data !== undefined, result.error);
  return result.data;
}

/** Drive persistent interactions and process controls through the actual desktop and private runtime port. */
export async function checkInteractionsWorkbench(
  window: BrowserWindow,
  reportPath: string,
  getWriter: () => Electron.UtilityProcess | undefined,
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
  assert(workspace.startsWith(app.getPath("userData")));
  const questions = [
    {
      header: "Storage",
      question: "Which storage?",
      options: [
        { label: "SQLite", description: "Local database" },
        { label: "Files", description: "Plain files" },
      ],
    },
    {
      header: "Checks",
      question: "Which checks?",
      multiSelect: true,
      options: [
        { label: "Types", description: "Type checking" },
        { label: "Tests", description: "Regression tests" },
      ],
    },
  ];
  let scenario = "questionnaire";
  const requests = new Map<string, Record<string, unknown>[]>();
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(request.headers.authorization, "Bearer interaction-test-only");
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const payload = JSON.parse(body) as Record<string, unknown>;
      const rows = requests.get(scenario) ?? [];
      rows.push(payload);
      requests.set(scenario, rows);
      const round = rows.length;
      let tools: { name: string; arguments: unknown }[] = [];
      let text = `${scenario.toUpperCase()}_DONE`;
      if (["questionnaire", "cancel"].includes(scenario) && round === 1)
        tools = [{ name: "ask_user_question", arguments: { questions } }];
      if (scenario.startsWith("plan-")) {
        if (round === 1)
          tools = [
            { name: "write", arguments: { path: `blocked-${scenario}.txt`, content: "PREMATURE" } },
            {
              name: "bash",
              arguments: { command: `uniq fixture.txt blocked-shell-${scenario}.txt` },
            },
          ];
        else if (round === 2)
          text = `Plan:\n1. Write approved-${scenario}.txt after approval.\n2. Verify its content.\n\n[PLAN READY]`;
        else if (round === 3)
          tools = [
            { name: "write", arguments: { path: `approved-${scenario}.txt`, content: "APPROVED" } },
          ];
      }
      if (["jobs", "orphan"].includes(scenario) && round === 1)
        tools = [
          {
            name: "bash",
            arguments: {
              command: `printf '${scenario.toUpperCase()}_READY\\n'; sleep ${scenario === "orphan" ? 3 : 30}`,
              mode: "detach",
              label: `acceptance-${scenario}`,
            },
          },
        ];
      const delta = tools.length
        ? {
            role: "assistant",
            tool_calls: tools.map((tool, index) => ({
              index,
              id: `${scenario}-${round}-${index}`,
              type: "function",
              function: { name: tool.name, arguments: JSON.stringify(tool.arguments) },
            })),
          }
        : { role: "assistant", content: text };
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({ id: "interactions", object: "chat.completion.chunk", created: 1, model: "interactions", choices: [{ index: 0, delta, finish_reason: tools.length ? "tool_calls" : "stop" }] })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    } catch {
      response.destroy(new Error("Invalid interaction acceptance request."));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  production<{ saveDurableModel(value: unknown): unknown }>(
    "settings/durableStore",
  ).saveDurableModel({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    api: "openai-completions",
    apiKey: "interaction-test-only",
    modelId: "interactions",
    contextWindow: 128000,
    maxTokens: 1024,
    reasoning: false,
  });
  await sessions.updateModel();
  const clickText = async (text: string) => {
    await until(
      () =>
        evaluate<boolean>(
          `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)} && !b.disabled)`,
        ),
      `button ${text}`,
    );
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)} && !b.disabled).click()`,
    );
  };
  const send = async (text: string) => {
    await until(
      () => evaluate<boolean>("!!document.querySelector('[contenteditable=\"true\"]')"),
      "composer",
    );
    await evaluate("document.querySelector('[contenteditable=\"true\"]').focus()");
    await window.webContents.insertText(text);
    await evaluate(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
    await until(
      () =>
        evaluate<boolean>("!!document.querySelector('button[aria-label=\"Send\"]:not(:disabled)')"),
      "send enabled",
    );
    await evaluate("document.querySelector('button[aria-label=\"Send\"]').click()");
  };
  const state = async (id: string) =>
    unwrap(
      await evaluate<IpcResult<NativeSessionState>>(
        `window.pidesk.durable.nativeState(${JSON.stringify(id)})`,
      ),
    );
  const jobs = async (id: string) =>
    unwrap(
      await evaluate<IpcResult<NativeJob[]>>(`window.pidesk.durable.jobs(${JSON.stringify(id)})`),
    );
  const idle = () =>
    until(
      () => runtime.listRuntimeSnapshots().every((row) => row.state !== "busy"),
      "settled desktop sessions",
    );
  const answer = (marker: string) =>
    until(
      () =>
        evaluate<boolean>(
          `Array.from(document.querySelectorAll('[data-kind="assistant"]')).some(el=>el.textContent.includes(${JSON.stringify(marker)}))`,
        ),
      marker,
    );
  const screenshot = async (name: string) =>
    writeFile(
      path.join(
        path.dirname(reportPath),
        `${app.isPackaged ? "packaged" : "development"}-${name}.png`,
      ),
      (await window.webContents.capturePage()).toPNG(),
    );
  const start = async (title: string) => {
    for (const row of runtime.listRuntimeSnapshots(true)) await sessions.close(row.sessionId);
    const before = new Set(runtime.listRuntimeSnapshots(true).map((row) => row.sessionId));
    await clickText("New task");
    await send(title);
    await until(
      () => runtime.listRuntimeSnapshots().some((row) => !before.has(row.sessionId)),
      "new runtime session",
    );
    const row = runtime.listRuntimeSnapshots().find((row) => !before.has(row.sessionId));
    assert(row);
    return row.sessionId;
  };
  const reopen = async (title: string) => {
    await new Promise<void>((resolve) => {
      window.webContents.once("did-finish-load", () => resolve());
      window.webContents.reload();
    });
    await until(
      () => evaluate<boolean>("!!document.querySelector('[data-project-row-hit]')"),
      "history sidebar",
    );
    await evaluate(
      "document.querySelector('[data-project-row-hit][aria-expanded=\"false\"]')?.click()",
    );
    await clickText(title);
  };
  try {
    const title = "Persistent questionnaire acceptance";
    let id = await start(title);
    await until(
      () =>
        evaluate<boolean>(
          '!!document.querySelector(\'[role="dialog"][aria-label="Your decision is needed"]\')',
        ),
      "questionnaire dialog",
    );
    const pending = Object.values((await state(id)).questions)[0];
    assert(pending);
    assert.equal(requests.get(scenario)?.length, 1);
    await sessions.close(id);
    await reopen(title);
    await until(
      () =>
        evaluate<boolean>(
          '!!document.querySelector(\'[role="dialog"][aria-label="Your decision is needed"]\')',
        ),
      "restored questionnaire dialog",
    );
    const restored = runtime.listRuntimeSnapshots().find((row) => row.state === "busy");
    assert(restored);
    id = restored.sessionId;
    assert.deepEqual(Object.values((await state(id)).questions)[0], pending);
    assert.equal(
      requests.get(scenario)?.length,
      1,
      "Reopen must not request the model while a question is parked.",
    );
    assert(
      await evaluate<boolean>(
        "Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Submit answers' && b.disabled)",
      ),
    );
    const invalid = await evaluate<IpcResult<unknown>>(
      `window.pidesk.durable.answerQuestionnaire(${JSON.stringify(id)},${pending.taskId},1,{cancelled:false,answers:[{selected:['invalid'],text:''},{selected:['Tests'],text:''}]})`,
    );
    assert.equal(invalid.ok, false);
    await evaluate(
      "document.querySelector('input[type=\"radio\"]').click(); document.querySelectorAll('input[type=\"checkbox\"]').forEach(el=>el.click()); document.querySelector('textarea').focus()",
    );
    await window.webContents.insertText("Encrypted storage");
    await screenshot("questionnaire");
    await clickText("Submit answers");
    await answer("QUESTIONNAIRE_DONE");
    await idle();
    const supplied = JSON.stringify(requests.get(scenario)?.[1]);
    for (const value of ["SQLite", "Types", "Tests", "Encrypted storage"])
      assert(supplied.includes(value));
    assert.equal(
      unwrap(
        await evaluate<IpcResult<string>>(
          `window.pidesk.durable.answerQuestionnaire(${JSON.stringify(id)},${pending.taskId},1,{cancelled:true,answers:[]})`,
        ),
      ),
      "closed",
    );

    scenario = "cancel";
    await start("Questionnaire cancellation acceptance");
    await until(
      () =>
        evaluate<boolean>(
          '!!document.querySelector(\'[role="dialog"][aria-label="Your decision is needed"]\')',
        ),
      "cancellable question",
    );
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await answer("CANCEL_DONE");
    await idle();
    assert(JSON.stringify(requests.get(scenario)?.[1]).includes("No decision was approved"));

    const actionLabels: Record<PlanAction, string> = {
      execute: "Execute here",
      new: "Execute in new session",
      explore: "Keep exploring",
      save: "Save plan only",
    };
    for (const action of ["execute", "new", "explore", "save"] as const) {
      scenario = `plan-${action}`;
      id = await start("/plan on");
      await until(async () => (await state(id)).mode === "plan", "local /plan command committed");
      await idle();
      await send(`Review acceptance ${action}`);
      await until(async () => !!(await state(id)).plan, `plan review ${action}`);
      const plan = (await state(id)).plan;
      assert(plan);
      await assert.rejects(access(path.join(workspace, `blocked-${scenario}.txt`)));
      await assert.rejects(access(path.join(workspace, `blocked-shell-${scenario}.txt`)));
      assert(
        JSON.stringify(requests.get(scenario)?.[1]).includes(
          "Plan mode permits read-only exploration",
        ),
      );
      await screenshot(`plan-${action}`);
      await clickText(actionLabels[action]);
      if (action === "execute" || action === "new") {
        await answer(`${scenario.toUpperCase()}_DONE`);
        assert.equal(
          await readFile(path.join(workspace, `approved-${scenario}.txt`), "utf8"),
          "APPROVED",
        );
      }
      await idle();
      const current = await state(id);
      assert.equal(current.plan, null);
      assert.equal(current.mode, action === "execute" ? "edit" : "plan");
      if (action === "explore") assert.equal(current.savedPlan, "");
      else assert((await readFile(current.savedPlan, "utf8")).includes(plan.text));
      if (action === "new") {
        const count = requests.get(scenario)?.length;
        const retried = unwrap(
          await evaluate<IpcResult<{ file?: string }>>(
            `window.pidesk.durable.answerPlan(${JSON.stringify(id)},${plan.taskId},"new")`,
          ),
        );
        assert(retried.file);
        assert.equal(
          requests.get(scenario)?.length,
          count,
          "Retry must not execute the approved plan a second time.",
        );
        assert(JSON.stringify(requests.get(scenario)?.[2]).includes("Implement the approved plan"));
      }
      if (action === "explore" || action === "save")
        assert.equal(requests.get(scenario)?.length, 2);
    }

    scenario = "jobs";
    id = await start("Background job controls acceptance");
    await answer("JOBS_DONE");
    await idle();
    const row = (await jobs(id))[0];
    assert(row && row.status === "running");
    await evaluate("document.querySelector('button[aria-label=\"Background jobs\"]').click()");
    await until(
      () =>
        evaluate<boolean>(
          "Array.from(document.querySelectorAll('[role=\"option\"]')).some(el=>el.textContent.includes('acceptance-jobs'))",
        ),
      "background job list",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('[role=\"option\"]')).find(el=>el.textContent.includes('acceptance-jobs')).click()",
    );
    await until(
      () =>
        evaluate<boolean>(
          "Array.from(document.querySelectorAll('pre')).some(el=>el.textContent.includes('JOBS_READY'))",
        ),
      "job output log",
    );
    await screenshot("jobs");
    await clickText("Stop job");
    await until(async () => (await jobs(id))[0]?.status === "stopped", "captured process stop");
    await clickText("Close");
    await idle();

    scenario = "orphan";
    const orphanTitle = "Restored job observation acceptance";
    id = await start(orphanTitle);
    await answer("ORPHAN_DONE");
    await idle();
    const orphan = (await jobs(id))[0];
    assert(orphan && orphan.status === "running");
    const writer = getWriter();
    assert(writer);
    writer.kill();
    await until(
      () =>
        runtime
          .listRuntimeSnapshots()
          .every((row) => row.state === "cold" || row.state === "failed"),
      "runtime fault cleanup",
    );
    await reopen(orphanTitle);
    await answer("ORPHAN_DONE");
    await idle();
    const reopened = runtime.listRuntimeSnapshots().find((row) => row.state === "idle");
    assert(reopened);
    const observed = (await jobs(reopened.sessionId))[0];
    assert.equal(observed.status, "orphaned");
    assert.equal(observed.pid, orphan.pid);
    assert.equal(
      requests.get(scenario)?.length,
      2,
      "Restoring a job must not replay its bash tool.",
    );
    const rejected = await evaluate<IpcResult<unknown>>(
      `window.pidesk.durable.stopJob(${JSON.stringify(reopened.sessionId)},${JSON.stringify(orphan.id)})`,
    );
    assert.equal(rejected.ok, false);
    assert(!rejected.ok && rejected.error?.includes("read-only"));
    await evaluate("document.querySelector('button[aria-label=\"Background jobs\"]').click()");
    await until(
      () =>
        evaluate<boolean>(
          "Array.from(document.querySelectorAll('[role=\"option\"]')).some(el=>el.textContent.includes('acceptance-orphan'))",
        ),
      "orphan job list",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('[role=\"option\"]')).find(el=>el.textContent.includes('acceptance-orphan')).click()",
    );
    await until(
      () =>
        evaluate<boolean>(
          "Array.from(document.querySelectorAll('button')).some(el=>el.textContent==='Stop job' && el.disabled)",
        ),
      "disabled restored stop control",
    );
    await screenshot("jobs-restored");
    await clickText("Close");
    return {
      questionnaireParkAndReopen: "passed",
      questionnaireOptionsAndNotes: "passed",
      questionnaireCancelAndStaleReply: "passed",
      planReadOnlyGate: "passed",
      planCommandSettlement: "passed",
      planExecuteHere: "passed",
      planExecuteNewSessionAndRetry: "passed",
      planExplore: "passed",
      planSaveOnly: "passed",
      jobOutputAndStop: "passed",
      restoredPidObservationOnly: "passed",
      requests: Object.fromEntries([...requests].map(([key, rows]) => [key, rows.length])),
    };
  } finally {
    for (const row of runtime.listRuntimeSnapshots(true)) {
      for (const job of await jobs(row.sessionId).catch(() => []))
        if (job.status === "running")
          await evaluate(
            `window.pidesk.durable.stopJob(${JSON.stringify(row.sessionId)},${JSON.stringify(job.id)})`,
          ).catch(() => undefined);
      await sessions.close(row.sessionId).catch(() => undefined);
    }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
