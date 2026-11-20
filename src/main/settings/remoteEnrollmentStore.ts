import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { accountId, desktopId, exact, id, origin } from "../../shared/remote";
import type { DesktopEnrollmentDraft } from "../../shared/remoteDesktop";

const filePath = () => path.join(app.getPath("userData"), "remote-enrollment.json");

/** Non-secret registration intent, retained across retries, panel remounts and restarts. */
export function loadRemoteEnrollment(): DesktopEnrollmentDraft | null {
  try {
    const value = exact(JSON.parse(fs.readFileSync(filePath(), "utf8")), [
      "relayOrigin",
      "displayName",
      "registrationRequestId",
      "desktopId",
      "accountId",
    ]);
    if (
      typeof value.displayName !== "string" ||
      !value.displayName.trim() ||
      Array.from(value.displayName).length > 64
    )
      throw new Error("REGISTRATION_STORE_INVALID");
    return {
      relayOrigin: origin(value.relayOrigin),
      displayName: value.displayName,
      registrationRequestId: id(value.registrationRequestId),
      desktopId: value.desktopId === null ? null : desktopId(value.desktopId),
      accountId: value.accountId === null ? null : accountId(value.accountId),
    };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("REGISTRATION_STORE_INVALID");
  }
}

/** Persist the intent before the first request that could create a relay registration. */
export function saveRemoteEnrollment(draft: DesktopEnrollmentDraft): void {
  try {
    const file = filePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    const fd = fs.openSync(temporary, "w", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(draft), "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
  } catch {
    throw new Error("REGISTRATION_STORE_WRITE_FAILED");
  }
}

/** Clear only pairing setup; project configuration and session history are independent. */
export function clearRemoteEnrollmentDraft(): void {
  try {
    fs.rmSync(filePath(), { force: true });
    fs.rmSync(`${filePath()}.tmp`, { force: true });
  } catch {
    throw new Error("REGISTRATION_STORE_WRITE_FAILED");
  }
}
