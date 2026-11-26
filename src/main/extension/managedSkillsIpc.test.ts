import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcResult } from "../../shared/ipc";
import { MANAGED_SKILLS_IPC, type ManagedSkillPlan } from "../../shared/managedSkills";

const host = vi.hoisted(() => ({
  root: "",
  agentDir: "",
  window: { webContents: { mainFrame: {} } },
  handlers: new Map<
    string,
    (
      event: { sender: unknown; senderFrame: unknown },
      request: unknown,
    ) => Promise<IpcResult<unknown>>
  >(),
  invalidate: vi.fn(),
  stale: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {
    getAppPath: () => host.root,
    getVersion: () => "test",
    getPath: () => path.join(host.root, "home"),
  },
  ipcMain: {
    handle: (
      channel: string,
      handler: typeof host.handlers extends Map<string, infer H> ? H : never,
    ) => host.handlers.set(channel, handler),
  },
}));
vi.mock("../session/piInfo", () => ({ getPiAgentDir: () => host.agentDir }));
vi.mock("../window/createMainWindow", () => ({ getMainWindow: () => host.window }));
vi.mock("./contributionCatalog", () => ({ invalidateCatalog: host.invalidate }));
vi.mock("../session/runtimeCoordinator", () => ({ markExtensionStale: host.stale }));

import { registerManagedSkillsIpc } from "./managedSkillsIpc";

const event = () => ({
  sender: host.window.webContents,
  senderFrame: host.window.webContents.mainFrame,
});
function invoke(
  channel: string,
  request: unknown,
  sender: { sender: unknown; senderFrame: unknown } = event(),
) {
  const handler = host.handlers.get(channel);
  if (!handler) throw new Error("Missing handler");
  return handler(sender, request);
}
beforeEach(() => {
  host.root = fs.mkdtempSync(path.join(tmpdir(), "pidesk-skills-ipc-"));
  host.agentDir = path.join(host.root, "agent");
  host.handlers.clear();
  vi.clearAllMocks();
  for (const name of ["plugin-creator", "skill-creator"]) {
    const directory = path.join(
      host.root,
      "vendor/MyPiExtension/packages/yoki-skills/skills",
      name,
    );
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: Skill\n---\nNative skill.\n`,
    );
  }
  registerManagedSkillsIpc();
});
afterEach(() => fs.rmSync(host.root, { recursive: true, force: true }));

describe("managed skills IPC", () => {
  it("restricts all operations to the main window top frame", async () => {
    for (const channel of Object.values(MANAGED_SKILLS_IPC)) {
      expect(await invoke(channel, {}, { sender: {}, senderFrame: {} })).toEqual({
        ok: false,
        error: "UNTRUSTED_SENDER",
      });
      expect(
        await invoke(channel, {}, { sender: host.window.webContents, senderFrame: {} }),
      ).toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
    }
    expect(fs.existsSync(host.agentDir)).toBe(false);
  });

  it("validates requests and returns errors through the IPC envelope", async () => {
    for (const request of [null, [], "invalid", { projectDir: "relative/path" }])
      expect((await invoke(MANAGED_SKILLS_IPC.list, request)).ok).toBe(false);
    expect(
      (await invoke(MANAGED_SKILLS_IPC.plan, { operation: "overwrite", name: "plugin-creator" }))
        .ok,
    ).toBe(false);
    expect(
      (await invoke(MANAGED_SKILLS_IPC.plan, { operation: "install", name: "../escape" })).ok,
    ).toBe(false);
    expect((await invoke(MANAGED_SKILLS_IPC.apply, { id: "invalid" })).ok).toBe(false);
    expect(fs.existsSync(host.agentDir)).toBe(false);
  });

  it("uses the app-owned source and a main-owned single-use confirmation token", async () => {
    expect((await invoke(MANAGED_SKILLS_IPC.list, {})).ok).toBe(true);
    const preview = await invoke(MANAGED_SKILLS_IPC.plan, {
      operation: "install",
      name: "plugin-creator",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(preview.error);
    const plan = preview.data as ManagedSkillPlan;
    expect(plan.canApply).toBe(true);
    expect(fs.existsSync(host.agentDir)).toBe(false);
    const result = await invoke(MANAGED_SKILLS_IPC.apply, {
      id: plan.id,
      target: host.root,
      files: [],
    });
    expect(result).toEqual({ ok: true, data: { preserved: false, reopenRequired: true } });
    expect(
      fs.existsSync(path.join(host.agentDir, "skills/codex-managed/plugin-creator/SKILL.md")),
    ).toBe(true);
    expect(host.invalidate).toHaveBeenCalledOnce();
    expect(host.stale).toHaveBeenCalledOnce();
    expect(await invoke(MANAGED_SKILLS_IPC.apply, { id: plan.id })).toEqual({
      ok: false,
      error: "PIDESK_SKILLS:stale",
    });
  });
});
