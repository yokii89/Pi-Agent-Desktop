import { access, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type {
  AgentChange,
  Conversation,
  ConversationView,
  ConversationWatch,
  EntryId,
  EntryRecord,
  HarnessOptions,
  SubmissionDraft,
  SubmissionId,
  SubmissionRecord,
} from "@earendil-works/pi-durable";
import { Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { DurableSessionUpdate } from "../shared/durableSession.js";

export type { DurableSessionUpdate } from "../shared/durableSession.js";

const context = BACKGROUND_CONTEXT;
const PAGE_SIZE = 100;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// All service instances in this utility process share writer ownership, including aliased storage roots.
const writers = new Set<string>();

interface OpenSession {
  harness: Harness;
  conversation: Conversation;
  watch: ConversationWatch;
  writerKey: string;
  lastEntry?: EntryId;
  listener: Promise<void>;
  epoch: number;
  settledEpoch: number;
}

interface SessionSlot {
  cwd: string;
  opening: Promise<OpenSession>;
  accepting: boolean;
  operations: Set<Promise<unknown>>;
  closing?: Promise<void>;
}

export interface DurableSessionOptions {
  sessionId: string;
  cwd: string;
  /** Applied only when creating the root. Later changes go through configure(). */
  create?: boolean;
  agent?: AgentChange;
}

/** Owns one SQLite writer and one root conversation per top-level desktop session. Not a public extension API. */
export class DurableSessions {
  private readonly sessions = new Map<string, SessionSlot>();
  private stopping = false;
  private shutdown?: Promise<void>;

  constructor(
    private readonly storageRoot: string,
    private readonly options: (sessionId: string) => HarnessOptions,
    private readonly publish: (update: DurableSessionUpdate) => void,
  ) {
    if (!path.isAbsolute(storageRoot)) throw new Error("Durable storage root must be absolute.");
  }

  /** Concurrent opens share the same Harness. A closing session must finish before it can reopen. */
  async open(request: DurableSessionOptions): Promise<{ conversationId: number }> {
    if (this.stopping) throw new Error("Durable session service is closing.");
    if (!SESSION_ID.test(request.sessionId)) throw new Error("Invalid Durable session ID.");
    if (!path.isAbsolute(request.cwd)) throw new Error("Durable session cwd must be absolute.");
    const sessionId = request.sessionId.toLowerCase();
    const cwd = path.resolve(request.cwd);
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (!existing.accepting) throw new Error("Durable session is closing.");
      if (existing.cwd !== cwd) throw new Error("Durable session is already open in another cwd.");
      const session = await existing.opening;
      return { conversationId: session.conversation.id };
    }

    const slot: SessionSlot = {
      cwd,
      accepting: true,
      operations: new Set(),
      opening: this.create(sessionId, cwd, request.agent, request.create),
    };
    this.sessions.set(sessionId, slot);
    try {
      const session = await slot.opening;
      return { conversationId: session.conversation.id };
    } catch (error) {
      if (this.sessions.get(sessionId) === slot) this.sessions.delete(sessionId);
      throw error;
    }
  }

  /** Admit a durable input/continue/write; requestId deduplication belongs to Durable storage. */
  submit(sessionId: string, draft: SubmissionDraft): Promise<{ submissionId: number }> {
    return this.run(sessionId, async (session) => {
      const epoch = ++session.epoch;
      try {
        const submission = await session.conversation.submit(draft, context);
        return { submissionId: submission.id };
      } finally {
        // A rejected busy admission must not invalidate the active run's idle observer.
        this.observeIdle(sessionId.toLowerCase(), session, epoch);
      }
    });
  }

  /** Read one submission without waiting for the model or holding session shutdown open. */
  submission(sessionId: string, submissionId: SubmissionId): Promise<SubmissionRecord | undefined> {
    return this.run(sessionId, async (session) => {
      const submission = await session.harness.submission(submissionId, context);
      const record = await submission?.status(context);
      return record?.conversationId === session.conversation.id ? record : undefined;
    });
  }

  /** Withdraw only the selected queued item; this cannot abort the current run. */
  withdraw(sessionId: string, submissionId: SubmissionId) {
    return this.run(sessionId, (session) =>
      session.harness.abortSubmission(submissionId, context, session.conversation.id),
    );
  }

  /** Stop the foreground ownership scope, including parked tools, and withdraw its queued inputs. */
  abort(sessionId: string): Promise<void> {
    return this.run(sessionId, async (session) => {
      const epoch = ++session.epoch;
      await session.conversation.abort(context);
      this.observeIdle(sessionId.toLowerCase(), session, epoch);
    });
  }

  /** Persist model/thinking/tool configuration per conversation; no global environment mutation. */
  configure(sessionId: string, change: AgentChange): Promise<void> {
    if (change.cwd !== undefined)
      return Promise.reject(new Error("Session cwd cannot be changed."));
    return this.run(sessionId, (session) => session.conversation.configure(change, context));
  }

  /** Admit manual compaction without waiting for its model request. */
  compact(sessionId: string, instructions?: string): Promise<{ taskId: number }> {
    return this.run(sessionId, async (session) => {
      const epoch = ++session.epoch;
      try {
        const taskId = await session.conversation.compact(instructions, context);
        return { taskId };
      } finally {
        this.observeIdle(sessionId.toLowerCase(), session, epoch);
      }
    });
  }

  /** Page persisted transcript entries. Live partial messages are never returned as history. */
  entries(sessionId: string, before?: EntryId, limit = PAGE_SIZE): Promise<readonly EntryRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE) {
      return Promise.reject(new Error("Durable history page size must be between 1 and 100."));
    }
    return this.run(sessionId, async (session) => {
      const page = await session.conversation.entries(
        {
          order: "descending",
          ...(before === undefined ? {} : { maxEntryId: (before - 1) as EntryId }),
        },
        limit,
        undefined,
        context,
      );
      return page.items;
    });
  }

  /** Read an authoritative attachment snapshot without creating another writer or resuming twice. */
  snapshot(sessionId: string): Promise<ConversationView> {
    return this.run(sessionId, async (session) => {
      const watch = await session.conversation.watch(context, {
        min: PAGE_SIZE,
        max: PAGE_SIZE * 2,
      });
      try {
        return watch.value;
      } finally {
        await watch.stop();
      }
    });
  }

  /** Atomically verify ownership settlement before retiring this writer. */
  async closeIdle(sessionId: string): Promise<boolean> {
    const slot = this.sessions.get(sessionId.toLowerCase());
    if (!slot?.accepting) return false;
    const session = await slot.opening;
    if (!slot.accepting || slot.operations.size || session.epoch !== session.settledEpoch)
      return false;
    await this.close(sessionId);
    return true;
  }

  /** Stop admissions, drain already admitted operations and callbacks, then flush and close SQLite. */
  close(sessionId: string): Promise<void> {
    const key = sessionId.toLowerCase();
    const slot = this.sessions.get(key);
    if (!slot) return Promise.resolve();
    if (slot.closing) return slot.closing;
    slot.accepting = false;
    const closing = this.closeSlot(key, slot).finally(() => {
      if (slot.closing === closing) slot.closing = undefined;
    });
    slot.closing = closing;
    return closing;
  }

  /** Close every session. A failed close keeps its writer lease and can be retried. */
  dispose(): Promise<void> {
    this.stopping = true;
    if (this.shutdown) return this.shutdown;
    const shutdown = Promise.allSettled([...this.sessions.keys()].map((id) => this.close(id)))
      .then((results) => {
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length) throw new AggregateError(errors, "Could not close Durable sessions.");
      })
      .finally(() => {
        if (this.shutdown === shutdown) this.shutdown = undefined;
      });
    this.shutdown = shutdown;
    return shutdown;
  }

  private async create(
    sessionId: string,
    cwd: string,
    agent?: AgentChange,
    create?: boolean,
  ): Promise<OpenSession> {
    const directory = path.join(this.storageRoot, sessionId);
    if (create === false) await access(path.join(directory, "session.sqlite"));
    await mkdir(directory, { recursive: true });
    const canonical = await realpath(directory);
    const writerKey = process.platform === "win32" ? canonical.toLowerCase() : canonical;
    if (writers.has(writerKey)) throw new Error("Durable database already has a writer.");
    writers.add(writerKey);
    let harness: Harness | undefined;
    let storage: Awaited<ReturnType<typeof openNodeSqliteStorage>> | undefined;
    try {
      const runtimeOptions = this.options(sessionId);
      storage = await openNodeSqliteStorage(path.join(canonical, "session.sqlite"));
      harness = await Harness.open(storage, runtimeOptions, context);
      const conversation = await harness.root(context, { agent: { ...agent, cwd } });
      if ((await conversation.agent(context)).cwd !== cwd) {
        throw new Error("Persisted Durable session belongs to another cwd.");
      }
      const watch = await conversation.watch(context, { min: PAGE_SIZE, max: PAGE_SIZE * 2 });
      const session: OpenSession = {
        harness,
        conversation,
        watch,
        writerKey,
        lastEntry: watch.value.entries.at(-1)?.id ?? watch.value.before,
        listener: Promise.resolve(),
        epoch: 0,
        settledEpoch: -1,
      };
      this.emit({ type: "snapshot", sessionId, view: watch.value });
      watch.start(async (call) => {
        await this.enqueue(sessionId, session, async () => {
          if (call.kind === "failed") throw call.error;
          await this.advance(sessionId, session, call.value);
        });
      });
      void watch.closed.then((end) => {
        if (end.kind === "failed" || end.kind === "listener_error") {
          this.emit({ type: "error", sessionId, error: errorText(end.error) });
        }
      });
      // Only the runtime owns resumption. Reopening does not create another user input.
      harness.resume();
      this.observeIdle(sessionId, session, session.epoch);
      return session;
    } catch (error) {
      // Never release ownership before SQLite has actually closed.
      if (harness) await harness.close(context);
      else await storage?.close(context);
      writers.delete(writerKey);
      throw error;
    }
  }

  private async advance(
    sessionId: string,
    session: OpenSession,
    view: ConversationView,
    includeLive = true,
  ): Promise<void> {
    const tail = view.entries.at(-1)?.id;
    if (tail !== undefined && (session.lastEntry === undefined || tail > session.lastEntry)) {
      // A watch folds commits and drops its oldest window. Read the missing interval from storage.
      let cursor: Parameters<Conversation["entries"]>[2];
      const minEntryId =
        session.lastEntry === undefined ? undefined : ((session.lastEntry + 1) as EntryId);
      do {
        const page = await session.conversation.entries(
          { order: "ascending", minEntryId, maxEntryId: tail },
          PAGE_SIZE,
          cursor,
          context,
        );
        if (page.items.length) {
          this.emit({ type: "entries", sessionId, entries: page.items });
          session.lastEntry = page.items.at(-1)?.id;
        }
        cursor = page.next;
      } while (cursor !== undefined);
    }
    if (includeLive) this.emit({ type: "live", sessionId, view });
  }

  private observeIdle(sessionId: string, session: OpenSession, epoch: number): void {
    // Submission.wait() ends before afterRun work. The ownership-aware wait is the settlement boundary.
    void session.conversation
      .waitForIdle(context)
      .then(async () => {
        const slot = this.sessions.get(sessionId);
        if (!slot?.accepting || session.epoch !== epoch) return;
        const watch = await session.conversation.watch(context, { min: 1, max: 1 });
        try {
          await this.enqueue(sessionId, session, async () => {
            if (slot.accepting && session.epoch === epoch && session.settledEpoch !== epoch) {
              if (watch.value.docs["pi.live"]?.run) {
                this.observeIdle(sessionId, session, epoch);
                return;
              }
              await this.advance(sessionId, session, watch.value, false);
              // A new admission can land while the history scan awaits SQLite.
              if (!slot.accepting || session.epoch !== epoch) return;
              session.settledEpoch = epoch;
              this.emit({ type: "settled", sessionId, view: watch.value });
            }
          });
        } finally {
          await watch.stop();
        }
      })
      .catch((error: unknown) => {
        if (this.sessions.get(sessionId)?.accepting) {
          this.emit({ type: "error", sessionId, error: errorText(error) });
        }
      });
  }

  private enqueue(
    sessionId: string,
    session: OpenSession,
    work: () => Promise<void>,
  ): Promise<void> {
    const next = session.listener.then(work).catch((error: unknown) => {
      this.emit({ type: "error", sessionId, error: errorText(error) });
    });
    session.listener = next;
    return next;
  }

  private run<T>(sessionId: string, operation: (session: OpenSession) => Promise<T>): Promise<T> {
    const slot = this.sessions.get(sessionId.toLowerCase());
    if (this.stopping || !slot?.accepting)
      return Promise.reject(new Error("Durable session is not open."));
    const result = slot.opening.then(operation);
    slot.operations.add(result);
    void result.finally(() => slot.operations.delete(result)).catch(() => undefined);
    return result;
  }

  private async closeSlot(sessionId: string, slot: SessionSlot): Promise<void> {
    let session: OpenSession;
    try {
      session = await slot.opening;
    } catch {
      return;
    }
    await Promise.allSettled([...slot.operations]);
    ++session.epoch;
    await session.watch.stop();
    await session.listener;
    await session.harness.close(context);
    writers.delete(session.writerKey);
    if (this.sessions.get(sessionId) === slot) this.sessions.delete(sessionId);
  }

  private emit(update: DurableSessionUpdate): void {
    // A host callback must not fail a SQLite commit or strand a watch.
    try {
      this.publish(update);
    } catch {
      // Transport owners handle disconnected consumers; persistence continues independently.
    }
  }
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}
