import { afterEach, describe, expect, it } from "vitest";
import {
  completeSessionToolReveal,
  getSessionToolReveal,
  revealSessionToolCall,
} from "./sessionToolReveal";

afterEach(() => {
  const current = getSessionToolReveal();
  if (current) completeSessionToolReveal(current.revision);
});

describe("explicit source-call navigation", () => {
  it("retains the session and exact tool identity for newly mounted folded groups", () => {
    revealSessionToolCall("session-1", "call-1");
    expect(getSessionToolReveal()).toMatchObject({ sessionId: "session-1", toolCallId: "call-1" });
  });

  it("does not let an older scroll completion clear a newer click", () => {
    revealSessionToolCall("session-1", "call-1");
    const first = getSessionToolReveal();
    revealSessionToolCall("session-2", "call-2");
    if (!first) throw new Error("Missing reveal request");
    completeSessionToolReveal(first.revision);
    const second = getSessionToolReveal();
    expect(second?.toolCallId).toBe("call-2");
    if (!second) throw new Error("Missing second request");
    completeSessionToolReveal(second.revision);
    expect(getSessionToolReveal()).toBeNull();
  });

  it("ignores empty ownership or call identities", () => {
    revealSessionToolCall("", "call-1");
    revealSessionToolCall("session-1", "");
    expect(getSessionToolReveal()).toBeNull();
  });
});
