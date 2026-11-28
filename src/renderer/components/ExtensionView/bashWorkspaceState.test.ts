import { describe, expect, it } from "vitest";
import type {
  ViewBashJob,
  ViewBashWorkspaceNode,
  ViewBashWorkspaceValue,
} from "../../../shared/view";
import {
  bashControlValue,
  bashHighlights,
  bashJobSeconds,
  bashJobState,
  bashLogLines,
  bashReading,
  bashUnreadDelta,
  createBashWorkspaceMemory,
} from "./bashWorkspaceState";
import { collectFormValues } from "./formValues";

const job: ViewBashJob = {
  id: "J-1",
  command: "pnpm dev",
  status: "running",
  mode: "detach",
  reason: "explicit",
  startedAt: 1000,
  lastOutputAt: 4000,
  detached: true,
  outputBytes: 6,
  outputLines: 1,
};

describe("Bash workspace reading and status", () => {
  it("collects only the authoritative controls and never includes output in action values", () => {
    const root: ViewBashWorkspaceNode = {
      type: "bash-workspace",
      id: "bash-jobs:workspace",
      jobs: [job],
      value: { selectedId: job.id, query: "pnpm", filter: "running", page: 0 },
      counts: { total: 1, running: 1, ended: 0, orphaned: 0 },
      matchedJobs: 1,
      pageCount: 1,
      outputJobId: job.id,
      output: "private log text",
      cursor: "1",
      outputStartLine: 1,
      outputTruncated: false,
      outputMore: false,
      partial: true,
    };
    expect(collectFormValues(root, { "bash-jobs:workspace": { selectedId: "stale" } })).toEqual({
      "bash-jobs:workspace": root.value,
    });
    expect(JSON.stringify(collectFormValues(root))).not.toContain("private log text");
    expect(collectFormValues({ type: "column", children: [] }, collectFormValues(root))).toEqual(
      {},
    );
  });
  it("never labels an unobserved exit as a failure or advances an orphan clock", () => {
    expect(bashJobState({ ...job, status: "exited" })).toBe("exited");
    expect(bashJobState({ ...job, status: "orphaned", exitCode: 1 })).toBe("orphaned");
    expect(bashJobState({ ...job, status: "exited", exitCode: 0 })).toBe("success");
    expect(bashJobState({ ...job, status: "exited", exitCode: 1 })).toBe("failed");
    expect(bashJobSeconds({ ...job, status: "orphaned" }, 100_000)).toBe(3);
    expect(bashJobSeconds({ ...job, status: "exited", exitedAt: 5000 }, 100_000)).toBe(4);
  });
  it("keeps original line numbers when filtering literal output", () => {
    expect(bashLogLines("hello\n<script>\nHELLO again", 300, "hello")).toEqual([
      { number: 300, text: "hello" },
      { number: 302, text: "HELLO again" },
    ]);
    expect(bashHighlights("a <script> a", "<script>")).toEqual([
      { text: "a ", match: false },
      { text: "<script>", match: true },
      { text: " a", match: false },
    ]);
    expect(bashHighlights("a [.*] b", "[.*]").filter((part) => part.match)).toEqual([
      { text: "[.*]", match: true },
    ]);
  });
  it("preserves reading position separately for each job, with bounded memory", () => {
    const memory = createBashWorkspaceMemory();
    Object.assign(bashReading(memory, "J-1"), { top: 123, follow: false, query: "error" });
    expect(bashReading(memory, "J-2").follow).toBe(true);
    expect(bashReading(memory, "J-1")).toMatchObject({ top: 123, follow: false, query: "error" });
    for (let i = 3; i < 400; i++) bashReading(memory, `J-${i}`);
    expect(memory.readings.size).toBe(256);
    expect(createBashWorkspaceMemory().readings.size).toBe(0);
  });
  it("counts committed output and pending fragments without duplicating re-renders", () => {
    expect(bashUnreadDelta(undefined, undefined, "20", "text")).toBe(0);
    expect(bashUnreadDelta("20", "a", "23", "a\nb\nc\nd")).toBe(3);
    expect(bashUnreadDelta("23", "pending", "23", "pending update")).toBe(1);
    expect(bashUnreadDelta("23", "pending", "23", "pending")).toBe(0);
  });
  it("narrows optimistic control values without trusting arbitrary input", () => {
    const fallback: ViewBashWorkspaceValue = { filter: "all", page: 0, query: "" };
    expect(bashControlValue(null, fallback)).toBe(fallback);
    expect(
      bashControlValue({ selectedId: "J-1", filter: "not-a-filter", page: Infinity }, fallback),
    ).toEqual({ ...fallback, selectedId: "J-1" });
  });
});
