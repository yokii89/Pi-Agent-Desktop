import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { app, type BrowserWindow } from "electron";
import type { BuiltinToolsConfig } from "../../src/shared/builtinTools";
import type { IpcResult } from "../../src/shared/ipc";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1sAAAAASUVORK5CYII=";
const hostRequire = createRequire(__filename);
function production<T>(module: string): T {
  return hostRequire(path.join(app.getAppPath(), "dist/main", `${module}.js`)) as T;
}
async function until(check: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Built-in tool acceptance timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

/** Verify encrypted settings, native tools and SQLite restoration through the production desktop. */
export async function checkBuiltinsWorkbench(
  window: BrowserWindow,
  reportPath: string,
): Promise<Record<string, unknown>> {
  const evaluate = <T>(source: string): Promise<T> =>
    window.webContents.executeJavaScript(source, true) as Promise<T>;
  const runtime = production<{
    listRuntimeSnapshots(hidden?: boolean): { sessionId: string; state: string }[];
  }>("session/runtimeCoordinator");
  const sessions = production<{
    desktopSessions: {
      close(id: string): Promise<void>;
      updateModel(): Promise<void>;
      updateBuiltinTools(): Promise<void>;
    };
  }>("agentRuntime/desktopSessions").desktopSessions;
  for (const row of runtime.listRuntimeSnapshots(true)) await sessions.close(row.sessionId);
  const workspace = path.join(app.getPath("userData"), "acceptance workspace 中文");
  const agentDir = production<{ getPiAgentDir(): string }>("session/piInfo").getPiAgentDir();
  assert(
    agentDir.startsWith(app.getPath("userData")),
    "Built-in acceptance must use an isolated profile.",
  );
  const configFile = path.join(app.getPath("userData"), "durable", "v1", "builtin-tools.bin");
  let original: Buffer | undefined;
  try {
    original = await readFile(configFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const requests: Record<string, unknown>[] = [];
  let searches = 0;
  let images = 0;
  let searchKey = "builtin-search-test-one";
  let imageKey = "builtin-image-test-only";
  const server = createServer(async (request, response) => {
    try {
      if (request.url?.startsWith("/search?")) {
        assert.equal(request.headers.authorization, `Bearer ${searchKey}`);
        searches++;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            results: [
              {
                title: "Native search fixture",
                url: "https://example.com/builtins",
                content: "BUILTIN_SEARCH_OK",
              },
            ],
          }),
        );
        return;
      }
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const payload = JSON.parse(body) as Record<string, unknown>;
      if (request.url === "/v1/images/generations") {
        assert.equal(request.headers.authorization, `Bearer ${imageKey}`);
        assert.equal(payload.model, "gpt-image-1");
        assert.equal(payload.response_format, undefined);
        images++;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ data: [{ b64_json: PNG }] }));
        return;
      }
      assert.equal(request.url, "/v1/chat/completions");
      requests.push(payload);
      const tools =
        requests.length === 1
          ? [
              {
                name: "web_search",
                arguments: JSON.stringify({ query: "native built-in fixture" }),
              },
              {
                name: "generate_image",
                arguments: JSON.stringify({ prompt: "A small green circle", n: 1 }),
              },
            ]
          : requests.length === 3
            ? [
                {
                  name: "web_search",
                  arguments: JSON.stringify({ query: "after live configuration update" }),
                },
              ]
            : [];
      const delta = tools.length
        ? {
            role: "assistant",
            tool_calls: tools.map((tool, index) => ({
              index,
              id: `builtin-${requests.length}-${index}`,
              type: "function",
              function: tool,
            })),
          }
        : {
            role: "assistant",
            content: requests.length === 2 ? "BUILTINS_FIRST_OK" : "BUILTINS_UPDATED_OK",
          };
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({ id: "builtins", object: "chat.completion.chunk", created: 1, model: "builtins-test", choices: [{ index: 0, delta, finish_reason: tools.length ? "tool_calls" : "stop" }] })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    } catch {
      response.destroy(new Error("Invalid built-in acceptance request."));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const save = async (key: string, generatedImageKey: string) => {
    const result = await evaluate<IpcResult<BuiltinToolsConfig>>(
      `window.pidesk.durable.saveBuiltinTools(${JSON.stringify({ web: { provider: "searxng", providers: { searxng: { baseUrl, apiKey: key } } }, image: { provider: "openai", baseUrl: `${baseUrl}/v1`, model: "gpt-image-1", apiKey: generatedImageKey } })})`,
    );
    assert(result.ok && result.data, "Built-in configuration must save through production IPC.");
    assert.equal(result.data.web.providers.searxng?.hasKey, true);
    assert.equal(result.data.image.hasKey, true);
    assert(!JSON.stringify(result).includes(searchKey));
    assert(!JSON.stringify(result).includes(imageKey));
  };
  const hasAnswer = (marker: string) =>
    evaluate<boolean>(
      `Array.from(document.querySelectorAll('[data-kind="assistant"]')).some(el=>el.textContent.includes(${JSON.stringify(marker)}))`,
    );
  const send = async (content: string) => {
    await until(
      () => evaluate<boolean>("!!document.querySelector('[contenteditable=\"true\"]')"),
      "composer",
    );
    await evaluate("document.querySelector('[contenteditable=\"true\"]').focus()");
    await window.webContents.insertText(content);
    await until(
      () =>
        evaluate<boolean>("!!document.querySelector('button[aria-label=\"Send\"]:not(:disabled)')"),
      "send enabled",
    );
    await evaluate("document.querySelector('button[aria-label=\"Send\"]').click()");
  };
  try {
    production<{ saveDurableModel(value: unknown): unknown }>(
      "settings/durableStore",
    ).saveDurableModel({
      baseUrl: `${baseUrl}/v1`,
      api: "openai-completions",
      apiKey: "builtin-model-test-only",
      modelId: "builtins-test",
      contextWindow: 128000,
      maxTokens: 1024,
      reasoning: false,
    });
    await sessions.updateModel();
    await save(searchKey, imageKey);
    await save("", "");
    const encrypted = await readFile(configFile);
    assert(!encrypted.includes(Buffer.from(searchKey)));
    assert(!encrypted.includes(Buffer.from(imageKey)));
    const command = "Verify native built-in tools";
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='New task').click()",
    );
    await send(command);
    await until(() => hasAnswer("BUILTINS_FIRST_OK"), "native search and image answer");
    await until(
      () => runtime.listRuntimeSnapshots().every((row) => row.state !== "busy"),
      "first run settled",
    );
    assert.equal(searches, 1);
    assert.equal(images, 1);
    const toolMessages = requests[1]?.messages;
    assert(
      JSON.stringify(toolMessages).includes("BUILTIN_SEARCH_OK"),
      "The model must receive the actual search result.",
    );
    assert(
      JSON.stringify(toolMessages).includes(PNG),
      "The generated image must reach the next model request.",
    );
    assert(
      JSON.stringify(toolMessages).includes(workspace.replaceAll("\\", "\\\\")),
      "Artifacts must use the actual session workspace.",
    );
    searchKey = "builtin-search-test-two";
    await save(searchKey, "");
    await send("Verify updated native search settings");
    await until(() => hasAnswer("BUILTINS_UPDATED_OK"), "live configuration update");
    await until(
      () => runtime.listRuntimeSnapshots().every((row) => row.state !== "busy"),
      "updated run settled",
    );
    assert.equal(searches, 2);
    assert.equal(images, 1);
    assert.equal(requests.length, 4);
    const row = runtime.listRuntimeSnapshots().find((item) => item.state === "idle");
    assert(row);
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
      "built-in history title",
    );
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(command)}).click()`,
    );
    await until(() => hasAnswer("BUILTINS_UPDATED_OK"), "built-in SQLite reopen");
    assert.equal(requests.length, 4);
    assert.equal(searches, 2);
    assert.equal(images, 1);
    await writeFile(
      path.join(
        path.dirname(reportPath),
        `${app.isPackaged ? "packaged" : "development"}-builtins.png`,
      ),
      (await window.webContents.capturePage()).toPNG(),
    );
    return {
      encryptedSettings: "passed",
      credentialMetadata: "passed",
      blankKeyPreservation: "passed",
      nativeSearch: "passed",
      nativeImage: "passed",
      liveConfiguration: "passed",
      sqliteReopenWithoutReplay: "passed",
      modelRequests: requests.length,
      searches,
      images,
    };
  } finally {
    searchKey = "";
    imageKey = "";
    for (const row of runtime.listRuntimeSnapshots(true))
      await sessions.close(row.sessionId).catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (original) await writeFile(configFile, original);
    else await rm(configFile, { force: true });
    await sessions.updateBuiltinTools();
  }
}
