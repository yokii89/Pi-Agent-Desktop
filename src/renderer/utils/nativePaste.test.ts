import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ paste: vi.fn<() => Promise<void>>() }));
vi.mock("../services/clipboardService", () => ({ clipboardService: mocks }));

const { pasteIntoElement } = await import("./nativePaste");

class PasteDocument extends EventTarget {
  activeElement: PasteTarget | null = null;
  focused = true;
  frames: { contentDocument: PasteDocument | null }[] = [];

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
    await Promise.resolve();
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
});
