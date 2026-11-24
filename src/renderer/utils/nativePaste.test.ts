import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ paste: vi.fn<() => Promise<void>>() }));
vi.mock("../services/clipboardService", () => ({ clipboardService: mocks }));

const { pasteIntoElement } = await import("./nativePaste");

class PasteDocument extends EventTarget {
  activeElement: PasteTarget | null = null;
  focused = true;
  frames: { contentDocument: PasteDocument | null }[] = [];
  /** claimEditorFocus 在窗口未激活时会逐帧重试；测试里用宏任务模拟一帧。 */
  defaultView = {
    requestAnimationFrame: (callback: () => void): number => {
      setTimeout(callback, 0);
      return 1;
    },
  };

  hasFocus(): boolean {
    return this.focused;
  }

  querySelectorAll(): { contentDocument: PasteDocument | null }[] {
    return this.frames;
  }

  paste(target: PasteTarget): Event {
    const event = new Event("paste", { cancelable: true });
    Object.defineProperty(event, "target", { value: target });
    this.dispatchEvent(event);
    return event;
  }
}

class PasteTarget {
  isConnected = true;
  isContentEditable = true;

  constructor(readonly ownerDocument: PasteDocument) {}

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  asElement(): HTMLElement {
    return this as unknown as HTMLElement;
  }
}

function setup() {
  const doc = new PasteDocument();
  const root = new PasteTarget(doc);
  const other = new PasteTarget(doc);
  doc.activeElement = root;
  return { doc, root, other };
}

describe("native paste ownership", () => {
  beforeEach(() => {
    mocks.paste.mockReset();
    mocks.paste.mockResolvedValue(undefined);
  });

  it("keeps normal paste and removes the capture guard after completion", async () => {
    const { doc, root, other } = setup();
    let delivered: Event | undefined;
    mocks.paste.mockImplementation(async () => {
      delivered = doc.paste(root);
    });
    await pasteIntoElement(root.asElement());
    expect(delivered?.defaultPrevented).toBe(false);
    doc.activeElement = other;
    expect(doc.paste(other).defaultPrevented).toBe(false);
  });

  it("skips the queued command if focus already moved", async () => {
    const { doc, root, other } = setup();
    const request = pasteIntoElement(root.asElement());
    doc.activeElement = other;
    await request;
    expect(mocks.paste).not.toHaveBeenCalled();
  });

  it("blocks a native paste redirected during the IPC round trip", async () => {
    const { doc, root, other } = setup();
    let delivered: Event | undefined;
    mocks.paste.mockImplementation(async () => {
      doc.activeElement = other;
      delivered = doc.paste(other);
    });
    await pasteIntoElement(root.asElement());
    expect(delivered?.defaultPrevented).toBe(true);
    expect(doc.paste(other).defaultPrevented).toBe(false);
  });

  it.each(["unmount", "disable", "blur"])("cancels a paste after %s", async (change) => {
    const { doc, root } = setup();
    let delivered: Event | undefined;
    mocks.paste.mockImplementation(async () => {
      if (change === "unmount") root.isConnected = false;
      else if (change === "disable") root.isContentEditable = false;
      else doc.focused = false;
      delivered = doc.paste(root);
    });
    await pasteIntoElement(root.asElement());
    expect(delivered?.defaultPrevented).toBe(true);
  });

  it.each(["existing", "new"])("blocks paste into a %s child document", async (when) => {
    const { doc, root } = setup();
    const child = new PasteDocument();
    const childInput = new PasteTarget(child);
    if (when === "existing") doc.frames.push({ contentDocument: child });
    let delivered: Event | undefined;
    mocks.paste.mockImplementation(async () => {
      if (when === "new") {
        doc.frames.push({ contentDocument: child });
        doc.dispatchEvent(new Event("focusout"));
      }
      doc.activeElement = null;
      delivered = child.paste(childInput);
    });
    await pasteIntoElement(root.asElement());
    expect(delivered?.defaultPrevented).toBe(true);
    expect(child.paste(childInput).defaultPrevented).toBe(false);
  });

  it("serializes native commands so captures cannot cancel each other's paste", async () => {
    const { doc, root } = setup();
    let finish!: () => void;
    mocks.paste.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = pasteIntoElement(root.asElement());
    const second = pasteIntoElement(root.asElement());
    // 焦点确认本身是异步的（可能等窗口激活），多让一拍再断言
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.paste).toHaveBeenCalledTimes(1);
    expect(doc.paste(root).defaultPrevented).toBe(false);
    finish();
    await Promise.all([first, second]);
    expect(mocks.paste).toHaveBeenCalledTimes(2);
  });

  it("cleans up failed requests and still allows retry", async () => {
    const { doc, root, other } = setup();
    mocks.paste.mockRejectedValueOnce(new Error("IPC failed"));
    await expect(pasteIntoElement(root.asElement())).rejects.toThrow("IPC failed");
    expect(doc.paste(other).defaultPrevented).toBe(false);
    await pasteIntoElement(root.asElement());
    expect(mocks.paste).toHaveBeenCalledTimes(2);
  });

  it("waits for a right-click that also activates the window", async () => {
    const { doc, root } = setup();
    // 右键同时承担激活窗口：contextmenu 已派发，但文档还没聚焦、焦点也不在编辑器上
    doc.focused = false;
    doc.activeElement = null;
    let delivered: Event | undefined;
    mocks.paste.mockImplementation(async () => {
      delivered = doc.paste(root);
    });
    // 激活在下一帧完成
    const activate = root.focus.bind(root);
    root.focus = () => {
      activate();
      doc.focused = true;
    };
    await pasteIntoElement(root.asElement());
    expect(delivered).toBeDefined();
    expect(delivered?.defaultPrevented).toBe(false);
  });

  it("reports a paste that never got a focused window", async () => {
    const { doc, root } = setup();
    doc.focused = false;
    doc.activeElement = null;
    await expect(pasteIntoElement(root.asElement())).rejects.toThrow("PASTE_WINDOW_NOT_FOCUSED");
    expect(mocks.paste).not.toHaveBeenCalled();
  });
});
