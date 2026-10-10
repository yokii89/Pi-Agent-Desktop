/**
 * 预热触发策略（docs/design/44 A1）：dwell 选择、非法值归一、空闲守卫豁免。
 */

import { describe, expect, it } from "vitest";
import { PREFETCH_OPEN_DWELL_MS, PREFETCH_STABLE_MS } from "../../shared/contribution";
import { normalizePrefetchIntent, prefetchDwellMs, requiresIdleSystem } from "./prefetchPolicy";

describe("prefetch intent policy (docs/design/44 A1)", () => {
  it("explicit open uses the short dwell; weak hints keep the settle window", () => {
    expect(prefetchDwellMs("open")).toBe(PREFETCH_OPEN_DWELL_MS);
    expect(prefetchDwellMs("idle")).toBe(PREFETCH_STABLE_MS);
    expect(prefetchDwellMs(undefined)).toBe(PREFETCH_STABLE_MS);
    expect(PREFETCH_OPEN_DWELL_MS).toBeLessThan(PREFETCH_STABLE_MS);
  });

  it("normalizes unknown / legacy payloads to idle", () => {
    expect(normalizePrefetchIntent("open")).toBe("open");
    expect(normalizePrefetchIntent("idle")).toBe("idle");
    expect(normalizePrefetchIntent(undefined)).toBe("idle");
    expect(normalizePrefetchIntent("weird" as never)).toBe("idle");
  });

  it("idle hints still require an idle system; explicit open is exempt", () => {
    expect(requiresIdleSystem("idle")).toBe(true);
    expect(requiresIdleSystem(undefined)).toBe(true);
    expect(requiresIdleSystem("open")).toBe(false);
  });
});
