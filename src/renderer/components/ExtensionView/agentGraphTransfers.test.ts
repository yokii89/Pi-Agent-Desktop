import { describe, expect, it } from "vitest";
import type { ViewAgentNode, ViewAgentState } from "../../../shared/view";
import {
  type AgentGraphSignal,
  agentGraphTransfers,
  retainAgentGraphSignals,
} from "./agentGraphTransfers";

const task = (id: string, state: ViewAgentState): ViewAgentNode => ({
  id,
  state,
  label: id,
  description: id,
});

describe("agent graph state packets", () => {
  it("expires hidden packets independently while unrelated transfers remain active", () => {
    const old: AgentGraphSignal = {
      agentId: "old",
      direction: "delegate",
      key: 1,
      delay: 0,
      expiresAt: 100,
    };
    const fresh: AgentGraphSignal = {
      agentId: "fresh",
      direction: "return",
      key: 2,
      delay: 0,
      expiresAt: 200,
    };
    const states = new Map<string, ViewAgentState>([
      ["old", "running"],
      ["fresh", "completed"],
    ]);
    expect(retainAgentGraphSignals([old, fresh], states, 150)).toEqual([fresh]);
    expect(retainAgentGraphSignals([old, fresh], states, 200)).toEqual([]);
    expect(old.expiresAt).toBe(100);
  });
  it("removes superseded or deleted task packets before their deadline", () => {
    const signal: AgentGraphSignal = {
      agentId: "a",
      direction: "delegate",
      key: 1,
      delay: 0,
      expiresAt: 100,
    };
    expect(retainAgentGraphSignals([signal], new Map([["a", "stopped"]]), 50)).toEqual([]);
    expect(retainAgentGraphSignals([signal], new Map(), 50)).toEqual([]);
  });
  it("does not present restored running/completed history as fresh transfers", () => {
    expect(agentGraphTransfers(undefined, [task("a", "running"), task("b", "completed")])).toEqual(
      [],
    );
  });
  it("animates observed starts and completions, excluding the main agent", () => {
    expect(
      agentGraphTransfers(
        new Map([
          ["a", "queued"],
          ["b", "running"],
        ]),
        [
          { ...task("main", "running"), kind: "main" },
          task("a", "running"),
          task("b", "completed"),
          task("c", "running"),
        ],
      ),
    ).toEqual([
      { agentId: "a", direction: "delegate" },
      { agentId: "b", direction: "return" },
      { agentId: "c", direction: "delegate" },
    ]);
  });
  it("ignores metadata refreshes, newly paged completed tasks, stops, and failures", () => {
    expect(
      agentGraphTransfers(
        new Map([
          ["a", "running"],
          ["b", "running"],
          ["c", "queued"],
        ]),
        [
          { ...task("a", "running"), meta: ["3s"] },
          task("b", "error"),
          task("c", "stopped"),
          task("history", "completed"),
        ],
      ),
    ).toEqual([]);
  });
});
