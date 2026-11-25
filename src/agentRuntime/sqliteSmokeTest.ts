import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  defineTool,
  type SubmissionId,
} from "@earendil-works/pi-durable";
import { DurableSessions, type DurableSessionUpdate } from "./durableSessions.js";

const SMOKE_REPLY = "PiDesk Durable SQLite round-trip passed.";

/** Exercise the production session owner with real SQLite and a local model, including tool and reopen boundaries. */
export async function runDurableSqliteSmokeTest(directory: string): Promise<{
  conversationId: number;
  reply: string;
}> {
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("smoke", {}, { id: "smoke-tool" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(SMOKE_REPLY),
  ]);
  const registry = createRegistry();
  let toolCalls = 0;
  registry.install(
    defineExtension({
      name: "pidesk-smoke",
      tools: [
        defineTool({
          name: "smoke",
          description: "Local runtime verification; no files or network.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
          replay: "safe",
          execute: async () => {
            ++toolCalls;
            return { output: [{ type: "text", text: "tool committed" }] };
          },
        }),
      ],
    }),
  );

  const updates: DurableSessionUpdate[] = [];
  let onUpdate: (() => void) | undefined;
  const service = new DurableSessions(
    directory,
    () => ({ models, registry }),
    (update) => {
      updates.push(update);
      onUpdate?.();
    },
  );
  const sessionId = randomUUID();
  const request = {
    sessionId,
    cwd: directory,
    agent: { model: { provider: faux.provider.id, modelId: faux.models[0].id } },
  };
  try {
    const [opened, duplicateOpen] = await Promise.all([
      service.open(request),
      service.open(request),
    ]);
    assert.deepEqual(opened, duplicateOpen);
    assert.equal(updates.filter((update) => update.type === "snapshot").length, 1);
    const draft = {
      type: "input",
      content: "Run the local Durable SQLite smoke test.",
      requestId: "smoke-input",
    } as const;
    const [submission, duplicate] = await Promise.all([
      service.submit(sessionId, draft),
      service.submit(sessionId, draft),
    ]);
    assert.deepEqual(submission, duplicate);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Durable session did not settle.")), 30_000);
      const check = () => {
        const error = updates.find((update) => update.type === "error");
        if (error?.type === "error") {
          clearTimeout(timer);
          reject(new Error(error.error));
        } else if (
          updates.some(
            (update) =>
              update.type === "settled" &&
              update.view.entries.some((entry) => entry.kind === "pi.assistant"),
          )
        ) {
          clearTimeout(timer);
          resolve();
        }
      };
      onUpdate = check;
      check();
    });
    const settled = await service.submission(sessionId, submission.submissionId as SubmissionId);
    assert.equal(settled?.status, "done");
    assert.equal(toolCalls, 1);
    const emitted = updates
      .filter((update) => update.type === "entries")
      .flatMap((update) => update.entries);
    assert.equal(new Set(emitted.map((entry) => entry.id)).size, emitted.length);
    assert.equal(emitted.filter((entry) => entry.kind === "pi.tool-result").length, 1);
    await service.close(sessionId);

    updates.length = 0;
    assert.deepEqual(await service.open(request), opened);
    assert.deepEqual(await service.submit(sessionId, draft), submission);
    assert.equal(faux.state.callCount, 2);
    const persisted = await service.entries(sessionId);
    const answer = persisted.find((entry) => entry.id === settled?.answer);
    const reply = answer?.model
      ?.flatMap((message) =>
        message.role === "assistant"
          ? message.content.filter((block) => block.type === "text").map((block) => block.text)
          : [],
      )
      .join("");
    assert.equal(reply, SMOKE_REPLY);
    assert.equal(updates.filter((update) => update.type === "entries").length, 0);
    return { conversationId: opened.conversationId, reply };
  } finally {
    onUpdate = undefined;
    await service.dispose();
  }
}
