import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLIPBOARD_IPC, type IpcResult } from "../../shared/ipc";

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getMainWindow: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: { handle: mocks.handle },
  clipboard: {},
  nativeImage: {},
}));
vi.mock("../window/createMainWindow", () => ({ getMainWindow: mocks.getMainWindow }));
const { registerClipboardIpc } = await import("./clipboardIpc");

function setup() {
  const mainFrame = {};
  const contents = { mainFrame, focusedFrame: mainFrame, paste: vi.fn() };
  const window = { webContents: contents, isFocused: vi.fn(() => true) };
  mocks.getMainWindow.mockReturnValue(window);
  registerClipboardIpc();
  const handle = mocks.handle.mock.calls.find(
    ([channel]) => channel === CLIPBOARD_IPC.paste,
  )?.[1] as (event: { sender: unknown; senderFrame: unknown }) => IpcResult<null>;
  return { contents, window, event: { sender: contents, senderFrame: mainFrame }, handle };
}

describe("native clipboard paste IPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only executes paste for the focused main window's top frame", () => {
    const { contents, handle, event } = setup();
    expect(handle(event)).toEqual({ ok: true, data: null });
    expect(contents.paste).toHaveBeenCalledOnce();
  });

  it("rejects foreign windows and child-frame callers", () => {
    const { contents, handle, event } = setup();
    expect(handle({ ...event, sender: {} })).toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
    expect(handle({ ...event, senderFrame: {} })).toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
    expect(contents.paste).not.toHaveBeenCalled();
  });

  it("does not paste after focus moves to a child frame or another window", () => {
    const { contents, window, handle, event } = setup();
    contents.focusedFrame = {};
    expect(handle(event)).toEqual({ ok: true, data: null });
    contents.focusedFrame = contents.mainFrame;
    window.isFocused.mockReturnValue(false);
    expect(handle(event)).toEqual({ ok: true, data: null });
    expect(contents.paste).not.toHaveBeenCalled();
  });

  it("returns an error envelope after the main window disappears", () => {
    const { contents, handle, event } = setup();
    mocks.getMainWindow.mockReturnValue(null);
    expect(handle(event)).toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
    expect(contents.paste).not.toHaveBeenCalled();
  });

  it("wraps native command failures without throwing from IPC", () => {
    const { contents, handle, event } = setup();
    contents.paste.mockImplementation(() => {
      throw new Error("native paste failed");
    });
    expect(handle(event)).toEqual({ ok: false, error: "native paste failed" });
  });
});
