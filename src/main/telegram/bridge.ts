import path from "node:path";
import type { RuntimeSessionUpdate } from "../../shared/durableProtocol";
import { boundedText, record } from "../../shared/durableProtocol";
import {
  NATIVE_STATE_KIND,
  type NativeSessionState,
  PLAN_ACTIONS,
  type PlanAction,
} from "../../shared/nativeBuiltins";
import { sessionRefFromKey } from "../../shared/sessionRef";
import {
  authorizedTelegramMessage,
  type SavedTelegramConfig,
  type TelegramHostRequest,
  type TelegramStatus,
} from "../../shared/telegram";
import { TelegramClient } from "./client";

export interface TelegramSessions {
  open(key: string): Promise<string>;
  submit(id: string, text: string, requestId: string): Promise<void>;
  abort(id: string, clear: boolean): Promise<void>;
  continue(id: string, requestId: string): Promise<void>;
  state(id: string): Promise<NativeSessionState>;
  answer(id: string, taskId: number, reply: unknown): Promise<unknown>;
  plan(id: string, taskId: number, action: PlanAction): Promise<unknown>;
  baseline(id: string): Promise<number>;
  cwd(key: string): string;
}
/** Application-scoped polling and fixed-session routing. No CLI process, global environment or SDK singleton. */
export class TelegramBridge {
  private config?: SavedTelegramConfig;
  private client?: TelegramClient;
  private controller?: AbortController;
  private connecting?: Promise<TelegramStatus>;
  private generation = 0;
  private bot: string | null = null;
  private error: string | null = null;
  private updates: Promise<void> = Promise.resolve();
  private owned = false;
  private readonly attachments: string[] = [];
  private notified = "";
  constructor(
    private readonly read: () => SavedTelegramConfig,
    private readonly save: (config: SavedTelegramConfig) => void,
    private readonly sessions: TelegramSessions,
    private readonly makeClient: (token: string) => TelegramClient = (token) =>
      new TelegramClient(token),
  ) {}
  status(): TelegramStatus {
    const config = this.config ?? this.read();
    return {
      connected: !!this.controller,
      connecting: !!this.connecting,
      bot: this.bot,
      error: this.error,
      config: {
        hasToken: !!config.token,
        userId: config.userId,
        chatId: config.chatId,
        sessionKey: config.sessionKey,
        proactive: config.proactive,
      },
    };
  }
  disconnect(): TelegramStatus {
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
    this.client = undefined;
    this.config = undefined;
    this.bot = null;
    this.owned = false;
    this.attachments.length = 0;
    this.notified = "";
    return this.status();
  }
  connect(): Promise<TelegramStatus> {
    if (this.connecting) return this.connecting;
    if (this.controller) return Promise.resolve(this.status());
    const generation = ++this.generation;
    const config = this.read();
    const operation = (async () => {
      if (!config.token || !config.userId || !config.chatId || !config.sessionKey)
        throw new Error("Configure the bot, owner and target session before connecting.");
      const client = this.makeClient(config.token);
      const me = await client.call("getMe", {});
      if (!record(me) || me.is_bot !== true || typeof me.username !== "string")
        throw new Error("Invalid Telegram bot response.");
      const id = await this.sessions.open(config.sessionKey);
      const baseline = await this.sessions.baseline(id);
      if (generation !== this.generation) throw new Error("Telegram connection cancelled.");
      if (config.delivered === 0 && !config.pending && !config.outbox.length)
        config.delivered = baseline;
      this.save(config);
      this.config = config;
      this.client = client;
      this.bot = me.username;
      this.error = null;
      this.controller = new AbortController();
      void this.poll(generation, this.controller.signal);
      return this.status();
    })()
      .catch((error: unknown) => {
        if (generation === this.generation)
          this.error = error instanceof Error ? error.message : "Telegram connection failed.";
        throw error;
      })
      .finally(() => {
        if (this.connecting === operation) this.connecting = undefined;
      });
    this.connecting = operation;
    return operation;
  }
  /** Consume committed transcript entries, never token deltas or reasoning. */
  observe(update: RuntimeSessionUpdate): void {
    const config = this.config;
    const ref = config?.sessionKey ? sessionRefFromKey(config.sessionKey) : null;
    if (!config || ref?.kind !== "durable" || ref.id !== update.sessionId) return;
    const generation = this.generation;
    this.updates = this.updates
      .catch(() => {})
      .then(async () => {
        if (generation !== this.generation || !this.client || !this.controller) return;
        if (update.type === "entries" && (this.owned || config.proactive)) {
          for (const entry of update.entries) {
            if (
              entry.id <= config.delivered ||
              config.outbox.some((item) => item.entryId === entry.id)
            )
              continue;
            const text = (entry.model ?? [])
              .flatMap((message) =>
                message.role === "assistant" &&
                !message.content.some((block) => block.type === "toolCall") &&
                ["stop", "length"].includes(message.stopReason)
                  ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
                  : [],
              )
              .join("\n")
              .trim();
            if (!text) continue;
            const chunks = splitTelegramText(text);
            if (config.outbox.length + chunks.length > 2000)
              throw new Error(
                "Telegram delivery queue is full. Reconnect after checking the destination.",
              );
            config.outbox.push(
              ...chunks.map((chunk) => ({ entryId: entry.id, text: chunk, messageId: 0 })),
            );
            this.save(config);
          }
        }
        if ("view" in update) {
          const state = update.view.docs[NATIVE_STATE_KIND] as NativeSessionState | undefined;
          const pending = state
            ? `${Object.keys(state.questions).join(",")}:${state.plan?.taskId ?? ""}`
            : "";
          if (pending !== this.notified) {
            this.notified = pending;
            if (state?.plan)
              await this.send(
                "Plan ready. Reply /plan execute, /plan new, /plan explore or /plan save.",
              );
            for (const question of Object.values(state?.questions ?? {}))
              await this.send(
                question.questions
                  .map(
                    (item, index) =>
                      `${index + 1}. ${item.question}\n${item.options.map((option) => `${option.label}: ${option.description}`).join("\n")}`,
                  )
                  .join("\n\n") +
                  '\n\nReply /answer {"cancelled":false,"answers":[{"selected":["label"],"text":"notes"}]} or /cancel_question.',
              );
          }
        }
        await this.flush();
        if (update.type === "settled") {
          for (const file of this.attachments.splice(0))
            await this.client.document(config.chatId as number, file, this.controller.signal);
          this.owned = false;
        }
      })
      .catch((error: unknown) => {
        if (generation === this.generation)
          this.error = error instanceof Error ? error.message : "Telegram delivery failed.";
      });
  }
  async host(request: TelegramHostRequest, signal?: AbortSignal): Promise<string> {
    if (request.op === "telegram_help")
      return "Telegram is managed by PiDesk Settings → Telegram. Incoming private messages are routed to the explicitly bound Durable session. Completed public replies are sent automatically during Telegram work. Use telegram_attach for requested artifacts (queued with the active reply) and telegram_message only for an explicit direct-send request. Destinations come from desktop settings. Plan reviews and questionnaires can be answered from Telegram using /plan and /answer. Named bots, threads, voice and third-party handler APIs are not yet migrated.";
    const config = this.config;
    const ref = config?.sessionKey ? sessionRefFromKey(config.sessionKey) : null;
    if (
      !config ||
      !this.client ||
      !this.controller ||
      ref?.kind !== "durable" ||
      ref.id !== request.sessionId
    )
      throw new Error("Connect Telegram and bind this session in Settings → Telegram.");
    if (request.op === "telegram_message") {
      if (!boundedText(request.text, 32000)) throw new Error("Invalid Telegram text.");
      await this.send(request.text, signal);
      return "Telegram message sent.";
    }
    if (
      !request.paths?.length ||
      request.paths.length > 10 ||
      request.paths.some((file) => !boundedText(file, 32768))
    )
      throw new Error("Choose 1–10 attachment paths.");
    const files = request.paths.map((file) =>
      path.resolve(this.sessions.cwd(config.sessionKey as string), file),
    );
    if (this.owned) {
      this.attachments.push(...files);
      return "Attachments queued for the active Telegram reply.";
    }
    for (const file of files)
      await this.client.document(
        config.chatId as number,
        file,
        signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal,
      );
    return "Telegram attachments sent.";
  }
  private async poll(generation: number, signal: AbortSignal): Promise<void> {
    while (!signal.aborted && generation === this.generation) {
      try {
        const config = this.config;
        const client = this.client;
        if (!config || !client) return;
        if (config.pending) await this.dispatch(config.pending.updateId, config.pending.text);
        await this.flush();
        const updates = await client.call(
          "getUpdates",
          { offset: config.offset, timeout: 25, limit: 50, allowed_updates: ["message"] },
          signal,
        );
        if (!Array.isArray(updates) || updates.length > 100)
          throw new Error("Invalid Telegram update response.");
        for (const update of updates) {
          if (signal.aborted || generation !== this.generation) return;
          if (!record(update) || !Number.isSafeInteger(update.update_id))
            throw new Error("Invalid Telegram update ID.");
          const updateId = update.update_id as number;
          if (updateId < config.offset) continue;
          if (
            authorizedTelegramMessage(update.message, config) &&
            boundedText(update.message.text, 32000)
          ) {
            config.pending = { updateId, text: update.message.text };
            this.save(config);
            await this.dispatch(updateId, update.message.text);
          }
          config.offset = updateId + 1;
          config.pending = null;
          this.save(config);
        }
        this.error = null;
      } catch (error) {
        if (signal.aborted || generation !== this.generation) return;
        this.error = error instanceof Error ? error.message : "Telegram polling failed.";
        await new Promise<void>((resolve) => {
          const abort = () => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, 3000);
          signal.addEventListener("abort", abort, { once: true });
        });
      }
    }
  }
  private async dispatch(updateId: number, text: string): Promise<void> {
    const config = this.config;
    if (!config?.sessionKey) throw new Error("No Telegram target session.");
    const id = await this.sessions.open(config.sessionKey);
    const key = `telegram:${updateId}`;
    if (!text.startsWith("/")) {
      this.owned = true;
      await this.sessions.submit(id, text, key);
      return;
    }
    if (/^\/(?:start|help|status)$/.test(text)) {
      await this.send(
        "PiDesk connected. Send text to work in the bound session. Controls: /abort, /stop, /continue, /question, /answer, /cancel_question; /plan execute|new|explore|save.",
      );
      return;
    }
    if (text === "/abort" || text === "/stop") {
      await this.sessions.abort(id, text === "/stop");
      return;
    }
    if (text === "/continue") {
      this.owned = true;
      await this.sessions.continue(id, key);
      return;
    }
    const state = await this.sessions.state(id);
    const plan = /^\/plan (execute|new|explore|save)$/.exec(text);
    if (plan && state.plan && PLAN_ACTIONS.includes(plan[1] as PlanAction)) {
      await this.sessions.plan(id, state.plan.taskId, plan[1] as PlanAction);
      return;
    }
    const question = Object.values(state.questions).sort((a, b) => a.taskId - b.taskId)[0];
    if (question && (text.startsWith("/answer ") || text === "/cancel_question")) {
      let reply: unknown;
      try {
        reply =
          text === "/cancel_question"
            ? { cancelled: true, answers: [] }
            : JSON.parse(text.slice(8));
      } catch {
        await this.send("Invalid answer JSON. Use /question to inspect the pending questionnaire.");
        return;
      }
      try {
        await this.sessions.answer(id, question.taskId, reply);
      } catch {
        await this.send(
          "Answer does not match the current questionnaire. Check option labels and answer count.",
        );
      }
      return;
    }
    if (text === "/question") {
      await this.send(JSON.stringify(state.questions));
      return;
    }
    await this.send(
      "This control is unavailable. Use /help for supported controls; ordinary text is sent to the bound session.",
    );
  }
  private async send(text: string, signal?: AbortSignal): Promise<void> {
    if (!this.client || !this.config?.chatId || !this.controller)
      throw new Error("Telegram is disconnected.");
    for (const chunk of splitTelegramText(text))
      await this.client.call(
        "sendMessage",
        { chat_id: this.config.chatId, text: chunk },
        signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal,
      );
  }
  private async flush(): Promise<void> {
    const config = this.config;
    const client = this.client;
    const controller = this.controller;
    if (!config || !client || !controller) return;
    // Polling and transcript updates share this drain, so one item can never be sent concurrently twice.
    if (this.flushing) return this.flushing;
    const drain = (async () => {
      while (config.outbox.length && !controller.signal.aborted && this.config === config) {
        const next = config.outbox[0];
        if (!next.messageId) {
          const result = await client.call(
            "sendMessage",
            { chat_id: config.chatId, text: next.text },
            controller.signal,
          );
          if (!record(result) || !Number.isSafeInteger(result.message_id))
            throw new Error("Invalid Telegram delivery receipt.");
          next.messageId = result.message_id as number;
          this.save(config);
        }
        config.outbox.shift();
        if (!config.outbox.some((item) => item.entryId === next.entryId))
          config.delivered = Math.max(config.delivered, next.entryId);
        this.save(config);
      }
    })().finally(() => {
      if (this.flushing === drain) this.flushing = undefined;
    });
    this.flushing = drain;
    return drain;
  }
  private flushing?: Promise<void>;
}
/** Telegram limits count UTF-16 units; avoid cutting a surrogate pair across messages. */
export function splitTelegramText(text: string): string[] {
  const chunks: string[] = [];
  while (text.length) {
    let end = Math.min(4000, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    chunks.push(text.slice(0, end));
    text = text.slice(end);
  }
  return chunks;
}
