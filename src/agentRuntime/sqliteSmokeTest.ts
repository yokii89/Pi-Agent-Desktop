import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import type { ConversationId, EntryId, EntryRecord } from "@earendil-works/pi-durable";
import { AssistantEntry, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const SMOKE_REPLY = "PiDesk Durable SQLite round-trip passed.";

function makeModels() {
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage(SMOKE_REPLY)]);
  return { models, faux };
}

function assistantText(entry: EntryRecord | undefined): string | null {
  if (!AssistantEntry.is(entry)) return null;
  for (const message of entry.model ?? []) {
    if (message.role !== "assistant") continue;
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (text) return text;
  }
  return null;
}

/** Opens a real Node SQLite database, completes one faux-model turn, then reopens and verifies its transcript. */
export async function runDurableSqliteSmokeTest(databasePath: string): Promise<{
  conversationId: number;
  reply: string;
}> {
  const context = BACKGROUND_CONTEXT;
  const firstModels = makeModels();
  const firstHarness = await Harness.open(
    await openNodeSqliteStorage(databasePath),
    { models: firstModels.models, registry: createRegistry() },
    context,
  );

  let conversationId: ConversationId;
  let answerId: EntryId;
  try {
    const conversation = await firstHarness.root(context, {
      agent: {
        model: {
          provider: firstModels.faux.provider.id,
          modelId: firstModels.faux.models[0].id,
        },
      },
    });
    conversationId = conversation.id;
    const submission = await conversation.submit(
      { type: "input", content: "Run the local Durable SQLite smoke test." },
      context,
    );
    const settled = await submission.wait(context);
    if (settled.status !== "done" || settled.answer === undefined) {
      throw new Error(`Faux-model submission did not complete with an answer: ${settled.status}`);
    }
    answerId = settled.answer;
    const answer = await conversation.commit((tx) => tx.entry(AssistantEntry, answerId), context);
    if (assistantText(answer) !== SMOKE_REPLY) {
      throw new Error("Faux model did not produce the expected assistant entry.");
    }
  } finally {
    await firstHarness.close(context);
  }

  const secondModels = makeModels();
  const reopenedHarness = await Harness.open(
    await openNodeSqliteStorage(databasePath),
    { models: secondModels.models, registry: createRegistry() },
    context,
  );
  try {
    const conversation = await reopenedHarness.conversation(conversationId, context);
    if (!conversation) throw new Error("Conversation was missing after reopening SQLite storage.");
    const watch = await conversation.watch(context, { min: 1, max: 100 });
    try {
      const persistedAnswer = watch.value.entries.find((entry) => entry.id === answerId);
      const reply = assistantText(persistedAnswer);
      if (reply !== SMOKE_REPLY) {
        throw new Error(
          "Assistant transcript did not survive closing and reopening SQLite storage.",
        );
      }
      return { conversationId, reply };
    } finally {
      await watch.stop();
    }
  } finally {
    await reopenedHarness.close(context);
  }
}
