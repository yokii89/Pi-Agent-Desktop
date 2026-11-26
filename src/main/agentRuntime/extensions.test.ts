import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopRuntime } from "../../agentRuntime/desktopRuntime";
import { SessionExtensionHost } from "../../agentRuntime/extensions/sessionExtensionHost";
import { type DurableExtensionSpec, durableDisplayMessages } from "../../shared/durableExtension";
import { parseDurableCommand, type RuntimeSessionUpdate } from "../../shared/durableProtocol";
import { DurableProjection } from "./durableProjection";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function directory() {
  const base = path.resolve("temp");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "pidesk-native-host-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function extension(
  root: string,
  id = "native",
  body?: string,
): Promise<DurableExtensionSpec> {
  const entry = path.join(root, `${id}.mjs`);
  await writeFile(
    entry,
    body ??
      `
    import { appendFile } from 'node:fs/promises';
    export default async host => {
      await appendFile(${JSON.stringify(path.join(root, "lifecycle"))}, 'open:' + host.sessionId + '\\n');
      let expansions = 0;
      return {
        agent: { name: host.id, tools: [{ name: host.id + '__identity', description: 'Identify this session', parameters: { type: 'object', properties: {} }, execute: async () => ({ output: [{ type: 'text', text: host.sessionId }] }) }] },
        commands: [{ name: host.id + ':review', description: 'Review work', expand: args => 'Expanded ' + host.sessionId + ': ' + args + ' #' + (++expansions) }],
        dispose: () => appendFile(${JSON.stringify(path.join(root, "lifecycle"))}, 'close:' + host.sessionId + ':' + host.signal.aborted + '\\n')
      };
    }
  `,
  );
  return { id, root, entry, scope: "user", capabilities: ["agent", "commands"] };
}
async function host(root: string, spec: DurableExtensionSpec) {
  const value = new SessionExtensionHost(randomUUID(), root);
  cleanup.push(() => value.dispose());
  await value.load([spec]);
  return value;
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Native extension acceptance timed out.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("Durable native extension host", () => {
  it("isolates factories and registries, deduplicates expansion, and rejects unknown commands without leaking input", async () => {
    const root = await directory();
    const spec = await extension(root);
    const a = await host(root, spec);
    const b = await host(root, spec);
    const [first, duplicate] = await Promise.all([
      a.expand("request", "/native:review one"),
      a.expand("request", "/native:review one"),
    ]);
    expect(first).toBe(duplicate);
    expect(first).toContain(`#1`);
    expect(await b.expand("request", "/native:review one")).toContain(b.sessionId);
    expect(a.registry).not.toBe(b.registry);
    await expect(a.expand("request", "/native:review different")).rejects.toThrow("invalid");
    await expect(a.expand("unknown", "/missing secret-input")).rejects.toThrow(
      "unknownCommand:missing",
    );
    expect(await a.expand("path", "/tmp/file.txt")).toBe("/tmp/file.txt");
    await a.dispose();
    await expect(a.expand("late", "/native:review one")).rejects.toThrow("closed");
    expect(await b.expand("next", "/native:review two")).toContain(`#2`);
    expect(await readFile(path.join(root, "lifecycle"), "utf8")).toContain(
      `close:${a.sessionId}:true`,
    );
  });

  it("refuses unsupported exports, undeclared capabilities, built-in replacement and malformed tools", async () => {
    const root = await directory();
    const cases = [
      { body: "export default h => ({ interactions: {} });", code: "invalid" },
      {
        body: "export default h => ({ agent: {name:h.id} });",
        code: "capability",
        capabilities: ["commands"] as const,
      },
      {
        body: "export default h => ({ agent: {name:h.id, tools:[{name:'read'}]} });",
        code: "invalid",
      },
      { body: "export default h => ({ agent: {name:h.id, tools:[null]} });", code: "invalid" },
      {
        body: "export default h => ({ commands:[{name:h.id + ':bad',description:'bad',expand:42}] });",
        code: "invalid",
      },
      { body: "export default () => { throw Error('secret-input'); };", code: "load" },
    ];
    for (const [index, item] of cases.entries()) {
      const spec = await extension(root, `invalid-${index}`, item.body);
      const value = new SessionExtensionHost(randomUUID(), root);
      cleanup.push(() => value.dispose());
      await expect(
        value.load([
          { ...spec, ...(item.capabilities ? { capabilities: [...item.capabilities] } : {}) },
        ]),
      ).rejects.toThrow(item.code);
    }
    const builtIn = new SessionExtensionHost(randomUUID(), root);
    cleanup.push(() => builtIn.dispose());
    await expect(
      builtIn.load([{ ...(await extension(root)), id: "coding-tools" }]),
    ).rejects.toThrow("duplicate");
  });

  it("cancels an in-flight expansion on close and retries only failed resource cleanup", async () => {
    const root = await directory();
    const spec = await extension(
      root,
      "waiting",
      `
      import { appendFile } from 'node:fs/promises';
      export default h => {
        let attempts = 0;
        return {
          commands: [{name: h.id + ':wait',description:'wait',expand: () => new Promise(resolve => {
            if (h.signal.aborted) resolve('late'); else h.signal.addEventListener('abort', () => resolve('late'), {once:true});
          })}],
          dispose: async () => { if (++attempts === 1) throw Error('private error'); await appendFile(${JSON.stringify(path.join(root, "disposed"))}, 'done'); }
        };
      }
    `,
    );
    const value = await host(root, spec);
    const input = value.expand("pending", "/waiting:wait").catch((error: unknown) => error);
    await value.stop();
    expect(await input).toBeInstanceOf(Error);
    await expect(value.dispose()).rejects.toThrow("disposeFailed:waiting");
    await value.dispose();
    await value.dispose();
    expect(await readFile(path.join(root, "disposed"), "utf8")).toBe("done");
  });

  it("validates the private extension DTO before admitting module paths", async () => {
    const root = await directory();
    const spec = await extension(root);
    const command = {
      op: "open",
      sessionId: randomUUID(),
      cwd: root,
      create: true,
      extensions: [spec],
    };
    expect(parseDurableCommand(command)).toEqual(command);
    expect(
      parseDurableCommand({ ...command, extensions: [{ ...spec, capabilities: ["ipc"] }] }),
    ).toBeNull();
    expect(
      parseDurableCommand({ ...command, extensions: [{ ...spec, entry: "bad\0path" }] }),
    ).toBeNull();
  });

  it("runs a native tool through the production provider, keeps original command history, and reopens without replay", async () => {
    const root = await directory();
    const spec = await extension(root);
    const sessionId = randomUUID();
    const updates: RuntimeSessionUpdate[] = [];
    const runtime = new DesktopRuntime((update) => updates.push(update));
    cleanup.push(() => runtime.dispose());
    const requests: Record<string, unknown>[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      requests.push(JSON.parse(body) as Record<string, unknown>);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const delta =
        requests.length === 1
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "identity",
                  type: "function",
                  function: { name: "native__identity", arguments: "{}" },
                },
              ],
            }
          : { role: "assistant", content: "Native extension passed." };
      response.write(
        `data: ${JSON.stringify({ id: "native-test", object: "chat.completion.chunk", created: 1, model: "native-test", choices: [{ index: 0, delta, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }] })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test endpoint.");
    await runtime.execute({
      op: "initialize",
      storageRoot: root,
      model: {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        api: "openai-completions",
        apiKey: "local-native-only",
        modelId: "native-test",
        contextWindow: 128000,
        maxTokens: 1024,
        reasoning: false,
      },
    });
    const open = { op: "open", sessionId, cwd: root, create: true, extensions: [spec] } as const;
    const [a, b] = await Promise.all([runtime.execute(open), runtime.execute(open)]);
    expect(a).toEqual(b);
    expect(await runtime.execute({ op: "commands", sessionId })).toEqual([
      { name: "plan", description: expect.any(String), source: "builtin" },
      { name: "native:review", description: "Review work", source: "extension" },
    ]);
    const input = {
      op: "submit",
      sessionId,
      requestId: randomUUID(),
      text: "/native:review changes",
      mode: "followUp",
    } as const;
    const admission = await runtime.execute(input);
    await until(() =>
      updates.some(
        (update) =>
          update.type === "settled" &&
          update.view.entries.some((entry) => entry.kind === "pi.assistant"),
      ),
    );
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[0])).toContain(`Expanded ${sessionId}: changes #1`);
    expect(JSON.stringify(requests[1])).toContain(sessionId);
    const page = (await runtime.execute({ op: "history", sessionId, limit: 100 })) as EntryRecord[];
    const commandEntry = page.find((entry) => entry.kind === "pidesk.prompt-command");
    expect(commandEntry).toBeDefined();
    if (!commandEntry) throw new Error("No command history.");
    expect(durableDisplayMessages(commandEntry)[0].content).toBe(input.text);
    const projection = new DurableProjection(sessionId);
    const initial = updates.find((update) => update.type === "snapshot");
    if (!initial) throw new Error("No snapshot.");
    projection.apply(initial);
    const projected = projection.apply({ type: "entries", sessionId, entries: [commandEntry] });
    expect(JSON.stringify(projected)).toContain(input.text);
    await runtime.execute({ op: "close", sessionId });
    await runtime.execute({ ...open, create: false });
    expect(await runtime.execute(input)).toEqual(admission);
    const reopened = (await runtime.execute({
      op: "history",
      sessionId,
      limit: 100,
    })) as EntryRecord[];
    expect(
      reopened.filter((entry) => entry.model?.some((message) => message.role === "user")),
    ).toHaveLength(1);
    expect(requests).toHaveLength(2);
    const lifecycle = await readFile(path.join(root, "lifecycle"), "utf8");
    expect(lifecycle.split("\n").filter((line) => line.startsWith("open:"))).toHaveLength(2);
    expect(lifecycle).toContain(`close:${sessionId}:true`);
  });

  it("rolls back loaded instances if a later module fails and allows a corrected reopen", async () => {
    const root = await directory();
    const good = await extension(root);
    const bad = await extension(
      root,
      "broken",
      "export default () => { throw Error('private failure'); };",
    );
    const runtime = new DesktopRuntime(() => {});
    cleanup.push(() => runtime.dispose());
    await runtime.execute({ op: "initialize", storageRoot: root });
    const sessionId = randomUUID();
    await expect(
      runtime.execute({ op: "open", sessionId, cwd: root, create: true, extensions: [good, bad] }),
    ).rejects.toThrow("load:broken");
    expect(await readFile(path.join(root, "lifecycle"), "utf8")).toContain(
      `close:${sessionId}:true`,
    );
    await runtime.execute({ op: "open", sessionId, cwd: root, create: true, extensions: [good] });
    expect(await runtime.execute({ op: "commands", sessionId })).toEqual([
      { name: "plan", description: expect.any(String), source: "builtin" },
      { name: "native:review", description: "Review work", source: "extension" },
    ]);
  });
});
