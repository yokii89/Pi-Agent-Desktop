import { describe, expect, it } from "vitest";
import {
  type ExtensionViewEntry,
  filterViewsForSession,
  upsertSlotted,
} from "./extensionViewStore";

function panel(overrides: Partial<ExtensionViewEntry> = {}): ExtensionViewEntry {
  return {
    id: "view-a",
    panelId: "subagents",
    sessionId: "session-a",
    placement: "panel",
    root: { type: "text", content: "Graph A" },
    actions: [],
    values: {},
    ...overrides,
  };
}

describe("upsertSlotted", () => {
  it.each(["panel", "sidebar"] as const)(
    "keeps same-name %s instances when switching A → B → A",
    (placement) => {
      const a = panel({ placement });
      const b = panel({
        id: "view-b",
        sessionId: "session-b",
        placement,
        root: { type: "text", content: "Graph B" },
      });
      let entries = upsertSlotted([], a);
      expect(filterViewsForSession(entries, "session-a")).toEqual([a]);
      entries = upsertSlotted(entries, b);
      expect(filterViewsForSession(entries, "session-b")).toEqual([b]);
      expect(filterViewsForSession(entries, "session-a")).toEqual([a]);

      const updatedA = { ...a, root: { type: "text" as const, content: "Graph A updated" } };
      entries = entries.map((entry) => (entry.id === a.id ? updatedA : entry));
      expect(filterViewsForSession(entries, "session-a")).toEqual([updatedA]);
      expect(filterViewsForSession(entries, "session-b")).toEqual([b]);
      expect(filterViewsForSession(entries, "session-c")).toEqual([]);
    },
  );

  it("replaces a reconnecting slot only in its owning session", () => {
    const a = panel();
    const b = panel({ id: "view-b", sessionId: "session-b" });
    const reopened = panel({ id: "view-a-reconnected" });
    const entries = upsertSlotted([a, b], reopened);
    expect(entries).toEqual([b, reopened]);
    expect(entries.filter((entry) => entry.id !== a.id)).toEqual([b, reopened]);
    expect(entries.filter((entry) => entry.id !== reopened.id)).toEqual([b]);
  });

  it("uses the captured active session when the Host omits sessionId", () => {
    const a = panel({ sessionId: undefined, boundSessionId: "session-a" });
    const b = panel({ id: "view-b", sessionId: undefined, boundSessionId: "session-b" });
    let entries = upsertSlotted([a], b);
    expect(filterViewsForSession(entries, "session-a")).toEqual([a]);
    const reopened = panel({ id: "view-a-reconnected" });
    entries = upsertSlotted(entries, reopened);
    expect(entries).toEqual([b, reopened]);
  });

  it("prioritizes Host ownership over the active session captured at open", () => {
    const a = panel({ boundSessionId: "session-b" });
    const b = panel({ id: "view-b", sessionId: "session-b" });
    expect(upsertSlotted([a], b)).toEqual([a, b]);
    const reopened = panel({ id: "view-a-reconnected", boundSessionId: "session-b" });
    expect(upsertSlotted([a, b], reopened)).toEqual([b, reopened]);
  });

  it("deduplicates a repeated view id even when its binding changes", () => {
    const moved = panel({ sessionId: "session-b" });
    expect(upsertSlotted([panel()], moved)).toEqual([moved]);
  });

  it("keeps global and session slots separate while replacing global duplicates", () => {
    const global = panel({ id: "global", sessionId: undefined });
    const replacement = panel({ id: "new-global", sessionId: undefined });
    expect(upsertSlotted([global, panel()], replacement)).toEqual([panel(), replacement]);
    expect(filterViewsForSession([global, panel()], null)).toEqual([global]);
  });

  it("preserves global settings-slot replacement across sessions", () => {
    const a = panel({ placement: "settings" });
    const b = panel({ id: "view-b", sessionId: "session-b", placement: "settings" });
    expect(upsertSlotted([a], b)).toEqual([b]);
  });

  it("preserves different panel ids and the fallback identity of unnamed slots", () => {
    const other = panel({ id: "other", panelId: "other-panel" });
    const unnamed = panel({ id: "unnamed", panelId: undefined });
    const next = panel();
    expect(upsertSlotted([other, unnamed], next)).toEqual([other, unnamed, next]);
  });
});
