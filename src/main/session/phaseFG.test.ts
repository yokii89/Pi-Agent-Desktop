/**
 * Phase F/G 纯逻辑：worker-safe 路径过滤、选择性加载参数、speculative 回收条件。
 */

import { describe, expect, it } from "vitest";
import { parsePideskManifest } from "../extension/contributionSchema";
import { buildWorkerArgsForTest } from "../extension/extensionWorkerArgs";
import { canReclaimSpeculative } from "./speculativeReclaim";

describe("pi selective load worker args (spike)", () => {
  it("uses -ne + explicit -e paths, never full discovery", () => {
    const args = buildWorkerArgsForTest(["/abs/a.ts", "/abs/b.ts"]);
    expect(args).toContain("--no-extensions");
    expect(args).toContain("--no-skills");
    const eIdx = args.indexOf("-e");
    expect(eIdx).toBeGreaterThan(0);
    expect(args[eIdx + 1]).toBe("/abs/a.ts");
    expect(args.filter((a) => a === "-e")).toHaveLength(2);
  });

  it("empty worker-safe list still disables discovery", () => {
    const args = buildWorkerArgsForTest([]);
    expect(args).toContain("--no-extensions");
    expect(args.filter((a) => a === "-e")).toHaveLength(0);
  });
});

describe("worker-safe manifest gate", () => {
  it("default safe=false when pidesk.worker missing", () => {
    expect(parsePideskManifest({}).workerSafe).toBe(false);
    expect(parsePideskManifest({ worker: {} }).workerSafe).toBe(false);
    expect(parsePideskManifest({ worker: { safe: false } }).workerSafe).toBe(false);
  });

  it("only explicit safe=true enables worker load", () => {
    expect(parsePideskManifest({ worker: { safe: true } }).workerSafe).toBe(true);
  });
});

describe("speculative reclaim conditions (docs/design/16 §8.3)", () => {
  it("reclaims only unused speculative idle instances", () => {
    expect(
      canReclaimSpeculative({
        createdBy: "speculative-prefetch",
        usedByUser: false,
        state: "idle",
        hasActivationTxn: false,
        childAlive: true,
      }),
    ).toBe(true);
  });

  it("never reclaims user-owned or promoted instances", () => {
    expect(
      canReclaimSpeculative({
        createdBy: "send",
        usedByUser: true,
        state: "idle",
        hasActivationTxn: false,
        childAlive: true,
      }),
    ).toBe(false);
    expect(
      canReclaimSpeculative({
        createdBy: "speculative-prefetch",
        usedByUser: true,
        state: "idle",
        hasActivationTxn: false,
        childAlive: true,
      }),
    ).toBe(false);
  });

  it("never reclaims busy / activating instances", () => {
    expect(
      canReclaimSpeculative({
        createdBy: "speculative-prefetch",
        usedByUser: false,
        state: "busy",
        hasActivationTxn: false,
        childAlive: true,
      }),
    ).toBe(false);
    expect(
      canReclaimSpeculative({
        createdBy: "speculative-prefetch",
        usedByUser: false,
        state: "idle",
        hasActivationTxn: true,
        childAlive: true,
      }),
    ).toBe(false);
  });
});
