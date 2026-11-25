import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopRuntime } from "../../agentRuntime/desktopRuntime";
import { type SessionEntry, sessionEntriesReducer } from "../../renderer/stores/sessionTranscript";
import {
  parseDurableCommand,
  parseRuntimeUpdate,
  type RuntimeSessionUpdate,
} from "../../shared/durableProtocol";
import { DurableProjection } from "./durableProjection";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function chunk(response: ServerResponse, delta: unknown, finish: string | null = null): void {
  response.write(
    `data: ${JSON.stringify({ id: "chat-test", object: "chat.completion.chunk", created: 1, model: "desktop-test", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
  );
}
function finish(response: ServerResponse): void {
  response.write(
    `data: ${JSON.stringify({ id: "chat-test", object: "chat.completion.chunk", created: 1, model: "desktop-test", choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Desktop session did not reach the expected state.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function fixture(
  onRequest: (response: ServerResponse, body: Record<string, unknown>) => void,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "pidesk-desktop-protocol-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    expect(request.headers.authorization).toBe("Bearer test-only-key");
    expect(request.url).toBe("/v1/chat/completions");
    const parsed = JSON.parse(body) as Record<string, unknown>;
    requests.push(parsed);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    onRequest(response, parsed);
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
  if (!address || typeof address === "string") throw new Error("Missing local test endpoint.");
  const updates: RuntimeSessionUpdate[] = [];
  const projection = new DurableProjection("00000000-0000-4000-8000-000000000001");
  let entries: SessionEntry[] = [];
  const runtime = new DesktopRuntime((update) => {
    const wire: unknown = JSON.parse(JSON.stringify(update));
    expect(parseRuntimeUpdate(wire)).not.toBeNull();
    updates.push(update);
    for (const action of projection.apply(update)) {
      entries = sessionEntriesReducer(
        entries,
        action.type === "events"
          ? { type: "events", events: action.events }
          : {
              type: "event",
              event: {
                type: "durable_projection",
                ref: { kind: "durable", id: update.sessionId },
                action,
              },
            },
      );
    }
  });
  cleanup.push(() => runtime.dispose());
  await runtime.execute({
    op: "initialize",
    storageRoot: directory,
    model: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      api: "openai-completions",
      apiKey: "test-only-key",
      modelId: "desktop-test",
      contextWindow: 128000,
      maxTokens: 1024,
      reasoning: false,
    },
  });
  const sessionId = "00000000-0000-4000-8000-000000000001";
  await runtime.execute({ op: "open", sessionId, cwd: directory, create: true });
  return { runtime, directory, sessionId, requests, updates, entries: () => entries };
}

describe("desktop production provider, DTO and transcript integration", () => {
  it("sends text and image-only submissions to the provider and restores their images from SQLite", async () => {
    const f = await fixture((response) => {
      chunk(response, { role: "assistant", content: "Images received." });
      chunk(response, {}, "stop");
      finish(response);
    });
    const images = [
      { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
      { type: "image", data: "/9j/4AAQ", mimeType: "image/jpeg" },
    ] as const;
    for (const [index, text] of ["Describe both images", ""].entries()) {
      const command = parseDurableCommand({
        op: "submit",
        sessionId: f.sessionId,
        requestId: `images-${index}`,
        text,
        images,
        mode: "followUp",
      });
      if (!command) throw new Error("Image command did not pass validation.");
      const admission = await f.runtime.execute(command);
      expect(await f.runtime.execute(command)).toEqual(admission);
      await until(
        () =>
          f.entries().filter((entry) => entry.kind === "run" && entry.status === "completed")
            .length ===
          index + 1,
      );
      const request = f.requests.at(-1);
      if (!request) throw new Error("No image request reached the provider.");
      const users = (request.messages as { role: string; content: unknown }[]).filter(
        (message) => message.role === "user",
      );
      expect(users.at(-1)?.content).toEqual([
        ...(text ? [{ type: "text", text }] : []),
        ...images.map((image) => ({
          type: "image_url",
          image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        })),
      ]);
    }
    const expected = images.map((image) => ({
      src: `data:${image.mimeType};base64,${image.data}`,
      mimeType: image.mimeType,
    }));
    expect(f.entries().filter((entry) => entry.kind === "user")).toMatchObject([
      { text: "Describe both images", images: expected },
      { text: "", images: expected },
    ]);
    await f.runtime.execute({ op: "close", sessionId: f.sessionId });
    await f.runtime.execute({
      op: "open",
      sessionId: f.sessionId,
      cwd: f.directory,
      create: false,
    });
    expect(f.entries().filter((entry) => entry.kind === "user")).toMatchObject([
      { text: "Describe both images", images: expected },
      { text: "", images: expected },
    ]);
    expect(f.requests).toHaveLength(2);
  });

  it("streams through OpenAI transport, executes a real read tool, deduplicates usage and reopens SQLite by UUID", async () => {
    let call = 0;
    const f = await fixture((response) => {
      if (++call === 1) {
        chunk(response, { role: "assistant", content: "Reading " });
        setTimeout(() => {
          chunk(response, {
            tool_calls: [
              {
                index: 0,
                id: "read-1",
                type: "function",
                function: { name: "read", arguments: '{"path":"fixture.txt"}' },
              },
            ],
          });
          chunk(response, {}, "tool_calls");
          finish(response);
        }, 100);
      } else {
        chunk(response, { role: "assistant", content: "Saved " });
        setTimeout(() => {
          chunk(response, { content: "result" });
          chunk(response, {}, "stop");
          finish(response);
        }, 100);
      }
    });
    await writeFile(path.join(f.directory, "fixture.txt"), "tool result from disk");
    const command = {
      op: "submit",
      sessionId: f.sessionId,
      requestId: randomUUID(),
      text: "Read fixture.txt",
      mode: "followUp",
    } as const;
    const admission = await f.runtime.execute(command);
    expect(await f.runtime.execute(command)).toEqual(admission);
    await until(() => {
      const error = f.updates.find((update) => update.type === "error");
      if (error?.type === "error") throw new Error(error.error);
      return (
        f.updates.some(
          (update) =>
            update.type === "settled" &&
            update.view.entries.some((entry) => entry.kind === "pi.assistant"),
        ) &&
        f.updates.some(
          (update) =>
            update.type === "entries" &&
            update.entries.some((entry) => entry.kind === "pi.tool-result"),
        )
      );
    });
    expect(f.requests).toHaveLength(2);
    expect(JSON.stringify(f.requests[1])).toContain("tool result from disk");
    expect(
      f.updates.some(
        (update) => update.type === "live" && !!update.view.docs["pi.live"]?.generation,
      ),
    ).toBe(true);
    const tools = f
      .entries()
      .flatMap((entry) =>
        entry.kind === "assistant" ? entry.blocks.filter((block) => block.kind === "tool") : [],
      );
    expect(tools).toMatchObject([{ status: "ok" }]);
    expect(f.entries().filter((entry) => entry.kind === "user")).toHaveLength(1);
    const usage = () =>
      f
        .entries()
        .reduce(
          (sum, entry) => sum + (entry.kind === "run" ? (entry.usage?.totalTokens ?? 0) : 0),
          0,
        );
    expect(usage()).toBe(20);
    await f.runtime.execute({ op: "close", sessionId: f.sessionId });
    f.updates.length = 0;
    await f.runtime.execute({
      op: "open",
      sessionId: f.sessionId,
      cwd: f.directory,
      create: false,
    });
    expect(usage()).toBe(20);
    expect(f.entries().filter((entry) => entry.kind === "user")).toHaveLength(1);
    expect(f.updates.filter((update) => update.type === "entries")).toHaveLength(0);
    expect(f.requests).toHaveLength(2);
    expect(
      await f.runtime.execute({ op: "history", sessionId: f.sessionId, limit: 1 }),
    ).toHaveLength(1);
    await expect(
      f.runtime.execute({ op: "open", sessionId: randomUUID(), cwd: f.directory, create: false }),
    ).rejects.toThrow();
  });

  it("persists resource commands, refreshes instructions before recovery and honors resource removal on reopen", async () => {
    const f = await fixture((response) => {
      chunk(response, { role: "assistant", content: "Resource request passed." });
      chunk(response, {}, "stop");
      finish(response);
    });
    await f.runtime.execute({ op: "close", sessionId: f.sessionId });
    const file = path.join(f.directory, "review.md");
    await writeFile(
      file,
      "---\nname: review\ndescription: Review the workspace\n---\nRESOURCE_BODY_ONE",
    );
    await writeFile(path.join(f.directory, "AGENTS.md"), "INSTRUCTIONS_ONE");
    const open = {
      op: "open",
      sessionId: f.sessionId,
      cwd: f.directory,
      create: false,
      resources: [{ kind: "skill", root: f.directory, file, scope: "project" }],
    } as const;
    await f.runtime.execute(open);
    const command = {
      op: "submit",
      sessionId: f.sessionId,
      requestId: randomUUID(),
      text: "/skill:review changes",
      images: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
      mode: "followUp",
    } as const;
    const admission = await f.runtime.execute(command);
    await until(() => f.entries().some((entry) => entry.kind === "assistant"));
    await until(() =>
      f.updates.some(
        (update) =>
          update.type === "settled" &&
          update.view.entries.some((entry) => entry.kind === "pi.assistant"),
      ),
    );
    expect(JSON.stringify(f.requests[0])).toContain("INSTRUCTIONS_ONE");
    expect(JSON.stringify(f.requests[0])).toContain("RESOURCE_BODY_ONE");
    expect(f.entries().filter((entry) => entry.kind === "user")).toMatchObject([
      {
        text: command.text,
        images: [{ src: "data:image/png;base64,AAAA", mimeType: "image/png" }],
      },
    ]);
    await f.runtime.execute({ op: "close", sessionId: f.sessionId });
    await writeFile(file, "---\nname: review\ndescription: Updated review\n---\nRESOURCE_BODY_TWO");
    await writeFile(path.join(f.directory, "AGENTS.md"), "INSTRUCTIONS_TWO");
    f.updates.length = 0;
    await f.runtime.execute(open);
    expect(await f.runtime.execute(command)).toEqual(admission);
    expect(f.requests).toHaveLength(1);
    const snapshot = f.updates.find((update) => update.type === "snapshot");
    expect(snapshot?.type === "snapshot" && snapshot.view.docs["pi.agent"]?.instructions).toContain(
      "INSTRUCTIONS_TWO",
    );
    expect(
      snapshot?.type === "snapshot" && snapshot.view.docs["pi.agent"]?.instructions,
    ).not.toContain("INSTRUCTIONS_ONE");
    await f.runtime.execute({ ...command, requestId: randomUUID() });
    await until(() => f.requests.length === 2);
    expect(JSON.stringify(f.requests[1])).toContain("RESOURCE_BODY_TWO");
    expect(JSON.stringify(f.requests[1])).toContain("INSTRUCTIONS_TWO");
    await f.runtime.execute({ op: "close", sessionId: f.sessionId });
    await f.runtime.execute({ ...open, resources: [] });
    expect(await f.runtime.execute({ op: "commands", sessionId: f.sessionId })).toEqual([]);
    await expect(f.runtime.execute({ ...command, requestId: randomUUID() })).rejects.toThrow(
      "unknownCommand",
    );
    expect(f.requests).toHaveLength(2);
    await f.runtime.execute({ op: "close", sessionId: f.sessionId });
    await rm(path.join(f.directory, "AGENTS.md"));
    f.updates.length = 0;
    await f.runtime.execute({ ...open, resources: [] });
    const cleared = f.updates.find((update) => update.type === "snapshot");
    expect(cleared?.type === "snapshot" && cleared.view.docs["pi.agent"]?.instructions).toBe("");
  });

  it("queues steer and follow-up submissions, withdraws only one, and aborts a streaming provider", async () => {
    const held: ServerResponse[] = [];
    const f = await fixture((response) => {
      held.push(response);
      chunk(response, { role: "assistant", content: "partial" });
    });
    await f.runtime.execute({
      op: "submit",
      sessionId: f.sessionId,
      requestId: "active",
      text: "active",
      mode: "followUp",
    });
    await until(() => held.length === 1);
    const steer = (await f.runtime.execute({
      op: "submit",
      sessionId: f.sessionId,
      requestId: "steer",
      text: "steer",
      mode: "steer",
    })) as { submissionId: number; disposition: string };
    const follow = (await f.runtime.execute({
      op: "submit",
      sessionId: f.sessionId,
      requestId: "follow",
      text: "follow",
      mode: "followUp",
    })) as { submissionId: number; disposition: string };
    expect(steer.disposition).toBe("queued");
    expect(follow.disposition).toBe("queued");
    expect(
      await f.runtime.execute({
        op: "withdraw",
        sessionId: f.sessionId,
        submissionId: follow.submissionId,
      }),
    ).toBe("aborted");
    expect(f.requests).toHaveLength(1);
    await f.runtime.execute({ op: "abort", sessionId: f.sessionId });
    await until(() =>
      f.updates.some(
        (update) => update.type === "settled" && update.view.docs["pi.live"]?.runFailure,
      ),
    );
    expect(f.entries().findLast((entry) => entry.kind === "run")?.status).toBe("interrupted");
    expect(f.requests).toHaveLength(1);
  });
});
