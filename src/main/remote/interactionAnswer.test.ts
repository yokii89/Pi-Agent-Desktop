import { describe, expect, it } from "vitest";
import { remoteInteractionAnswer } from "./interactionAnswer";

describe("remote interaction answers", () => {
  it.each([true, false])("preserves explicit confirmation %s", (value) => {
    expect(remoteInteractionAnswer({ method: "confirm", title: "Continue?" }, value)).toEqual({
      confirmed: value,
    });
  });

  it("rejects a string confirmation instead of silently cancelling the local dialog", () => {
    expect(() =>
      remoteInteractionAnswer({ method: "confirm", title: "Continue?" }, "true"),
    ).toThrow("INVALID_FRAME");
  });

  it.each(["input", "editor"] as const)(
    "preserves free-form %s text and rejects boolean answers",
    (method) => {
      const request = { method, title: "Enter text" };
      expect(remoteInteractionAnswer(request, "hello")).toEqual({ value: "hello" });
      expect(() => remoteInteractionAnswer(request, false)).toThrow("INVALID_FRAME");
    },
  );

  it("maps a sanitized selection back to its original desktop-only value", () => {
    const original = "Open C:\\workspace\\project\\file.txt";
    expect(
      remoteInteractionAnswer(
        { method: "select", title: "Choose", options: [original, "Skip"] },
        "Open [local path]",
      ),
    ).toEqual({ value: original });
  });

  it("rejects ambiguous redacted choices without answering the local dialog", () => {
    expect(() =>
      remoteInteractionAnswer(
        {
          method: "select",
          title: "Choose",
          options: ["/home/example/one", "/home/example/two"],
        },
        "[local path]",
      ),
    ).toThrow("INVALID_FRAME");
  });

  it("rejects missing or unknown selection values", () => {
    expect(() => remoteInteractionAnswer({ method: "select", title: "Choose" }, "unknown")).toThrow(
      "INVALID_FRAME",
    );
    expect(() =>
      remoteInteractionAnswer({ method: "select", title: "Choose", options: ["known"] }, "unknown"),
    ).toThrow("INVALID_FRAME");
  });
});
