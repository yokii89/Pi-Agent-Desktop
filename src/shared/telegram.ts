export type TelegramConfig = {
  hasToken: boolean;
  userId: number | null;
  chatId: number | null;
  sessionKey: string | null;
  proactive: boolean;
};
export type SavedTelegramConfig = Omit<TelegramConfig, "hasToken"> & {
  token: string;
  offset: number;
  delivered: number;
  pending: { updateId: number; text: string } | null;
  outbox: { entryId: number; text: string; messageId: number }[];
};
export type TelegramStatus = {
  connected: boolean;
  connecting: boolean;
  bot: string | null;
  error: string | null;
  config: TelegramConfig;
};
export const TELEGRAM_IPC = {
  status: "pidesk:telegram:status",
  save: "pidesk:telegram:save",
  connect: "pidesk:telegram:connect",
  disconnect: "pidesk:telegram:disconnect",
  bind: "pidesk:telegram:bind",
} as const;
export type TelegramHostRequest = {
  sessionId: string;
  op: "telegram_message" | "telegram_attach" | "telegram_help";
  text?: string;
  paths?: string[];
};
export interface TelegramDesktopApi {
  status(): Promise<import("./ipc").IpcResult<TelegramStatus>>;
  save(config: {
    token: string;
    userId: number;
    chatId: number;
    proactive: boolean;
  }): Promise<import("./ipc").IpcResult<TelegramStatus>>;
  connect(): Promise<import("./ipc").IpcResult<TelegramStatus>>;
  disconnect(): Promise<import("./ipc").IpcResult<TelegramStatus>>;
  bind(sessionId: string): Promise<import("./ipc").IpcResult<TelegramStatus>>;
}
/** No first-message auto-pairing: only the explicitly configured private owner can operate a session. */
export function authorizedTelegramMessage(
  value: unknown,
  config: Pick<SavedTelegramConfig, "userId" | "chatId">,
): value is {
  message_id: number;
  chat: { id: number; type: "private" };
  from: { id: number };
  text?: string;
} {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const from = item.from as Record<string, unknown> | undefined;
  const chat = item.chat as Record<string, unknown> | undefined;
  return (
    !!config.userId &&
    !!config.chatId &&
    from?.id === config.userId &&
    chat?.id === config.chatId &&
    chat.type === "private" &&
    Number.isSafeInteger(item.message_id)
  );
}
