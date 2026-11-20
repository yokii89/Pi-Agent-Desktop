import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import {
  accountId,
  type DesktopCredential,
  exact,
  fail,
  type Grant,
  id,
  origin,
  parseGrant,
  revoked,
  secret,
  timestamp,
} from "../../shared/remote";

import type { RemoteOperation } from "../remote/operationLedger";

interface RemoteFile {
  version: 2;
  credential: string;
  grant: Grant | null;
  operations: RemoteOperation[];
}
let cache: RemoteFile | null | undefined;
const filePath = () => path.join(app.getPath("userData"), "remote-authorization.json");
function read(): RemoteFile | null {
  if (cache !== undefined) return cache;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(filePath(), "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("STATE_UNAVAILABLE");
    const current = exact(raw, ["version", "credential", "grant", "operations"]);
    if (
      current.version !== 2 ||
      typeof current.credential !== "string" ||
      !Array.isArray(current.operations)
    )
      fail("STATE_UNAVAILABLE");
    cache = {
      version: 2,
      credential: current.credential,
      grant: current.grant === null ? null : parseGrant(current.grant),
      operations: current.operations as RemoteOperation[],
    };
    return cache;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      cache = null;
      return null;
    }
    return fail("STATE_UNAVAILABLE");
  }
}
function write(next: RemoteFile): void {
  const file = filePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  const fd = fs.openSync(temp, "w", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(next), "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
  cache = next;
}
/** Electron 41 uses the synchronous OS-protected safeStorage API; never fall back to plaintext. */
export function loadRemoteCredential(): DesktopCredential | null {
  const data = read();
  if (!data) return null;
  if (!safeStorage.isEncryptionAvailable()) fail("SECURE_STORAGE_UNAVAILABLE");
  try {
    const raw: unknown = JSON.parse(
      safeStorage.decryptString(Buffer.from(data.credential, "base64")),
    );
    const r = exact(raw, [
      "version",
      "relayOrigin",
      "relayInstanceId",
      "desktopId",
      "desktopCredential",
      "expiresAt",
      "controlVersion",
      "accountId",
    ]);
    if (r.version !== 1 || r.controlVersion !== 2) fail("STATE_UNAVAILABLE");
    return {
      version: 1,
      controlVersion: 2,
      accountId: accountId(r.accountId),
      relayOrigin: origin(r.relayOrigin),
      relayInstanceId: id(r.relayInstanceId),
      desktopId: id(r.desktopId),
      desktopCredential: secret(r.desktopCredential),
      expiresAt: timestamp(r.expiresAt),
    };
  } catch {
    return fail("SECURE_STORAGE_UNAVAILABLE");
  }
}
export function saveRemoteCredential(credential: DesktopCredential): void {
  if (!safeStorage.isEncryptionAvailable()) fail("SECURE_STORAGE_UNAVAILABLE");
  write({
    version: 2,
    credential: safeStorage.encryptString(JSON.stringify(credential)).toString("base64"),
    grant: null,
    operations: [],
  });
}
/** Forget only remote enrollment after its connection has stopped; never touch project or session data. */
export function clearRemoteCredential(): void {
  try {
    fs.rmSync(filePath(), { force: true });
    fs.rmSync(`${filePath()}.tmp`, { force: true });
    cache = null;
  } catch {
    fail("STATE_UNAVAILABLE");
  }
}

/** Removing or replacing an authorized project invalidates the grant before settings change. */
export function revokeRemoteForProjectChanges(
  previous: { id: string; dir: string }[],
  next: { id: string; dir: string }[],
): void {
  const grant = loadRemoteGrant();
  if (!grant || grant.state === "revoked") return;
  const normalized = (value: string) =>
    process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (
    grant.projectIds.some((id) => {
      const oldProject = previous.find((p) => p.id === id);
      const newProject = next.find((p) => p.id === id);
      return (
        !oldProject || !newProject || normalized(oldProject.dir) !== normalized(newProject.dir)
      );
    })
  )
    saveRemoteGrant(revoked(grant, Date.now(), "project_configuration_changed"));
}
export function remoteStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}
export function loadRemoteGrant(): Grant | null {
  return read()?.grant ?? null;
}
export function saveRemoteGrant(grant: Grant): void {
  const current = read();
  if (!current) fail("STATE_UNAVAILABLE");
  write({ ...current, grant: parseGrant(grant) });
}

export function loadRemoteOperations(): RemoteOperation[] {
  return read()?.operations ?? [];
}

export function saveRemoteOperations(operations: RemoteOperation[]): void {
  const current = read();
  if (!current) fail("STATE_UNAVAILABLE");
  write({ ...current, operations: structuredClone(operations) });
}
