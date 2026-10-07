/**
 * Host-side sanitize cost gate (docs/design/20 O4).
 *
 * `wire.bench.mjs` only measures framing, and the honest-boundary note in
 * docs/design/20 附录 A says an end-to-end speedup may not be claimed without
 * the Host's own per-frame cost. This closes that gap: `sanitizeTree` runs on
 * every update and patch, so it is the half of the pipeline a `patch` actually
 * saves nothing on — and the number that proves the claim stays in range.
 *
 * Thresholds are budget ceilings, not benchmarks: they exist to catch an
 * accidental O(n²) or a regression to 10× the current cost, on the two frames
 * that are heavy by protocol design (a full 200-row table, and a maxNodes tree).
 */

import { describe, expect, it } from "vitest";
import type { ViewNode } from "../../shared/view";
import { VIEW_LIMITS } from "../../shared/view";
import { applyPatch, sanitizeTree } from "./viewHostProtocol";

function tableNode(rows: number): ViewNode {
  return {
    type: "table",
    id: "t",
    columns: [
      { key: "a", label: "车道" },
      { key: "b", label: "来源" },
      { key: "c", label: "内容" },
    ],
    rows: Array.from({ length: rows }, (_, i) => ({
      id: `r${i}`,
      cells: { a: `lane-${i % 3}`, b: `source-name-${i}`, c: `summary text ${i}` },
    })),
  };
}

function maxNodesTree(): ViewNode {
  const line =
    "assistant reply excerpt: the queue reconciler re-checks the exact follower generation " +
    "before forwarding, and a stale authority is rejected without replaying the turn.";
  return {
    type: "column",
    children: Array.from({ length: VIEW_LIMITS.maxNodes - 1 }, (_, i) => ({
      type: "text" as const,
      content: `${i} · ${line}`,
    })),
  };
}

/** Median per-iteration ms over `iterations`, after a warm-up pass. */
function measure(label: string, fn: () => void, iterations: number): number {
  for (let i = 0; i < 5; i += 1) fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  // The ceilings below prove "not worse than"; this prints the actual for the
  // docs/design/20 §4 comparison table.
  if (process.env.VIEW_PERF_VERBOSE)
    console.log(`${label}: ${median.toFixed(3)} ms/frame (median)`);
  return median;
}

describe("sanitizeTree stays inside its per-frame budget", () => {
  it("full 200-row table stays under 2ms", () => {
    const tree = tableNode(VIEW_LIMITS.maxTableRows);
    const ms = measure(
      "sanitize 200-row table",
      () => {
        const result = sanitizeTree(tree);
        if ("error" in result) throw new Error("fixture must sanitize cleanly");
      },
      200,
    );
    expect(ms).toBeLessThan(2);
  });

  it("maxNodes tree stays under 10ms (0.15ms of it is JSON.stringify)", () => {
    const tree = maxNodesTree();
    const ms = measure("sanitize maxNodes tree", () => sanitizeTree(tree), 50);
    expect(ms).toBeLessThan(10);
  });

  it("patch of one card re-sanitizes the whole tree without blowing the frame budget", () => {
    // patch saves线缆字节, not sanitize work: the Host still re-sanitizes the
    // merged tree (docs/design/19 §10.3). This is the cost `patch` cannot remove.
    const root: ViewNode = {
      type: "column",
      children: [
        { type: "text", content: "Telegram bridge status" },
        tableNode(VIEW_LIMITS.maxTableRows),
      ],
    };
    const ops = [{ path: [1], node: tableNode(VIEW_LIMITS.maxTableRows) }];
    const ms = measure(
      "patch(200-row table) + re-sanitize",
      () => {
        const applied = applyPatch(root, ops);
        if ("error" in applied) throw new Error("patch fixture must apply");
        const result = sanitizeTree(applied.root);
        if ("error" in result) throw new Error("patched tree must sanitize cleanly");
      },
      100,
    );
    expect(ms).toBeLessThan(10);
  });
});
