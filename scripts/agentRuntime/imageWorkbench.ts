import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { app, type BrowserWindow } from "electron";
import type { SessionSummary } from "../../src/shared/ipc";

const hostRequire = createRequire(__filename);
function production<T>(module: string): T {
  return hostRequire(path.join(app.getAppPath(), "dist/main", `${module}.js`)) as T;
}
async function until(check: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Image acceptance timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
function answer(response: ServerResponse, done = true) {
  response.write(
    `data: ${JSON.stringify({ id: "images", object: "chat.completion.chunk", created: 1, model: "images", choices: [{ index: 0, delta: { role: "assistant", content: done ? "IMAGE_OK" : "IMAGE_PENDING" }, finish_reason: done ? "stop" : null }] })}\n\n`,
  );
  if (done) response.end("data: [DONE]\n\n");
}
interface Message {
  role: string;
  content: string | Record<string, unknown>[];
}
function text(message: Message): string {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}
function providerImages(message: Message): string[] {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((block) =>
    block.type === "image_url" ? [(block.image_url as { url: string }).url] : [],
  );
}

/** Exercise image attachments through the production editor, queue, transport and SQLite. */
export async function checkImageWorkbench(
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
  const requests: { messages: Message[] }[] = [];
  let held: ServerResponse | undefined;
  const destroyHeld = () => held?.destroy();
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages: Message[] };
    requests.push(parsed);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const lastUser = parsed.messages.filter((message) => message.role === "user").at(-1);
    if (lastUser && ["IMAGE_QUEUE_ACTIVE", "IMAGE_STOP_ACTIVE"].includes(text(lastUser))) {
      held = response;
      answer(response, false);
    } else answer(response);
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
    apiKey: "local-images-only",
    modelId: "images",
    contextWindow: 128000,
    maxTokens: 1024,
    reasoning: false,
  });
  await sessions.updateModel();
  const previewSelector = 'button[aria-label^="Preview "] > img:first-child';
  const previews = () =>
    evaluate<string[]>(
      `Array.from(document.querySelector('[contenteditable="true"]')?.parentElement?.parentElement?.querySelectorAll(${JSON.stringify(previewSelector)}) ?? []).map(img=>img.src)`,
    );
  const screenshot = async (name: string) =>
    writeFile(
      path.join(
        path.dirname(reportPath),
        `${app.isPackaged ? "packaged" : "development"}-images-${name}.png`,
      ),
      (await window.webContents.capturePage()).toPNG(),
    );
  const newTask = async () => {
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='New task').click()",
    );
    await until(
      () => evaluate<boolean>("!!document.querySelector('[contenteditable=\"true\"]')"),
      "new task editor",
    );
  };
  const append = async (value: string) => {
    await evaluate(`(() => {
      const editor = document.querySelector('[contenteditable="true"]');
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    })()`);
    if (value) await window.webContents.insertText(value);
  };
  const send = async (value: string, queued = false) => {
    await append(value);
    const label = queued ? "Queue message" : "Send";
    await until(
      () =>
        evaluate<boolean>(
          `!!document.querySelector('button[aria-label="${label}"]:not(:disabled)')`,
        ),
      `${label} enabled`,
    );
    await evaluate(`document.querySelector('button[aria-label="${label}"]').click()`);
    await until(async () => (await previews()).length === 0, "sent draft attachments cleared");
  };
  const settled = () =>
    until(
      async () =>
        runtime.listRuntimeSnapshots().every((row) => row.state !== "busy") &&
        (await evaluate<boolean>("!!document.querySelector('button[aria-label=\"Send\"]')")),
      "image run settled",
    );
  const queue = (expected: [string, string][]) =>
    until(
      () =>
        evaluate<boolean>(
          `JSON.stringify(Array.from(document.querySelectorAll('[data-queue-row]')).map(row=>[row.dataset.queueRow,row.dataset.queueKind]))===${JSON.stringify(JSON.stringify(expected))} && !document.querySelector('[data-queue-row] button:disabled')`,
        ),
      `queue ${JSON.stringify(expected)}`,
    );
  const action = async (value: string, kind: string) => {
    const selector = `[data-queue-row=${JSON.stringify(value)}] [data-queue-action="${kind}"]`;
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const lastUsers = () =>
    requests.at(-1)?.messages.filter((message) => message.role === "user") ?? [];
  try {
    await newTask();
    const samples = await evaluate<string[]>(`["image/png", "image/jpeg"].map((mime, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 3;
      const context = canvas.getContext('2d');
      context.fillStyle = index ? '#1848d0' : '#d02818';
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL(mime);
    })`);
    assert.equal(samples.length, 2);
    const attach = async (indices: number[]) => {
      const before = (await previews()).length;
      await evaluate(`(() => {
        const transfer = new DataTransfer();
        for (const source of ${JSON.stringify(indices.map((index) => samples[index]))}) {
          const mime = source.slice(5, source.indexOf(';'));
          const bytes = Uint8Array.from(atob(source.slice(source.indexOf(',') + 1)), c=>c.charCodeAt(0));
          transfer.items.add(new File([bytes], mime==='image/png' ? 'fixture.png' : 'fixture.jpg', {type:mime}));
        }
        document.querySelector('[contenteditable="true"]').dispatchEvent(new ClipboardEvent('paste', {clipboardData:transfer, bubbles:true, cancelable:true}));
      })()`);
      await until(
        async () => (await previews()).length === before + indices.length,
        "image paste decoded",
      );
      assert.deepEqual(
        (await previews()).slice(before),
        indices.map((index) => samples[index]),
      );
    };

    await attach([0, 1]);
    await send("IMAGE_MIXED");
    await settled();
    assert.deepEqual(providerImages(lastUsers().at(-1) as Message), samples);
    await attach([0]);
    await send("");
    await settled();
    assert.equal(text(lastUsers().at(-1) as Message), "");
    assert.deepEqual(providerImages(lastUsers().at(-1) as Message), [samples[0]]);

    await send("IMAGE_QUEUE_ACTIVE");
    await until(() => !!held, "queue generation held");
    await attach([0]);
    await send("IMAGE_QUEUE_A", true);
    await attach([1]);
    await send("", true);
    await attach([0, 1]);
    await send("IMAGE_QUEUE_DELETE", true);
    await queue([
      ["IMAGE_QUEUE_A", "followUp"],
      ["", "followUp"],
      ["IMAGE_QUEUE_DELETE", "followUp"],
    ]);
    await evaluate(
      `document.querySelector('[data-queue-row=""] [data-queue-grip]').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowUp',bubbles:true}))`,
    );
    await queue([
      ["", "followUp"],
      ["IMAGE_QUEUE_A", "followUp"],
      ["IMAGE_QUEUE_DELETE", "followUp"],
    ]);
    await action("", "convert");
    await queue([
      ["", "steer"],
      ["IMAGE_QUEUE_A", "followUp"],
      ["IMAGE_QUEUE_DELETE", "followUp"],
    ]);
    await action("IMAGE_QUEUE_A", "edit");
    await queue([
      ["", "steer"],
      ["IMAGE_QUEUE_DELETE", "followUp"],
    ]);
    await until(async () => (await previews()).length === 1, "edited image restored to draft");
    assert.deepEqual(await previews(), [samples[0]]);
    await until(
      () =>
        evaluate<boolean>(
          "document.querySelector('[contenteditable=\"true\"]').innerText.includes('IMAGE_QUEUE_A')",
        ),
      "edited text restored to draft",
    );
    await send("_EDITED", true);
    await queue([
      ["", "steer"],
      ["IMAGE_QUEUE_DELETE", "followUp"],
      ["IMAGE_QUEUE_A_EDITED", "followUp"],
    ]);
    await action("IMAGE_QUEUE_DELETE", "delete");
    await queue([
      ["", "steer"],
      ["IMAGE_QUEUE_A_EDITED", "followUp"],
    ]);
    await screenshot("queue");
    assert(held);
    answer(held);
    held = undefined;
    await until(
      () => lastUsers().some((message) => text(message) === "IMAGE_QUEUE_A_EDITED"),
      "queued images reached provider",
    );
    await settled();
    const delivered = lastUsers().slice(-2);
    assert.deepEqual(delivered.map(text), ["", "IMAGE_QUEUE_A_EDITED"]);
    assert.deepEqual(delivered.map(providerImages), [[samples[1]], [samples[0]]]);
    assert(!lastUsers().some((message) => text(message) === "IMAGE_QUEUE_DELETE"));

    await send("IMAGE_STOP_ACTIVE");
    await until(() => !!held, "stop generation held");
    await attach([0]);
    await send("IMAGE_STOP_TEXT", true);
    await attach([1]);
    await send("", true);
    await queue([
      ["IMAGE_STOP_TEXT", "followUp"],
      ["", "followUp"],
    ]);
    const beforeStop = requests.length;
    await evaluate("document.querySelector('button[aria-label=\"Stop\"]').click()");
    await queue([]);
    await until(async () => (await previews()).length === 2, "stopped queue images restored");
    await settled();
    assert.equal(requests.length, beforeStop, "Stop must not deliver queued input.");
    assert.deepEqual(await previews(), samples);
    await until(
      () =>
        evaluate<boolean>(
          "document.querySelector('[contenteditable=\"true\"]').innerText.includes('IMAGE_STOP_TEXT')",
        ),
      "stopped queue text restored",
    );
    destroyHeld();
    held = undefined;
    await screenshot("stopped");
    await send("");
    await settled();
    assert.equal(text(lastUsers().at(-1) as Message), "IMAGE_STOP_TEXT");
    assert.deepEqual(providerImages(lastUsers().at(-1) as Message), samples);

    const summary = store.durableCatalog().find((item) => item.firstUserMessage === "IMAGE_MIXED");
    assert(summary?.ref);
    const repository = production<{
      sessionRepository: { transcript(ref: unknown): Promise<{ messages: Message[] }> };
    }>("session/sessionRepository").sessionRepository;
    const saved = (await repository.transcript(summary.ref)).messages;
    const savedUsers = saved.filter((message) => message.role === "user");
    assert.deepEqual(savedUsers.map(text), [
      "IMAGE_MIXED",
      "",
      "IMAGE_QUEUE_ACTIVE",
      "",
      "IMAGE_QUEUE_A_EDITED",
      "IMAGE_STOP_ACTIVE",
      "IMAGE_STOP_TEXT",
    ]);
    const expectedImages = [samples, [samples[0]], [], [samples[1]], [samples[0]], [], samples];
    assert.deepEqual(
      savedUsers.map((message) =>
        typeof message.content === "string"
          ? []
          : message.content.flatMap((block) =>
              block.type === "image" ? [`data:${block.mimeType};base64,${block.data}`] : [],
            ),
      ),
      expectedImages,
    );
    const beforeReopen = requests.length;
    for (const row of runtime.listRuntimeSnapshots(true)) await sessions.close(row.sessionId);
    await newTask();
    await new Promise<void>((resolve) => {
      window.webContents.once("did-finish-load", () => resolve());
      window.webContents.reload();
    });
    await until(
      () => evaluate<boolean>("!!document.querySelector('[data-project-row-hit]')"),
      "image history project",
    );
    await evaluate(
      "document.querySelector('[data-project-row-hit][aria-expanded=\"false\"]')?.click()",
    );
    await until(
      () =>
        evaluate<boolean>(
          "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='IMAGE_MIXED')",
        ),
      "image history entry",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='IMAGE_MIXED').click()",
    );
    await until(
      () =>
        evaluate<boolean>(
          "document.querySelectorAll('[data-kind=\"user\"] img').length===7 && Array.from(document.querySelectorAll('[data-kind=\"user\"] img')).every(img=>img.complete && img.naturalWidth>0)",
        ),
      "saved images rendered after SQLite reopen",
    );
    assert.deepEqual((await repository.transcript(summary.ref)).messages, saved);
    assert.equal(requests.length, beforeReopen, "Image history hydration must not call the model.");
    await screenshot("restored");
    return {
      editorPasteAndPreview: "passed",
      mixedAndImageOnlyRequests: "passed",
      queueEditAndReorder: "passed",
      queueConversionAndDeletion: "passed",
      stopAndRestoreImages: "passed",
      sqliteReopenAndImageRendering: "passed",
      noHistoryReplay: "passed",
      renderedImages: 7,
      localRequests: requests.length,
    };
  } finally {
    destroyHeld();
    for (const row of runtime.listRuntimeSnapshots(true))
      await sessions.close(row.sessionId).catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
