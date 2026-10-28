import { describe, expect, it } from "vitest";
import { accessModeManifestEntry, defineAccessMode } from "./accessMode.js";
import { DesktopViewClient } from "./client.js";
import { ACCESS_MODE_ICON_NAMES, CONTRIBUTION_ICON_NAMES } from "./contributionTypes.js";
import { createTestViewHost } from "./testing.js";
import { VIEW_PROTOCOL_VERSION } from "./types.js";
import { type RegisterAccessModeOptions, registerAccessMode } from "./view.js";

const PLAN_MANIFEST = {
  id: "yoki-plan",
  title: "计划模式",
  description: "只读探索：edit/write 禁用",
  icon: "clipboard",
  accent: "warning",
  activation: "onAccessMode",
} as const;

describe("defineAccessMode", () => {
  it("derives the runtime descriptor from a manifest entry", () => {
    const mode = defineAccessMode(PLAN_MANIFEST);
    expect(mode).toEqual({
      id: "yoki-plan",
      title: "计划模式",
      description: "只读探索：edit/write 禁用",
      icon: "clipboard",
      accent: "warning",
    });
    expect(mode).not.toHaveProperty("activation");
    expect(Object.isFrozen(mode)).toBe(true);
  });

  it("trims id/title/description and omits empty optional fields", () => {
    const mode = defineAccessMode({
      id: "  plan  ",
      title: " Plan ",
      description: "   ",
      icon: "",
    });
    expect(mode).toEqual({ id: "plan", title: "Plan" });
  });

  it("throws for an empty or non-string id/title", () => {
    expect(() => defineAccessMode({ id: " ", title: "Plan" })).toThrow(TypeError);
    expect(() => defineAccessMode({ id: "plan", title: "" })).toThrow(TypeError);
    expect(() => defineAccessMode({ id: 42, title: "Plan" } as never)).toThrow(TypeError);
  });

  it("throws for a non-object input", () => {
    expect(() => defineAccessMode(undefined as never)).toThrow(TypeError);
    expect(() => defineAccessMode(null as never)).toThrow(TypeError);
  });

  it("throws when a non-access-mode activation is passed", () => {
    expect(() => defineAccessMode({ ...PLAN_MANIFEST, activation: "onSettingsView" })).toThrow(
      /onAccessMode/,
    );
  });

  it("round-trips through the manifest shape", () => {
    const mode = defineAccessMode(PLAN_MANIFEST);
    expect(accessModeManifestEntry(mode)).toEqual(PLAN_MANIFEST);
  });

  it("keeps the access-mode icon subset inside the contribution whitelist", () => {
    for (const icon of ACCESS_MODE_ICON_NAMES) {
      expect(CONTRIBUTION_ICON_NAMES).toContain(icon);
    }
  });

  it("is assignable as a registration descriptor", () => {
    const registration: Omit<RegisterAccessModeOptions, "onEvent" | "signal"> =
      defineAccessMode(PLAN_MANIFEST);
    expect(registration.id).toBe("yoki-plan");
  });
});

describe("registerAccessMode with defineAccessMode", () => {
  it("sends the derived descriptor on the open frame", async () => {
    const host = await createTestViewHost();
    const client = new DesktopViewClient(
      { endpoint: host.endpoint, token: host.token, protocol: VIEW_PROTOCOL_VERSION },
      { helloTimeoutMs: 1000, connectTimeoutMs: 2000 },
    );
    try {
      const handle = await registerAccessMode(client, defineAccessMode(PLAN_MANIFEST));
      expect(handle).not.toBeNull();

      const open = host.framesOfType("open")[0];
      const payload = open?.payload as
        | { placement?: string; placementHint?: { mode?: unknown } }
        | undefined;
      expect(payload?.placement).toBe("access-mode");
      expect(payload?.placementHint?.mode).toEqual({
        id: "yoki-plan",
        title: "计划模式",
        description: "只读探索：edit/write 禁用",
        icon: "clipboard",
        accent: "warning",
      });

      handle?.session.close();
    } finally {
      client.dispose();
      await host.close();
    }
  });
});
