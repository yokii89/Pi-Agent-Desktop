import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolCall } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopBuiltinTools } from "../../agentRuntime/builtins";
import { fetchProvider, readResponseBytes } from "../../agentRuntime/builtins/http";
import { generateImages } from "../../agentRuntime/builtins/image/imagesApi";
import { boundedWebText } from "../../agentRuntime/builtins/output";
import { assertWebUrl } from "../../agentRuntime/builtins/web/tools";
import { DurableSessions, type DurableSessionUpdate } from "../../agentRuntime/durableSessions";
import {
  defaultBuiltinToolsConfig,
  type RuntimeBuiltinToolsConfig,
} from "../../shared/builtinTools";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1sAAAAASUVORK5CYII=";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  try {
    for (const close of cleanups.splice(0).reverse()) await close();
  } finally {
    vi.unstubAllGlobals();
  }
});

async function fixture(getConfig: () => RuntimeBuiltinToolsConfig = defaultBuiltinToolsConfig) {
  const directory = await mkdtemp(path.join(tmpdir(), "pidesk-builtins-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const models = createModels();
  const faux = fauxProvider({ models: [{ id: "builtin-test", input: ["text", "image"] }] });
  models.setProvider(faux.provider);
  const registry = createRegistry();
  registry.install(desktopBuiltinTools(directory, getConfig));
  const updates: DurableSessionUpdate[] = [];
  const service = new DurableSessions(
    directory,
    () => ({ models, registry }),
    (update) => updates.push(update),
  );
  cleanups.push(() => service.dispose());
  const sessionId = randomUUID();
  const open = {
    sessionId,
    cwd: directory,
    agent: { model: { provider: faux.provider.id, modelId: faux.models[0].id } },
  };
  await service.open(open);
  async function run(name: string, args: ToolCall["arguments"]) {
    const id = randomUUID();
    const marker = `finished-${id}`;
    faux.appendResponses([
      fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" }),
      fauxAssistantMessage(marker),
    ]);
    await service.submit(sessionId, {
      type: "input",
      content: "Run the requested native tool.",
      requestId: id,
    });
    await vi.waitFor(() =>
      expect(
        updates.some(
          (update) =>
            update.type === "settled" && JSON.stringify(update.view.entries).includes(marker),
        ),
      ).toBe(true),
    );
    const entries = await service.entries(sessionId);
    const result = entries
      .flatMap((entry) => entry.model ?? [])
      .find((message) => message.role === "toolResult" && message.toolCallId === id);
    if (result?.role !== "toolResult") throw new Error("Missing persisted native tool result.");
    return result;
  }
  return { directory, service, sessionId, open, faux, run };
}

function text(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.map((part) => part.text ?? "").join("\n");
}

describe("Durable built-in tool execution", () => {
  it("keeps unconfigured tools registered and returns actionable failures without network requests", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const f = await fixture();
    for (const [name, args] of [
      ["web_search", { query: "test" }],
      ["generate_image", { prompt: "test" }],
    ] as const) {
      const result = await f.run(name, args);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Settings → Models → Built-in tools");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses keyless local Ollama, limits search results and reads configuration at invocation time", async () => {
    let config = defaultBuiltinToolsConfig();
    config.web = {
      provider: "ollama",
      providers: { ollama: { baseUrl: "http://localhost:11434", apiKey: "" } },
    };
    const fetch = vi.fn().mockImplementation(async () =>
      Response.json({
        results: [
          { title: "First", url: "https://example.com/first", content: "Current information" },
          { title: "Second", url: "https://example.com/second", content: "More information" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const f = await fixture(() => config);
    const result = await f.run("web_search", { query: "test", max_results: 1 });
    expect(result.isError).toBe(false);
    expect(text(result)).toContain("Current information");
    expect(text(result)).not.toContain("Second");
    expect(fetch.mock.calls[0]?.[0]).toBe("http://localhost:11434/api/experimental/web_search");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      headers: { "Content-Type": "application/json" },
    });
    config = defaultBuiltinToolsConfig();
    const unconfigured = await f.run("web_search", { query: "after settings change" });
    expect(unconfigured.isError).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("validates each fetched redirect, extracts HTML and works without search credentials", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/article" } }))
      .mockResolvedValueOnce(
        new Response(
          "<title>Article</title><script>privateScript()</script><p>Hello &#x1F30D;</p>",
          { headers: { "Content-Type": "Text/HTML; charset=utf-8" } },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const f = await fixture();
    const result = await f.run("web_fetch", { url: "https://example.com/start" });
    expect(result.isError).toBe(false);
    expect(text(result)).toContain("Fetched: https://example.com/article");
    expect(text(result)).toContain("Hello 🌍");
    expect(text(result)).not.toContain("privateScript");
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch
      .mockReset()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }),
      );
    const rejected = await f.run("web_fetch", { url: "https://example.com/start" });
    expect(rejected.isError).toBe(true);
    expect(text(rejected)).toContain("private or loopback");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("persists generated images in the session workspace and reopens SQLite without regenerating", async () => {
    const config = defaultBuiltinToolsConfig();
    config.image.apiKey = "image-test-only";
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: PNG }] }));
    vi.stubGlobal("fetch", fetch);
    const f = await fixture(() => config);
    const result = await f.run("generate_image", { prompt: "A small green circle", n: 1 });
    expect(result.isError).toBe(false);
    expect(result.content.find((part) => part.type === "image")).toMatchObject({
      type: "image",
      data: PNG,
      mimeType: "image/png",
    });
    const paths =
      result.details && typeof result.details === "object" && "paths" in result.details
        ? result.details.paths
        : undefined;
    expect(Array.isArray(paths)).toBe(true);
    if (!Array.isArray(paths) || typeof paths[0] !== "string")
      throw new Error("No saved image path.");
    expect(path.dirname(paths[0])).toBe(path.join(f.directory, ".pidesk", "artifacts", "images"));
    expect(await readFile(paths[0])).toEqual(Buffer.from(PNG, "base64"));
    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      model: "gpt-image-1",
      prompt: "A small green circle",
      n: 1,
    });
    expect(JSON.stringify(result)).not.toContain(config.image.apiKey);
    await f.service.close(f.sessionId);
    await f.service.open(f.open);
    expect(JSON.stringify(await f.service.entries(f.sessionId))).toContain(PNG);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(f.faux.state.callCount).toBe(2);
  });

  it("rejects invalid model arguments before invoking a configured paid provider", async () => {
    const config = defaultBuiltinToolsConfig();
    config.image.apiKey = "unused-test-key";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const f = await fixture(() => config);
    const result = await f.run("generate_image", { prompt: "test", n: 5 });
    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("native HTTP and output bounds", () => {
  it("rejects oversized chunked bodies and cancels the source", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(20));
      },
      cancel,
    });
    await expect(readResponseBytes(new Response(body), 10)).rejects.toThrow("10-byte limit");
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(
      readResponseBytes(new Response("small", { headers: { "content-length": "20" } }), 10),
    ).rejects.toThrow("10-byte limit");
  });

  it("spills complete Unicode text while keeping a valid bounded preview", async () => {
    const source = "中".repeat(20000);
    const output = await boundedWebText(source);
    expect(output.text).not.toContain("�");
    expect(output.fullOutputPath).toBeDefined();
    if (!output.fullOutputPath) throw new Error("Missing spill path.");
    cleanups.push(() =>
      rm(path.dirname(output.fullOutputPath as string), { recursive: true, force: true }),
    );
    expect(await readFile(output.fullOutputPath, "utf8")).toBe(source);
  });

  it("rejects binary pages and cancels their body without reading it", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream({ cancel }), {
          headers: { "content-type": "application/pdf" },
        }),
      ),
    );
    const f = await fixture();
    const result = await f.run("web_fetch", { url: "https://example.com/document.pdf" });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("text pages only");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("passes cancellation to image and search requests", async () => {
    const fetch = vi.fn().mockImplementation(
      (_url: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const pending = generateImages(
      { ...defaultBuiltinToolsConfig().image, apiKey: "test-only" },
      { model: "gpt-image-1", prompt: "test" },
      controller.signal,
    );
    controller.abort(new Error("cancelled-test"));
    await expect(pending).rejects.toThrow("cancelled-test");
    const other = new AbortController();
    const search = fetchProvider("https://example.com/search", { signal: other.signal });
    other.abort(new Error("search-cancelled-test"));
    await expect(search).rejects.toThrow("search-cancelled-test");
  });

  it("refuses excess images before downloading them and supports OpenRouter inline images", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: Array.from({ length: 5 }, () => ({ url: "https://example.com/image.png" })),
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: [
                  { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } },
                ],
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const auth = { ...defaultBuiltinToolsConfig().image, apiKey: "test-only" };
    await expect(generateImages(auth, { model: auth.model, prompt: "test" })).rejects.toThrow(
      "too many images",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const result = await generateImages(
      { ...auth, provider: "openrouter" },
      { model: "test/image", prompt: "test" },
    );
    expect(result.images).toEqual([{ mimeType: "image/png", data: PNG }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    "file:///secret",
    "http://localhost/",
    "http://127.1/",
    "http://0x7f000001/",
    "http://[::1]/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "https://user:pass@example.com/",
  ])("rejects unsupported direct fetch targets: %s", (url) => {
    expect(() => assertWebUrl(url)).toThrow();
  });
});
