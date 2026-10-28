import { describe, expect, it } from "vitest";
import { sidebarBadgeLabel, sidebarBadgeText } from "./badgeSemantics";

const t = (key: string, params?: Readonly<Record<string, string | number>>): string =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe("sidebarBadgeText", () => {
  it("shows the count and caps the display at 99+", () => {
    expect(sidebarBadgeText({ tone: "attention", count: 1 })).toBe("1");
    expect(sidebarBadgeText({ tone: "attention", count: 99 })).toBe("99");
    expect(sidebarBadgeText({ tone: "attention", count: 150 })).toBe("99+");
  });

  it("falls back to the short label, then to a bare dot", () => {
    expect(sidebarBadgeText({ tone: "attention", label: "失败" })).toBe("失败");
    expect(sidebarBadgeText({ tone: "attention" })).toBeNull();
  });
});

describe("sidebarBadgeLabel", () => {
  it("keeps the tone and count in the accessible name", () => {
    expect(sidebarBadgeLabel(t, "Telegram", { tone: "attention", count: 1 })).toContain(
      "panels.context.badgeAttention",
    );
    expect(sidebarBadgeLabel(t, "Telegram", { tone: "success", count: 2 })).toContain(
      "panels.context.badgeSuccess",
    );
    expect(sidebarBadgeLabel(t, "Telegram", { tone: "muted", count: 3 })).toContain(
      "panels.context.badgeMuted",
    );
  });

  it("uses the no-count wording when only a tone is present", () => {
    expect(sidebarBadgeLabel(t, "Telegram", { tone: "attention" })).toContain(
      "panels.context.badgeAttentionHint",
    );
    expect(sidebarBadgeLabel(t, "Telegram", { tone: "success" })).toContain(
      "panels.context.badgeSuccessHint",
    );
    expect(sidebarBadgeLabel(t, "Telegram", { tone: "muted" })).toContain(
      "panels.context.badgeMutedHint",
    );
  });

  it("includes the visible title in the name", () => {
    const name = sidebarBadgeLabel(t, "Telegram", { tone: "attention", count: 1 });
    expect(name).toContain("Telegram");
  });
});
