import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import { boundedText, record } from "../../shared/durableProtocol";
import { DURABLE_SESSION_ID, sessionRefFromKey } from "../../shared/sessionRef";
import type { SavedTelegramConfig, TelegramConfig } from "../../shared/telegram";

const file = () => path.join(app.getPath("userData"), "durable", "v1", "telegram.bin");
export const emptyTelegramConfig = (): SavedTelegramConfig => ({
  token: "",
  userId: null,
  chatId: null,
  sessionKey: null,
  proactive: false,
  offset: 0,
  delivered: 0,
  pending: null,
  outbox: [],
});
/** Main owns the token, routing and delivery receipts in one encrypted atomic snapshot. */
export function readTelegramConfig(): SavedTelegramConfig {
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(file());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyTelegramConfig();
    throw error;
  }
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("OS credential encryption is unavailable.");
  const value: unknown = JSON.parse(safeStorage.decryptString(buffer));
  if (
    !record(value) ||
    !boundedText(value.token, 256, true) ||
    !Number.isSafeInteger(value.offset) ||
    !Number.isSafeInteger(value.delivered) ||
    !Array.isArray(value.outbox) ||
    value.outbox.length > 2000 ||
    typeof value.proactive !== "boolean" ||
    (value.userId !== null &&
      !(
        typeof value.userId === "number" &&
        Number.isSafeInteger(value.userId) &&
        value.userId > 0
      )) ||
    (value.chatId !== null &&
      !(
        typeof value.chatId === "number" &&
        Number.isSafeInteger(value.chatId) &&
        value.chatId > 0
      )) ||
    (value.sessionKey !== null &&
      (typeof value.sessionKey !== "string" ||
        sessionRefFromKey(value.sessionKey).kind !== "durable")) ||
    (value.pending !== null &&
      (!record(value.pending) ||
        !Number.isSafeInteger(value.pending.updateId) ||
        !boundedText(value.pending.text, 32000))) ||
    !value.outbox.every(
      (item) =>
        record(item) &&
        Number.isSafeInteger(item.entryId) &&
        Number.isSafeInteger(item.messageId) &&
        boundedText(item.text, 4000),
    )
  )
    throw new Error("Invalid encrypted Telegram configuration.");
  return value as SavedTelegramConfig;
}
export function writeTelegramConfig(config: SavedTelegramConfig): void {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("OS credential encryption is unavailable.");
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const temporary = `${file()}.tmp`;
  fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(config)));
  fs.renameSync(temporary, file());
}
export function publicTelegramConfig(config: SavedTelegramConfig): TelegramConfig {
  return {
    hasToken: !!config.token,
    userId: config.userId,
    chatId: config.chatId,
    sessionKey: config.sessionKey,
    proactive: config.proactive,
  };
}
export function mergeTelegramConfig(
  value: unknown,
  previous: SavedTelegramConfig,
): SavedTelegramConfig {
  if (
    !record(value) ||
    typeof value.token !== "string" ||
    (value.token && !/^\d{5,20}:[A-Za-z0-9_-]{20,200}$/.test(value.token)) ||
    typeof value.userId !== "number" ||
    !Number.isSafeInteger(value.userId) ||
    value.userId <= 0 ||
    typeof value.chatId !== "number" ||
    !Number.isSafeInteger(value.chatId) ||
    value.chatId <= 0 ||
    typeof value.proactive !== "boolean"
  )
    throw new Error("Enter a valid bot token, allowed user ID and private chat ID.");
  const token = value.token || previous.token;
  if (!token) throw new Error("Enter a Telegram bot token.");
  const changed =
    token !== previous.token ||
    value.chatId !== previous.chatId ||
    value.userId !== previous.userId;
  return {
    ...previous,
    ...(changed ? { offset: 0, delivered: 0, pending: null, outbox: [], sessionKey: null } : {}),
    token,
    userId: value.userId,
    chatId: value.chatId,
    proactive: value.proactive,
  };
}
export function validTelegramSessionKey(key: string): boolean {
  const ref = sessionRefFromKey(key);
  return ref.kind === "durable" && DURABLE_SESSION_ID.test(ref.id);
}
