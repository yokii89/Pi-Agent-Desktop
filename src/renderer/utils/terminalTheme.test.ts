import { afterEach, describe, expect, it, vi } from "vitest";
import { readTerminalTheme, subscribeTerminalTheme } from "./terminalTheme";

function setup() {
  const tokens: Record<string, string> = {
    "--terminal-bg": "#111113",
    "--terminal-fg": "#cccccc",
    "--color-accent-border": "#4a8cff",
    "--color-selection": "rgba(74, 140, 255, 0.34)",
    "--color-accent-ink-dark": "#000000",
    "--color-accent-ink-light": "#ffffff",
    "--color-text-muted": "#8a8a90",
    "--color-text": "#d4d4d4",
    "--color-text-strong": "#e6e6e9",
  };
  let refresh!: () => void;
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (key: string) => tokens[key] ?? "",
  }));
  vi.stubGlobal("document", {
    documentElement: {},
    createElement: () => ({
      getContext: () => ({
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        fillStyle: "",
        getImageData: () => ({ data: [74, 140, 255, 87] }),
      }),
    }),
  });
  vi.stubGlobal("CSS", { supports: () => true });
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        refresh = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  return { tokens, change: () => refresh(), observe, disconnect };
}

afterEach(() => vi.unstubAllGlobals());

describe("terminal theme", () => {
  it("refreshes an existing terminal on accent and theme changes and skips unrelated writes", () => {
    const test = setup();
    const apply = vi.fn();
    const unsubscribe = subscribeTerminalTheme(apply);
    expect(apply).toHaveBeenCalledOnce();
    test.change();
    expect(apply).toHaveBeenCalledOnce();
    test.tokens["--color-accent-border"] = "#ffff00";
    test.tokens["--color-selection"] = "rgba(255, 255, 0, 0.34)";
    test.change();
    expect(apply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: "#ffff00",
        cursorAccent: "#000000",
        selectionBackground: "rgba(255, 255, 0, 0.34)",
      }),
    );
    test.tokens["--terminal-bg"] = "#ffffff";
    test.change();
    expect(apply).toHaveBeenCalledTimes(3);
    unsubscribe();
    expect(test.disconnect).toHaveBeenCalledOnce();
  });

  it("converts modern CSS colors to rgba while preserving selection alpha", () => {
    const test = setup();
    test.tokens["--color-selection"] = "color(srgb 0.29 0.55 1 / 0.34)";
    const theme = readTerminalTheme();
    expect(theme.selectionBackground).toBe(`rgba(74, 140, 255, ${87 / 255})`);
    expect(theme.selectionInactiveBackground).toBe(theme.selectionBackground);
    expect(theme).not.toHaveProperty("red");
  });
});
