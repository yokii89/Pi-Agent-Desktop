import { beforeEach, describe, expect, it, vi } from "vitest";
import { type IpcResult, MCP_IPC } from "../../shared/ipc";

const host = vi.hoisted(() => ({
  window: { webContents: { mainFrame: {} } },
  handlers: new Map<
    string,
    (
      event: { sender: unknown; senderFrame: unknown },
      request?: unknown,
    ) => Promise<IpcResult<unknown>>
  >(),
  list: vi.fn(),
  search: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: typeof host.handlers extends Map<string, infer H> ? H : never,
    ) => host.handlers.set(channel, handler),
  },
}));
vi.mock("../window/createMainWindow", () => ({ getMainWindow: () => host.window }));
vi.mock("./mcpConfig", () => ({ listUserMcpConfig: host.list }));
vi.mock("./mcpMarket", () => ({ searchMarket: host.search }));

import { registerMcpIpc } from "./mcpIpc";

const event = () => ({
  sender: host.window.webContents,
  senderFrame: host.window.webContents.mainFrame,
});
function invoke(
  channel: string,
  request?: unknown,
  sender: { sender: unknown; senderFrame: unknown } = event(),
) {
  const handler = host.handlers.get(channel);
  if (!handler) throw new Error("Missing MCP handler.");
  return handler(sender, request);
}
beforeEach(() => {
  host.handlers.clear();
  vi.resetAllMocks();
  host.list.mockReturnValue({ file: "/agent/mcp.json", entries: [] });
  registerMcpIpc();
});

describe("Durable MCP capability boundary", () => {
  it("reports native capability without probing an external executable and preserves read-only inspection", async () => {
    expect(
      await invoke(MCP_IPC.getPiSupport, { path: "untrusted.exe", version: "99.0.0" }),
    ).toEqual({ ok: true, data: { version: "Durable 1.6.0", status: "unsupported" } });
    expect(await invoke(MCP_IPC.list)).toEqual({
      ok: true,
      data: { file: "/agent/mcp.json", entries: [] },
    });
    for (const channel of [
      MCP_IPC.probe,
      MCP_IPC.save,
      MCP_IPC.remove,
      MCP_IPC.sessionCommand,
      MCP_IPC.reloadSessions,
    ]) {
      const result = await invoke(channel, {
        name: "server",
        config: { command: "pi" },
        action: "login",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("MCP");
    }
    expect(host.list).toHaveBeenCalledTimes(1);
    expect(host.search).not.toHaveBeenCalled();
  });

  it("rejects every call from another window or a nested frame", async () => {
    for (const channel of Object.values(MCP_IPC)) {
      for (const sender of [
        { sender: {}, senderFrame: {} },
        { sender: host.window.webContents, senderFrame: {} },
      ])
        expect(await invoke(channel, {}, sender)).toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
    }
    expect(host.list).not.toHaveBeenCalled();
    expect(host.search).not.toHaveBeenCalled();
  });

  it("validates marketplace input without enabling configuration or connections", async () => {
    for (const request of [null, [], {}, { query: 1 }, { query: "x".repeat(1025) }])
      expect((await invoke(MCP_IPC.marketSearch, request)).ok).toBe(false);
    host.search.mockResolvedValue({ entries: [] });
    expect((await invoke(MCP_IPC.marketSearch, { query: "filesystem", cursor: "next" })).ok).toBe(
      true,
    );
    expect(host.search).toHaveBeenCalledExactlyOnceWith({ query: "filesystem", cursor: "next" });
  });
});
