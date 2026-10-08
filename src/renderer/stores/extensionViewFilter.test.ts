import { describe, expect, it } from "vitest";
import {
  accessModeMatchesSession,
  filterViewsForSession,
  staleActiveAccessModeIds,
  viewBelongsToSession,
  viewMatchesActive,
} from "./extensionViewStore";

describe("viewMatchesActive", () => {
  it("matches host sessionId exactly", () => {
    expect(viewMatchesActive({ sessionId: "s1" }, "s1")).toBe(true);
    expect(viewMatchesActive({ sessionId: "s1" }, "s2")).toBe(false);
  });

  it("uses boundSessionId only when host sessionId missing", () => {
    expect(viewMatchesActive({ boundSessionId: "s1" }, "s1")).toBe(true);
    expect(viewMatchesActive({ sessionId: "s2", boundSessionId: "s1" }, "s1")).toBe(false);
  });

  it("unbound views are global", () => {
    expect(viewMatchesActive({}, "s1")).toBe(true);
    expect(viewMatchesActive({}, null)).toBe(true);
  });
});

describe("filterViewsForSession", () => {
  const a = { sessionId: "sa" };
  const b = { sessionId: "sb" };
  const unbound = {};

  it("isolates when exact match exists", () => {
    expect(filterViewsForSession([a, b, unbound], "sa")).toEqual([a, unbound]);
    expect(filterViewsForSession([a, b, unbound], "sb")).toEqual([b, unbound]);
  });

  it("empty active only keeps unbound", () => {
    expect(filterViewsForSession([a, b, unbound], null)).toEqual([unbound]);
  });

  it("does NOT leak other sessions' forms when active matches nothing", () => {
    expect(filterViewsForSession([a, b], "s-new")).toEqual([]);
    expect(filterViewsForSession([a, b, unbound], "s-new")).toEqual([unbound]);
  });
});

describe("viewBelongsToSession", () => {
  it("delegates to viewMatchesActive", () => {
    expect(viewBelongsToSession({ sessionId: "s1" }, "s1")).toBe(true);
    expect(viewBelongsToSession({ sessionId: "s1" }, null)).toBe(false);
  });
});

describe("staleActiveAccessModeIds", () => {
  const mode = (id: string, active?: boolean, sessionId?: string) => ({
    id,
    ...(sessionId === undefined ? {} : { sessionId }),
    placementHint: { mode: { id, title: id, ...(active === undefined ? {} : { active }) } },
  });

  it("returns other active registrations when a new one activates", () => {
    const entries = [mode("a", true, "s1"), mode("b", false, "s1"), mode("c", undefined, "s1")];
    expect(staleActiveAccessModeIds(entries, mode("b", true, "s1"))).toEqual(["a"]);
  });

  it("convergence is session-scoped: other sessions' active modes are untouched", () => {
    const entries = [mode("a", true, "s1"), mode("b", true, "s2")];
    expect(staleActiveAccessModeIds(entries, mode("b", true, "s2"))).toEqual([]);
    expect(staleActiveAccessModeIds(entries, mode("a", true, "s1"))).toEqual([]);
  });

  it("treats unbound registrations as one implicit session group", () => {
    const entries = [mode("a", true), mode("b", true, "s1")];
    expect(staleActiveAccessModeIds(entries, mode("b2", true))).toEqual(["a"]);
  });

  it("returns empty when the activated entry is not active", () => {
    const entries = [mode("a", true, "s1")];
    expect(staleActiveAccessModeIds(entries, mode("a", false, "s1"))).toEqual([]);
    expect(staleActiveAccessModeIds(entries, { id: "x" })).toEqual([]);
  });

  it("never includes the activated entry itself", () => {
    const entries = [mode("a", true, "s1")];
    expect(staleActiveAccessModeIds(entries, mode("a", true, "s1"))).toEqual([]);
  });
});

describe("accessModeMatchesSession", () => {
  it("requires an active session", () => {
    expect(accessModeMatchesSession({ sessionId: "s1" }, null)).toBe(false);
    expect(accessModeMatchesSession({}, null)).toBe(false);
  });

  it("matches host sessionId exactly", () => {
    expect(accessModeMatchesSession({ sessionId: "s1" }, "s1")).toBe(true);
    expect(accessModeMatchesSession({ sessionId: "s1" }, "s2")).toBe(false);
  });

  it("falls back to boundSessionId only when host sessionId missing", () => {
    expect(accessModeMatchesSession({ boundSessionId: "s1" }, "s1")).toBe(true);
    expect(accessModeMatchesSession({ sessionId: "s2", boundSessionId: "s1" }, "s1")).toBe(false);
  });

  it("unbound registrations never match (process-outside registrations stay hidden)", () => {
    expect(accessModeMatchesSession({}, "s1")).toBe(false);
  });
});
