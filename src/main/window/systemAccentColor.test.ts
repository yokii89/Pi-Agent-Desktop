import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type IpcResult, THEME_IPC } from "../../shared/ipc";

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getAllWindows: vi.fn(),
  getAccentColor: vi.fn(),
}));
const preferences = new EventEmitter();
const lifecycle = new EventEmitter();

vi.mock("electron", () => ({
  app: lifecycle,
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
  ipcMain: { handle: mocks.handle },
  systemPreferences: Object.assign(preferences, { getAccentColor: mocks.getAccentColor }),
}));

const { registerSystemAccentColorIpc } = await import("./systemAccentColor");

describe("system accent color IPC", () => {
  beforeEach(() => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    mocks.getAccentColor.mockReturnValue("0078D4FF");
    mocks.getAllWindows.mockReturnValue([]);
  });
  afterEach(() => {
    lifecycle.emit("will-quit");
    preferences.removeAllListeners();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  function getColor(): IpcResult<string | null> {
    const handler = mocks.handle.mock.calls.find(
      ([channel]) => channel === THEME_IPC.getSystemAccentColor,
    )?.[1];
    return handler();
  }

  it("returns current color in an envelope and falls back when native reading fails", () => {
    registerSystemAccentColorIpc();
    expect(getColor()).toEqual({ ok: true, data: "#0078d4" });
    mocks.getAccentColor.mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(getColor()).toEqual({ ok: true, data: null });
  });

  it("pushes changed colors to live windows, deduplicates, and disposes on quit", () => {
    const send = vi.fn();
    const deadSend = vi.fn();
    mocks.getAllWindows.mockReturnValue([
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } },
      { isDestroyed: () => false, webContents: { isDestroyed: () => true, send: deadSend } },
      { isDestroyed: () => true, webContents: { isDestroyed: () => false, send: deadSend } },
    ]);
    registerSystemAccentColorIpc();
    preferences.emit("accent-color-changed", {}, "0078D4FF");
    expect(send).not.toHaveBeenCalled();
    preferences.emit("accent-color-changed", {}, "E5484DFF");
    expect(send).toHaveBeenCalledExactlyOnceWith(THEME_IPC.systemAccentColorChanged, "#e5484d");
    expect(deadSend).not.toHaveBeenCalled();
    lifecycle.emit("will-quit");
    expect(preferences.listenerCount("accent-color-changed")).toBe(0);
  });

  it("returns null without calling unsupported native APIs", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    registerSystemAccentColorIpc();
    expect(getColor()).toEqual({ ok: true, data: null });
    expect(mocks.getAccentColor).not.toHaveBeenCalled();
    expect(preferences.listenerCount("accent-color-changed")).toBe(0);
  });
});
