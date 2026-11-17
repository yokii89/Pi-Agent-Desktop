import { describe, expect, it } from "vitest";
import { previewPageStep } from "./previewPageKeys";

function keyEvent(key: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    defaultPrevented: false,
    isComposing: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    ...overrides,
  } as KeyboardEvent;
}

describe("previewPageStep", () => {
  it("maps all arrow directions to previous or next page", () => {
    expect(previewPageStep(keyEvent("ArrowLeft"))).toBe(-1);
    expect(previewPageStep(keyEvent("ArrowUp"))).toBe(-1);
    expect(previewPageStep(keyEvent("ArrowRight"))).toBe(1);
    expect(previewPageStep(keyEvent("ArrowDown"))).toBe(1);
  });

  it("leaves modified, handled and IME events alone", () => {
    expect(previewPageStep(keyEvent("ArrowRight", { ctrlKey: true }))).toBeNull();
    expect(previewPageStep(keyEvent("ArrowRight", { metaKey: true }))).toBeNull();
    expect(previewPageStep(keyEvent("ArrowRight", { altKey: true }))).toBeNull();
    expect(previewPageStep(keyEvent("ArrowRight", { defaultPrevented: true }))).toBeNull();
    expect(previewPageStep(keyEvent("ArrowRight", { isComposing: true }))).toBeNull();
    expect(previewPageStep(keyEvent("Escape"))).toBeNull();
  });

  it("leaves editable fields and active text selections alone", () => {
    const input = {
      nodeType: 1,
      parentElement: null,
      closest: () => ({}),
      ownerDocument: null,
    } as unknown as Node;
    expect(previewPageStep(keyEvent("ArrowRight", { target: input }))).toBeNull();

    const selection = { isCollapsed: false };
    const pageText = {
      nodeType: 1,
      parentElement: null,
      closest: () => null,
      ownerDocument: { getSelection: () => selection },
    } as unknown as Node;
    expect(previewPageStep(keyEvent("ArrowRight", { target: pageText }))).toBeNull();
  });
});
