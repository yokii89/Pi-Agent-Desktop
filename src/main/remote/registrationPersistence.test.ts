import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopEnrollmentDraft } from "../../shared/remoteDesktop";

const f = vi.hoisted(() => ({
  directory: `${process.env.TEMP ?? process.env.TMP ?? "/tmp"}/pidesk-remote-setup-test-${process.pid}`,
  secure: true,
}));
vi.mock("electron", () => ({
  app: { getPath: () => f.directory },
  safeStorage: {
    isEncryptionAvailable: () => f.secure,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));
const draft: DesktopEnrollmentDraft = {
  relayOrigin: "https://relay.example",
  displayName: "Test computer",
  registrationRequestId: "registration-request",
  desktopId: null,
  accountId: null,
};
beforeEach(() => {
  vi.resetModules();
  f.secure = true;
  fs.rmSync(f.directory, { recursive: true, force: true });
  fs.mkdirSync(f.directory, { recursive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(f.directory, { recursive: true, force: true });
});

describe("remote setup persistence", () => {
  it("restores the exact registration intent from disk and clears it explicitly", async () => {
    const store = await import("../settings/remoteEnrollmentStore");
    store.saveRemoteEnrollment(draft);
    vi.resetModules();
    const restored = await import("../settings/remoteEnrollmentStore");
    expect(restored.loadRemoteEnrollment()).toEqual(draft);
    restored.clearRemoteEnrollmentDraft();
    expect(restored.loadRemoteEnrollment()).toBeNull();
  });
  it("does not silently replace an unreadable or untrusted registration intent", async () => {
    const store = await import("../settings/remoteEnrollmentStore");
    const file = path.join(f.directory, "remote-enrollment.json");
    fs.writeFileSync(file, JSON.stringify({ ...draft, relayOrigin: "http://untrusted.example" }));
    expect(() => store.loadRemoteEnrollment()).toThrow("REGISTRATION_STORE_INVALID");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({
      registrationRequestId: draft.registrationRequestId,
    });
    store.clearRemoteEnrollmentDraft();
    expect(store.loadRemoteEnrollment()).toBeNull();
  });
  it("locally resets corrupt enrollment without encryption access or changes to project/history files", async () => {
    const store = await import("../settings/remoteStore");
    const authorization = path.join(f.directory, "remote-authorization.json");
    const project = path.join(f.directory, "project-settings.json");
    const history = path.join(f.directory, "session.jsonl");
    fs.writeFileSync(authorization, "corrupt");
    fs.writeFileSync(project, "project sentinel");
    fs.writeFileSync(history, "history sentinel");
    f.secure = false;
    store.clearRemoteCredential();
    expect(store.loadRemoteCredential()).toBeNull();
    expect(fs.readFileSync(project, "utf8")).toBe("project sentinel");
    expect(fs.readFileSync(history, "utf8")).toBe("history sentinel");
  });
  it("keeps a failed credential erasure visible instead of pretending disk state was reset", async () => {
    const store = await import("../settings/remoteStore");
    const authorization = path.join(f.directory, "remote-authorization.json");
    fs.writeFileSync(authorization, "corrupt");
    const remove = fs.rmSync.bind(fs);
    vi.spyOn(fs, "rmSync").mockImplementation((file, options) => {
      if (String(file) === authorization) throw new Error("access denied");
      return remove(file, options);
    });
    expect(() => store.clearRemoteCredential()).toThrow("STATE_UNAVAILABLE");
    expect(fs.existsSync(authorization)).toBe(true);
  });
});
