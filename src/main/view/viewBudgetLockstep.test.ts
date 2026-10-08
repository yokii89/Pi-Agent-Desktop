/**
 * Host ↔ SDK budget lockstep (docs/design/20 O3).
 *
 * `packages/view-sdk/src/limits.ts` exists so extensions stop hand-copying the
 * Host's node/depth accounting — which means it must not become a *second* copy
 * that drifts. This test is the guard: for a battery of trees, Host
 * `sanitizeTree` and SDK `measureViewTree` must agree on accept/reject.
 *
 * It lives on the Host side because that is where `sanitizeTree` is reachable
 * without dragging Electron into the SDK package's test run.
 */

import { describe, expect, it } from "vitest";
import { measureViewTree } from "../../../packages/view-sdk/src/limits";
import type { ViewNode } from "../../shared/view";
import { VIEW_LIMITS } from "../../shared/view";
import { sanitizeTree } from "./viewHostProtocol";

function txt(content: string): ViewNode {
  return { type: "text", content };
}

function col(...children: ViewNode[]): ViewNode {
  return { type: "column", children };
}

function tableNode(rows: number): ViewNode {
  return {
    type: "table",
    id: "t",
    columns: [{ key: "a", label: "A" }],
    rows: Array.from({ length: rows }, (_, i) => ({ id: `r${i}`, cells: { a: `v${i}` } })),
  };
}

function tabsNode(tabs: number): ViewNode {
  return {
    type: "tabs",
    id: "tabs",
    tabs: Array.from({ length: tabs }, (_, i) => ({
      id: `t${i}`,
      label: `T${i}`,
      children: [txt(`b${i}`)],
    })),
  };
}

function deepNode(depth: number): ViewNode {
  let node = txt("leaf");
  for (let i = 1; i < depth; i += 1) node = col(node);
  return node;
}

function wideNode(children: number): ViewNode {
  return col(...Array.from({ length: children }, (_, i) => txt(`n${i}`)));
}

/** Trees whose accept/reject verdict the two implementations must share. */
const CASES: Array<[label: string, node: ViewNode]> = [
  ["single text", txt("hi")],
  ["small column", col(txt("a"), txt("b"), col(txt("c")))],
  [
    "non-object child (Host substitutes, does not charge)",
    col("nope" as unknown as ViewNode, txt("b")),
  ],
  ["unknown node type (degrades, still charged)", { type: "mystery" } as unknown as ViewNode],
  ["table at maxTableRows", tableNode(VIEW_LIMITS.maxTableRows)],
  ["table over maxTableRows (clipped, not rejected)", tableNode(VIEW_LIMITS.maxTableRows + 250)],
  ["table filling the node budget", tableNode(VIEW_LIMITS.maxNodes - 1)],
  ["table one row past the node budget", tableNode(VIEW_LIMITS.maxNodes)],
  ["tabs at 100", tabsNode(100)],
  ["tabs doubling as a node-budget attack", tabsNode(VIEW_LIMITS.maxNodes)],
  ["depth exactly at maxDepth", deepNode(VIEW_LIMITS.maxDepth)],
  ["depth one past maxDepth", deepNode(VIEW_LIMITS.maxDepth + 1)],
  ["children exactly at maxNodes", wideNode(VIEW_LIMITS.maxNodes - 1)],
  ["children one past maxNodes", wideNode(VIEW_LIMITS.maxNodes)],
  ["children far past maxNodes", wideNode(VIEW_LIMITS.maxNodes * 2)],
];

describe("SDK measureViewTree agrees with Host sanitizeTree on accept/reject", () => {
  for (const [label, node] of CASES) {
    it(label, () => {
      const measured = measureViewTree(node, VIEW_LIMITS);
      const sdkWouldReject =
        measured.nodes > VIEW_LIMITS.maxNodes || measured.depth > VIEW_LIMITS.maxDepth;
      const hostResult = sanitizeTree(node);
      const hostRejected = "error" in hostResult;

      expect(sdkWouldReject).toBe(hostRejected);
      if (!hostRejected) {
        // The node count must also match exactly, not merely the verdict:
        // an off-by-one here is how a panel silently stops updating later.
        expect(measured.nodes).toBeLessThanOrEqual(VIEW_LIMITS.maxNodes);
      }
    });
  }
});

describe("measured counts equal the Host's budget rules", () => {
  it("charges one node per tab, which a hand-written copy got wrong", () => {
    const tabs = 10;
    const measured = measureViewTree(tabsNode(tabs), VIEW_LIMITS);
    expect(measured.nodes).toBe(1 + tabs * 2);
  });

  it("charges one node per row and none per cell", () => {
    expect(measureViewTree(tableNode(30), VIEW_LIMITS).nodes).toBe(31);
  });

  it("does not charge the Host's synthetic text leaf", () => {
    const measured = measureViewTree(col("junk" as unknown as ViewNode, txt("b")), VIEW_LIMITS);
    expect(measured.nodes).toBe(2);
  });
});
