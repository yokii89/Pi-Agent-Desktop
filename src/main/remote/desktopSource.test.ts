import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  projects: [
    { id: "allowed", name: "Allowed", dir: "C:/projects/allowed" },
    { id: "private", name: "Private", dir: "C:/projects/private" },
  ],
  list: vi.fn(),
  guard: vi.fn(),
  history: vi.fn(),
  fetch: vi.fn(),
  liveId: vi.fn(),
  hasSession: vi.fn(),
}));
vi.mock("../settings/settings", () => ({ getSettings: () => ({ projects: f.projects }) }));
vi.mock("../session/piInfo", () => ({ getPiAgentDir: () => "C:/pi" }));
vi.mock("../session/sessionHistory", () => ({
  encodeCwdToSessionDir: (cwd: string) =>
    `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`,
  listSessions: f.list,
}));
vi.mock("../session/runtimeCoordinator", () => ({
  listRuntimeSnapshots: () => [],
  getRuntimeState: () => "busy",
  ensureSessionReady: vi.fn(),
}));
vi.mock("../session/extensionUi", () => ({ pendingUiRequests: () => [] }));
vi.mock("../session/piSession", () => ({
  liveSessionIdForFile: f.liveId,
  hasSession: f.hasSession,
  fetchSessionMessages: f.fetch,
  abortSession: vi.fn(),
  fetchSessionState: vi.fn(),
  promptSession: vi.fn(),
  respondSessionUi: vi.fn(),
  setSessionName: vi.fn(),
}));
vi.mock("./readAdapter", async (original) => ({
  ...(await original<typeof import("./readAdapter")>()),
  remoteSessionFile: f.guard,
  readRemoteHistory: f.history,
}));

vi.mock("./historySync", async (original) => ({
  ...(await original<typeof import("./historySync")>()),
  RemoteHistoryReader: class {
    async read(file: string, directory: string, root: string) {
      await f.guard(file, directory, root);
      const messages = await f.history(file, directory, root);
      return {
        identity: file,
        messages,
        prefixes: messages.map((message: { id: string }) => message.id),
      };
    }
  },
}));

import { DesktopReadOnlySource } from "./desktopSource";

const summary = () => ({
  file: "C:/pi/sessions/--C--projects-allowed--/history.jsonl",
  cwd: "C:/projects/allowed",
  updatedAt: 1,
  firstUserMessage: "Hello",
});
beforeEach(() => {
  vi.resetAllMocks();
  f.projects = [
    { id: "allowed", name: "Allowed", dir: "C:/projects/allowed" },
    { id: "private", name: "Private", dir: "C:/projects/private" },
  ];
  f.list.mockResolvedValue([summary()]);
  f.guard.mockImplementation(async (file: string) => file);
  f.liveId.mockReturnValue(null);
  f.history.mockResolvedValue([{ id: "m_0_0", role: "user", text: "disk", state: "done" }]);
});

describe("desktop remote catalog integration", () => {
  it("lists only selected configured projects using opaque session ids and guarded paths", async () => {
    const source = new DesktopReadOnlySource();
    const sessions = await source.sessions(["allowed", "unknown"]);
    expect(f.list).toHaveBeenCalledExactlyOnceWith("C:/projects/allowed");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(sessions)).not.toContain("C:/");
    expect(f.guard).toHaveBeenCalledWith(
      summary().file,
      path.join("C:/pi", "sessions", "--C--projects-allowed--"),
      path.join("C:/pi", "sessions"),
    );
  });
  it("maps runtime sessions to notifications only within their configured project scope", async () => {
    const source = new DesktopReadOnlySource();
    f.liveId.mockReturnValue("live-1");
    await source.sessions(["allowed"]);
    await expect(source.notificationSession("live-1", ["allowed"])).resolves.toEqual({
      id: expect.any(String),
      title: "Hello",
      projectId: "allowed",
    });
    await expect(source.notificationSession("live-1", ["private"])).resolves.toBeNull();
    f.projects = [{ id: "allowed", name: "Allowed", dir: "C:/projects/replaced" }];
    await expect(source.notificationSession("live-1", ["allowed"])).resolves.toBeNull();
  });
  it("shares the catalog scan between concurrent session and interaction reads only", async () => {
    const source = new DesktopReadOnlySource();
    const [sessions, interactions] = await Promise.all([
      source.sessions(["allowed", "unknown"]),
      source.interactions(["unknown", "allowed", "allowed"]),
    ]);
    expect(sessions).toHaveLength(1);
    expect(interactions).toEqual([]);
    expect(f.list).toHaveBeenCalledTimes(1);
    expect(f.guard).toHaveBeenCalledTimes(1);

    f.list.mockResolvedValue([]);
    expect(await source.sessions(["allowed"])).toEqual([]);
    expect(f.list).toHaveBeenCalledTimes(2);
    await expect(source.messages(sessions[0])).rejects.toThrow("RESOURCE_UNAVAILABLE");
  });
  it("retries a failed shared scan instead of retaining the rejected promise", async () => {
    const source = new DesktopReadOnlySource();
    f.list.mockRejectedValueOnce(new Error("disk unavailable"));
    const results = await Promise.allSettled([
      source.sessions(["allowed"]),
      source.interactions(["allowed"]),
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(f.list).toHaveBeenCalledTimes(1);
    expect(await source.sessions(["allowed"])).toHaveLength(1);
    expect(f.list).toHaveBeenCalledTimes(2);
  });
  it("keeps concurrent scans of different project scopes isolated", async () => {
    const source = new DesktopReadOnlySource();
    f.list.mockImplementation(async (dir: string) => [
      { ...summary(), cwd: dir, file: `${dir}/history.jsonl` },
    ]);
    const [allowed, privateSessions] = await Promise.all([
      source.sessions(["allowed"]),
      source.sessions(["private"]),
    ]);
    expect(allowed.map((session) => session.projectId)).toEqual(["allowed"]);
    expect(privateSessions.map((session) => session.projectId)).toEqual(["private"]);
    expect(f.list).toHaveBeenCalledTimes(2);
  });
  it("does not share scans across changes to a configured project directory", async () => {
    const source = new DesktopReadOnlySource();
    let resolve!: (items: ReturnType<typeof summary>[]) => void;
    f.list.mockReturnValueOnce(
      new Promise<ReturnType<typeof summary>[]>((done) => {
        resolve = done;
      }),
    );
    const stale = source.sessions(["allowed"]);
    f.projects = [{ id: "allowed", name: "Allowed", dir: "C:/projects/new" }];
    f.list.mockResolvedValue([{ ...summary(), cwd: "C:/projects/new", file: "new.jsonl" }]);
    const current = await source.sessions(["allowed"]);
    resolve([summary()]);
    expect(await stale).toEqual([]);
    expect(current).toHaveLength(1);
    expect(f.list).toHaveBeenCalledTimes(2);
    expect(await source.messages(current[0])).toHaveLength(1);
  });
  it("hides escaped files and files claiming another working directory", async () => {
    const source = new DesktopReadOnlySource();
    f.guard.mockRejectedValue(new Error("RESOURCE_UNAVAILABLE"));
    expect(await source.sessions(["allowed"])).toEqual([]);
    f.list.mockResolvedValue([{ ...summary(), cwd: "C:/projects/private" }]);
    f.guard.mockClear();
    expect(await source.sessions(["allowed"])).toEqual([]);
    expect(f.guard).not.toHaveBeenCalled();
  });
  it("invalidates removed sessions instead of retaining stale file references", async () => {
    const source = new DesktopReadOnlySource();
    const [session] = await source.sessions(["allowed"]);
    f.list.mockResolvedValue([]);
    await source.sessions(["allowed"]);
    await expect(source.messages(session)).rejects.toThrow("RESOURCE_UNAVAILABLE");
    expect(f.history).not.toHaveBeenCalled();
  });
  it("uses bounded disk history without starting a pi process", async () => {
    const source = new DesktopReadOnlySource();
    const [session] = await source.sessions(["allowed"]);
    expect(await source.messages(session)).toEqual([
      { id: "m_0_0", role: "user", text: "disk", state: "done" },
    ]);
    expect(f.history).toHaveBeenCalledOnce();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("reads committed disk history during generation without requesting a live preview", async () => {
    const source = new DesktopReadOnlySource();
    const [session] = await source.sessions(["allowed"]);
    f.liveId.mockReturnValue("live-1");
    f.hasSession.mockReturnValue(true);
    f.fetch.mockResolvedValue([{ role: "assistant", content: "unfinished live answer" }]);
    expect(await source.messages(session)).toEqual([
      { id: "m_0_0", role: "user", text: "disk", state: "done" },
    ]);
    expect(f.fetch).not.toHaveBeenCalled();
    expect((await source.history(session)).tail.messages).toEqual([]);
  });
  it("rejects history when the project is removed during an asynchronous read", async () => {
    const source = new DesktopReadOnlySource();
    const [session] = await source.sessions(["allowed"]);
    f.history.mockImplementation(async () => {
      f.projects = f.projects.filter((project) => project.id !== "allowed");
      return [{ id: "message", role: "user", text: "must not escape" }];
    });
    await expect(source.messages(session)).rejects.toThrow("RESOURCE_UNAVAILABLE");
  });
});
