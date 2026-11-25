import type { ConversationView, EntryRecord } from "@earendil-works/pi-durable";
import type { SessionPushMessage, SessionTranscriptPayload } from "../../shared/ipc";

type HistoryPage<T> = { items: readonly T[]; nextBefore?: number | null };

/** Collect bounded pages before rebuilding runs, which can span a page boundary. */
async function readHistoryPages<T>(
  readPage: (before?: number) => Promise<HistoryPage<T>>,
  before?: number,
): Promise<T[]> {
  const pages: (readonly T[])[] = [];
  for (;;) {
    const page = await readPage(before);
    pages.push(page.items);
    if (page.nextBefore == null) return pages.reverse().flat();
    if (
      !Number.isSafeInteger(page.nextBefore) ||
      page.nextBefore < 1 ||
      (before !== undefined && page.nextBefore >= before)
    )
      throw new Error("History cursor did not advance.");
    before = page.nextBefore;
  }
}

/** Read the full saved transcript through the existing bounded IPC pages. */
export async function readCompleteTranscript(
  readPage: (before?: number) => Promise<SessionTranscriptPayload>,
): Promise<SessionTranscriptPayload> {
  let startedAt: number | null = null;
  const messages = await readHistoryPages(async (before) => {
    const page = await readPage(before);
    startedAt ??= page.startedAt;
    return { items: page.messages, nextBefore: page.nextBefore };
  });
  return { messages, startedAt, truncated: false, nextBefore: null };
}

async function completeDurableView(
  view: ConversationView,
  readPage: (before: number) => Promise<readonly EntryRecord[]>,
): Promise<ConversationView> {
  const before = view.entries[0]?.id ?? (view.before ?? 0) + 1;
  const earlier = await readHistoryPages(async (cursor) => {
    const page = await readPage(cursor ?? before);
    return {
      items: [...page].reverse(),
      nextBefore: page.length === 100 ? page.at(-1)?.id : null,
    };
  }, before);
  const { before: _before, ...complete } = view;
  return { ...complete, entries: [...earlier, ...view.entries] };
}

/** Hold each session's live events until its complete saved history has been hydrated. */
export function createSessionHistoryHydrator(
  readPage: (sessionId: string, before: number) => Promise<readonly EntryRecord[]>,
  emit: (message: SessionPushMessage) => void,
): (message: SessionPushMessage) => void {
  const pending = new Map<string, SessionPushMessage[]>();
  const accept = (message: SessionPushMessage): void => {
    const queued = pending.get(message.sessionId);
    if (queued) {
      queued.push(message);
      return;
    }
    if (
      message.type !== "event" ||
      message.payload.type !== "durable_projection" ||
      message.payload.action.type !== "hydrate" ||
      message.payload.action.view.before === undefined
    ) {
      emit(message);
      return;
    }
    const view = message.payload.action.view;
    const { sessionId, payload } = message;
    const queue: SessionPushMessage[] = [];
    pending.set(sessionId, queue);
    void completeDurableView(view, (before) => readPage(sessionId, before))
      .then((view) => {
        emit({
          ...message,
          payload: { ...payload, action: { type: "hydrate", view } },
        });
      })
      .catch((error: unknown) => {
        emit(message);
        emit({
          sessionId,
          type: "error",
          payload: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        pending.delete(sessionId);
        for (const next of queue) accept(next);
      });
  };
  return accept;
}
