import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
  shouldPlayNotification,
} from "./notification";

describe("normalizeNotificationSettings", () => {
  it("fills defaults for missing/partial disk payloads", () => {
    const result = normalizeNotificationSettings({ enabled: false, volume: 2 });
    expect(result.enabled).toBe(false);
    expect(result.volume).toBe(1);
    expect(result.focusPolicy).toBe(DEFAULT_NOTIFICATION_SETTINGS.focusPolicy);
    expect(result.systemToast).toBe(true);
    expect(result.scenarios.completed.sound).toBe("1");
  });

  it("keeps valid scenario overrides and rejects unknown sounds", () => {
    const result = normalizeNotificationSettings({
      scenarios: {
        completed: { enabled: false, sound: "9" },
        failed: { enabled: true, sound: "4" },
      },
    });
    expect(result.scenarios.completed.enabled).toBe(false);
    expect(result.scenarios.completed.sound).toBe("1");
    expect(result.scenarios.failed.sound).toBe("4");
  });

  it("rejects non-boolean systemToast and keeps valid false", () => {
    expect(normalizeNotificationSettings({ systemToast: "yes" }).systemToast).toBe(true);
    expect(normalizeNotificationSettings({ systemToast: false }).systemToast).toBe(false);
  });
});

describe("shouldPlayNotification", () => {
  const base = normalizeNotificationSettings(undefined);

  it("mutes completed when focused on the active session (muteActiveFocused)", () => {
    expect(
      shouldPlayNotification({
        settings: base,
        scenario: "completed",
        windowFocused: true,
        sessionId: "s1",
        activeSessionId: "s1",
      }),
    ).toBe(false);
  });

  it("still plays completed for a background session while window is focused", () => {
    expect(
      shouldPlayNotification({
        settings: base,
        scenario: "completed",
        windowFocused: true,
        sessionId: "s2",
        activeSessionId: "s1",
      }),
    ).toBe(true);
  });

  it("plays critical failed even when focused on active session", () => {
    expect(
      shouldPlayNotification({
        settings: base,
        scenario: "failed",
        windowFocused: true,
        sessionId: "s1",
        activeSessionId: "s1",
        source: "session",
      }),
    ).toBe(true);
  });

  it("mutes extension confirmation when user is already looking at that session", () => {
    expect(
      shouldPlayNotification({
        settings: base,
        scenario: "needsAttention",
        windowFocused: true,
        sessionId: "s1",
        activeSessionId: "s1",
        source: "extension",
      }),
    ).toBe(false);
  });

  it("still plays extension confirmation for a background session while focused elsewhere", () => {
    expect(
      shouldPlayNotification({
        settings: base,
        scenario: "needsAttention",
        windowFocused: true,
        sessionId: "s2",
        activeSessionId: "s1",
        source: "extension",
      }),
    ).toBe(true);
  });

  it("respects global disable", () => {
    const muted = { ...base, enabled: false };
    expect(
      shouldPlayNotification({
        settings: muted,
        scenario: "failed",
        windowFocused: false,
      }),
    ).toBe(false);
  });
});
