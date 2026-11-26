import { access, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type {
  AgentChange,
  AgentState,
  Conversation,
  ConversationView,
  ConversationWatch,
  DocumentWatch,
  EntryId,
  EntryRecord,
  HarnessOptions,
  SubmissionDraft,
  SubmissionId,
  SubmissionRecord,
  TaskId,
} from "@earendil-works/pi-durable";
import { Harness, LiveDoc } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { DurableSessionUpdate } from "../shared/durableSession.js";
import {
  initialNativeSessionState,
  type NativeJob,
  type NativeSessionState,
  type NativeStatePush,
  type PlanAction,
  parseQuestionnaireReply,
} from "../shared/nativeBuiltins.js";
import { NativeJobs, NativeState, PlanSignal, QuestionnaireSignal } from "./builtins/state.js";

export type { DurableSessionUpdate } from "../shared/durableSession.js";

const context = BACKGROUND_CONTEXT;
const PAGE_SIZE = 100;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// All service instances in this utility process share writer ownership, including aliased storage roots.
const writers = new Set<string>();

interface OpenSession {
  harness: Harness;
  now: () => number;
  conversation: Conversation;
  watch: ConversationWatch;
  nativeWatch: DocumentWatch<NativeSessionState>;
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
  /** Refresh app-owned project instructions before restoring saved tasks. */
  instructions?: string;
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
    private readonly publishNative: (push: NativeStatePush) => void = () => {},
    private readonly prepareAgent: (
      agent: Pick<AgentState, "model">,
    ) => Promise<void> = async () => {},
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
      opening: this.create(sessionId, cwd, request.agent, request.create, request.instructions),
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
      await this.reconcileNativeState(session);
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

  /** Read the persistent interaction state without exposing raw task or signal access. */
  nativeState(sessionId: string): Promise<NativeSessionState> {
    return this.run(sessionId, async (session) => {
      await this.reconcileNativeState(session);
      return (
        (await session.harness.snapshot(NativeState, session.conversation.id, context)) ??
        initialNativeSessionState()
      );
    });
  }

  /** Local commands are durable passive entries, atomically deduplicated with the mode change. */
  planCommand(sessionId: string, requestId: string, text: string): Promise<void> {
    const match = /^\/plan(?:\s+(on|off))?$/i.exec(text);
    if (!match)
      return Promise.reject(
        new Error(
          "Use /plan, /plan on or /plan off. Review actions are available above the input bar.",
        ),
      );
    return this.run(sessionId, async (session) => {
      const epoch = ++session.epoch;
      try {
        await session.harness.commit(async (tx) => {
          const previous = await tx.submissionByRequest(session.conversation.id, requestId);
          if (previous) return;
          const live = await tx.doc(LiveDoc, session.conversation.id);
          if (live.run || live.compactions?.length)
            throw new Error("Wait for the session to settle before changing mode.");
          const state = await tx.doc(NativeState, session.conversation.id);
          await session.conversation.submit(tx, {
            type: "write",
            requestId,
            entry: { kind: "pidesk.command", data: text },
          });
          state.mode = match[1]
            ? match[1].toLowerCase() === "on"
              ? "plan"
              : "edit"
            : state.mode === "plan"
              ? "edit"
              : "plan";
        }, context);
      } finally {
        this.observeIdle(sessionId.toLowerCase(), session, epoch);
      }
    });
  }

  setNativeMode(sessionId: string, mode: "edit" | "plan"): Promise<void> {
    return this.run(sessionId, (session) =>
      session.harness.commit(async (tx) => {
        const live = await tx.doc(LiveDoc, session.conversation.id);
        if (live.run || live.compactions?.length)
          throw new Error("Wait for the session to settle before changing mode.");
        (await tx.doc(NativeState, session.conversation.id)).mode = mode;
      }, context),
    );
  }

  answerQuestionnaire(
    sessionId: string,
    taskId: number,
    version: number,
    value: unknown,
  ): Promise<string> {
    return this.run(sessionId, (session) =>
      session.harness.commit(async (tx) => {
        const task = await tx.task(taskId as TaskId);
        const state = await tx.doc(NativeState, session.conversation.id);
        const pending = state.questions[String(taskId)];
        if (
          !pending ||
          pending.version !== version ||
          !task ||
          task.kind !== "pi.tool" ||
          task.conversationId !== session.conversation.id
        )
          return "closed";
        if (task.state.status === "terminal" || pending.until <= session.now()) {
          delete state.questions[String(taskId)];
          return "closed";
        }
        const reply = parseQuestionnaireReply(value, pending.questions);
        if (!reply) throw new Error("Invalid answer for the current questionnaire.");
        const result = await tx.signal(
          taskId as TaskId,
          QuestionnaireSignal,
          "answer",
          JSON.stringify(reply),
        );
        if (["delivered", "duplicate", "closed"].includes(result))
          delete state.questions[String(taskId)];
        return result;
      }, context),
    );
  }

  answerPlan(sessionId: string, taskId: number, action: PlanAction): Promise<unknown> {
    return this.run(sessionId, async (session) => {
      const delivered = await session.harness.commit(async (tx) => {
        const task = await tx.task(taskId as TaskId);
        if (task?.kind !== "pidesk.review-plan" || task.conversationId !== session.conversation.id)
          return "closed";
        const state = await tx.doc(NativeState, session.conversation.id);
        if (task.state.status === "terminal") {
          const outcome = task.state.outcome;
          return outcome.status === "completed" &&
            typeof outcome.result === "object" &&
            outcome.result !== null &&
            "action" in outcome.result &&
            outcome.result.action === action
            ? "duplicate"
            : "closed";
        }
        if (state.plan?.taskId !== taskId) return "closed";
        if (state.plan.until <= session.now()) {
          state.plan = null;
          return "closed";
        }
        return tx.signal(taskId as TaskId, PlanSignal, "answer", action);
      }, context);
      if (!["delivered", "duplicate"].includes(delivered)) return { status: delivered };
      const task = await session.harness.waitForTask(taskId as TaskId, context);
      if (task.state.outcome.status !== "completed") {
        await session.harness.commit(async (tx) => {
          const state = await tx.doc(NativeState, session.conversation.id);
          if (state.plan?.taskId === taskId) {
            state.plan = null;
            state.lastPlan = "";
          }
        }, context);
        throw new Error(
          "The plan review could not complete. Prepare the plan again before executing.",
        );
      }
      const result = task.state.outcome.result;
      if (
        typeof result !== "object" ||
        result === null ||
        !("action" in result) ||
        result.action !== action
      )
        return { status: "closed" };
      return { status: delivered, result };
    });
  }

  jobRows(sessionId: string): Promise<NativeJob[]> {
    return this.run(sessionId, async (session) => [
      ...((await session.harness.snapshot(NativeJobs, session.conversation.id, context))?.items ??
        []),
    ]);
  }

  updateJobs(sessionId: string, rows: NativeJob[]): Promise<void> {
    return this.run(sessionId, (session) =>
      session.harness.commit(async (tx) => {
        (await tx.doc(NativeJobs, session.conversation.id)).items = rows;
      }, context),
    );
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
    instructions?: string,
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
      const conversation = await harness.root(context, {
        agent: { ...agent, ...(instructions === undefined ? {} : { instructions }), cwd },
      });
      const current = await conversation.agent(context);
      if (current.cwd !== cwd) {
        throw new Error("Persisted Durable session belongs to another cwd.");
      }
      await this.prepareAgent(current);
      if (instructions !== undefined && current.instructions !== instructions)
        await conversation.configure({ instructions }, context);
      await conversation.commit(async (tx) => {
        await tx.doc(NativeState, conversation.id);
        await tx.doc(NativeJobs, conversation.id);
      }, context);
      await this.reconcileNativeState({ harness, conversation });
      const watch = await conversation.watch(context, { min: PAGE_SIZE, max: PAGE_SIZE * 2 });
      const nativeWatch = await harness.watchDoc(NativeState, conversation.id, context);
      if (!nativeWatch) throw new Error("Native session state was not initialized.");
      const session: OpenSession = {
        harness,
        now: runtimeOptions.now ?? Date.now,
        conversation,
        watch,
        nativeWatch,
        writerKey,
        lastEntry: watch.value.entries.at(-1)?.id ?? watch.value.before,
        listener: Promise.resolve(),
        epoch: 0,
        settledEpoch: -1,
      };
      this.emit({ type: "snapshot", sessionId, view: watch.value });
      // ConversationView mounts only pi.* documents; app-owned interaction state needs its own watch.
      const publishNative = (state: NativeSessionState) => {
        try {
          this.publishNative({ sessionId, state });
        } catch {
          /* A disconnected desktop cannot fail a commit. */
        }
      };
      publishNative(nativeWatch.value);
      nativeWatch.start(async (call) => {
        await this.enqueue(sessionId, session, async () => {
          if (call.kind === "failed") throw call.error;
          publishNative(call.value);
        });
      });
      void nativeWatch.closed.then((end) => {
        if (end.kind === "failed" || end.kind === "listener_error")
          this.emit({ type: "error", sessionId, error: errorText(end.error) });
      });
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
        await this.reconcileNativeState(session);
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

  /** Remove requests whose owner ended before its normal cancellation/decision cleanup could commit. */
  private reconcileNativeState(
    session: Pick<OpenSession, "harness" | "conversation">,
  ): Promise<void> {
    return session.harness.commit(async (tx) => {
      const state = await tx.doc(NativeState, session.conversation.id);
      for (const [key, pending] of Object.entries(state.questions)) {
        const task = await tx.task(pending.taskId as TaskId);
        if (!task || task.state.status === "terminal") delete state.questions[key];
      }
      if (state.plan) {
        const task = await tx.task(state.plan.taskId as TaskId);
        if (!task || task.state.status === "terminal") {
          state.plan = null;
          if (task?.state.status === "terminal" && task.state.outcome.status !== "completed")
            state.lastPlan = "";
        }
      }
    }, context);
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
    await session.nativeWatch.stop();
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
