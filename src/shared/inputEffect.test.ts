import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTABLE_KEYS } from "../main/settings/schema";
import { INPUT_EFFECTS, isInputEffect, normalizeInputEffect } from "./inputEffect";
import { pickSyncableSettings } from "./settingsSync";

describe("input effect settings contract", () => {
  it("keeps the original effect for missing or invalid persisted values", () => {
    for (const value of [undefined, null, "unknown", "EMBER", 0, {}, ["nebula"]]) {
      expect(isInputEffect(value)).toBe(false);
      expect(normalizeInputEffect(value)).toBe("ember");
    }
    expect(DEFAULT_SETTINGS.inputEffect).toBe("ember");
  });

  it("preserves every selectable effect, including explicit off, through sync", () => {
    expect(SETTABLE_KEYS).toContain("inputEffect");
    for (const inputEffect of INPUT_EFFECTS) {
      expect(isInputEffect(inputEffect)).toBe(true);
      expect(normalizeInputEffect(inputEffect)).toBe(inputEffect);
      expect(pickSyncableSettings({ ...DEFAULT_SETTINGS, inputEffect }).inputEffect).toBe(
        inputEffect,
      );
    }
  });
});
