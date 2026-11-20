import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { DesktopAuthSnapshot } from "../../shared/remoteDesktop";

export interface DesktopAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  identity?: DesktopAuthSnapshot["identity"];
}

let cached: DesktopAuthTokens | null | undefined;
const filePath = () => path.join(app.getPath("userData"), "auth0-session.bin");

/** Read only OS-encrypted account credentials; an unreadable store remains recoverable via logout. */
export function loadDesktopAuth(): DesktopAuthTokens | null {
  if (cached !== undefined) return cached;
  if (!fs.existsSync(filePath())) {
    cached = null;
    return null;
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("SECURE_STORAGE_UNAVAILABLE");
  try {
    const value: unknown = JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath())));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("AUTH_STORE_INVALID");
    const record = value as Record<string, unknown>;
    if (
      typeof record.accessToken !== "string" ||
      !record.accessToken ||
      typeof record.refreshToken !== "string" ||
      !record.refreshToken ||
      typeof record.expiresAt !== "number" ||
      !Number.isFinite(record.expiresAt)
    )
      throw new Error("AUTH_STORE_INVALID");
    const identity = record.identity as DesktopAuthSnapshot["identity"] | undefined;
    if (
      identity != null &&
      (typeof identity !== "object" ||
        typeof identity.name !== "string" ||
        typeof identity.subject !== "string" ||
        identity.name.length > 256 ||
        identity.subject.length > 256)
    )
      throw new Error("AUTH_STORE_INVALID");
    cached = {
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      expiresAt: record.expiresAt,
      identity: identity ?? null,
    };
    return cached;
  } catch {
    throw new Error("AUTH_STORE_INVALID");
  }
}

/** Publish the new token set only after its encrypted atomic write succeeds. */
export function saveDesktopAuth(tokens: DesktopAuthTokens): DesktopAuthTokens {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("SECURE_STORAGE_UNAVAILABLE");
  try {
    const file = filePath();
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    const fd = fs.openSync(temporary, "w", 0o600);
    try {
      fs.writeFileSync(fd, encrypted);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
    cached = tokens;
    return tokens;
  } catch {
    throw new Error("AUTH_STORE_WRITE_FAILED");
  }
}

/** Report erasure failures instead of claiming logout while a credential remains on disk. */
export function clearDesktopAuthStore(): void {
  cached = null;
  try {
    fs.rmSync(filePath(), { force: true });
    fs.rmSync(`${filePath()}.tmp`, { force: true });
  } catch {
    throw new Error("AUTH_STORE_CLEAR_FAILED");
  }
}
