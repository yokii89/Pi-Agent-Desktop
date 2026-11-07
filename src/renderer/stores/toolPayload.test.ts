import { describe, expect, it } from "vitest";
import {
  buildToolResult,
  classifyTool,
  type FileChangePayload,
  parseBackgroundJob,
  parseToolArgs,
  parseUnifiedDiff,
} from "./toolPayload";

/**
 * 变更行统计（汇总卡与工具行共用）：pi 的 edit 结果只有「Successfully replaced N block(s)」文案、
 * 无 diff，行数是按参数估出来的。pi 的 edit 参数是 `edits: [{ oldText, newText }]` 批量形态，
 * 早期只认单对字段，导致编辑类文件在汇总卡里整列没有 +/-。
 */
function change(args: unknown, kind: "edit" | "write" = "edit"): FileChangePayload {
  const payload = buildToolResult(
    kind,
    args,
    { content: [{ type: "text", text: "Successfully replaced 2 block(s) in D:/a.ts." }] },
    false,
  );
  if (payload.kind !== "change") throw new Error(`期望 change，实际 ${payload.kind}`);
  return payload;
}

describe("buildToolResult 的 change 行统计", () => {
  it("pi 的 edits 批量形态按块累加两侧", () => {
    const result = change({
      path: "D:/a.ts",
      edits: [
        { oldText: "line1\nline2", newText: "line1\nline2\nline3" },
        { oldText: "solo", newText: "one\ntwo" },
      ],
    });
    expect(result.additions).toBe(5);
    expect(result.deletions).toBe(3);
  });

  it("单对字段仍可用，只有一侧时另一侧保持 null", () => {
    expect(change({ path: "D:/a.ts", oldText: "a\nb", newText: "a" })).toMatchObject({
      additions: 1,
      deletions: 2,
    });
    expect(change({ path: "D:/a.ts", newText: "a\nb" }).deletions).toBeNull();
  });

  it("write 全文记 additions，不编造 deletions", () => {
    expect(change({ path: "D:/a.ts", content: "1\n2\n3\n" }, "write")).toMatchObject({
      additions: 3,
      deletions: null,
    });
  });

  it("有真实 unified diff 时以 diff 为准，不取估算", () => {
    const payload = buildToolResult(
      "edit",
      { path: "D:/a.ts", edits: [{ oldText: "a\nb\nc", newText: "a\nB\nc" }] },
      {
        content: [{ type: "text", text: "ok" }],
        details: { diff: "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n" },
      },
      false,
    );
    if (payload.kind !== "change") throw new Error("期望 change");
    expect(payload.additions).toBe(1);
    expect(payload.deletions).toBe(1);
  });

  it("认不出的参数结构不报数（避免假的 +0 -0）", () => {
    expect(change({ path: "D:/a.ts" })).toMatchObject({ additions: null, deletions: null });
    expect(change({ path: "D:/a.ts", edits: [{ note: "x" }] })).toMatchObject({
      additions: null,
      deletions: null,
    });
  });
});

describe("change 的 diff 采集与合成", () => {
  it("write 无 details 时从 content 合成全文新增 diff", () => {
    const result = change({ path: "docs/a.md", content: "# 标题\n正文\n" }, "write");
    expect(result.diff).toBe("@@ -0,0 +1,2 @@\n+# 标题\n+正文");
    expect(result.additions).toBe(2);
    expect(result.deletions).toBeNull();
  });

  it("edit 无 details 时从替换块合成 unified diff", () => {
    const result = change({
      path: "D:/a.ts",
      edits: [{ oldText: "old\nline", newText: "new\nline\nmore" }],
    });
    expect(result.diff).toContain("@@");
    expect(result.diff).toContain("-old");
    expect(result.diff).toContain("+new");
    expect(result.diff).toContain("+more");
  });

  it("优先 details.patch（标准 unified），不取展示型 diff", () => {
    const payload = buildToolResult(
      "edit",
      { path: "D:/a.ts", edits: [{ oldText: "a\nb\nc", newText: "a\nB\nc" }] },
      {
        content: [{ type: "text", text: "ok" }],
        details: {
          diff: "   1 a\n-  2 b\n+  2 B\n   3 c",
          patch: "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n",
        },
      },
      false,
    );
    if (payload.kind !== "change") throw new Error("期望 change");
    expect(payload.diff).toBe("@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n");
  });
});

describe("parseUnifiedDiff 同时认标准 unified 与 pi 展示型", () => {
  it("标准 unified：按 hunk 头分行号", () => {
    const hunks = parseUnifiedDiff("@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n");
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.lines).toEqual([
      { kind: "context", text: "a", oldLine: 1, newLine: 1 },
      { kind: "del", text: "b", oldLine: 2, newLine: null },
      { kind: "add", text: "B", oldLine: null, newLine: 2 },
      { kind: "context", text: "c", oldLine: 3, newLine: 3 },
    ]);
  });

  it("pi 展示型：无 @@ 也能解析出增删行", () => {
    const hunks = parseUnifiedDiff("   1 a\n-  2 b\n+  2 B\n   3 c");
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.lines.map((line) => line.kind)).toEqual(["context", "del", "add", "context"]);
    expect(hunks[0]?.lines[1]).toMatchObject({ text: "b", oldLine: 2 });
    expect(hunks[0]?.lines[2]).toMatchObject({ text: "B", newLine: 2 });
  });

  it("展示型截断标记切开多段 hunk", () => {
    const hunks = parseUnifiedDiff("-  1 a\n+  1 A\n     ...\n   10 z\n+ 11 y");
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.lines).toHaveLength(2);
    expect(hunks[1]?.lines).toHaveLength(2);
  });

  it("纯成功文案不解析出 hunk", () => {
    expect(parseUnifiedDiff("Successfully wrote to a.ts")).toEqual([]);
  });
});

/**
 * pi-bash-jobs 的两个作业工具（docs/design/129 §8.2）：名字不在任何集合里时落 generic，
 * 摘要头按「次」计、与 bash 不同口径；归入 terminal 后两者口径一致。
 */
describe("作业工具的归类", () => {
  it("inspect / stop 与 bash 同为 terminal", () => {
    expect(classifyTool("tool_execution_inspect_output")).toBe("terminal");
    expect(classifyTool("bash_job_stop")).toBe("terminal");
    expect(classifyTool("bash")).toBe("terminal");
  });

  it("没有 command 参数时主体取作业 id", () => {
    expect(parseToolArgs("terminal", { job: "J-3", tailLines: 80 }).subject).toBe("J-3");
    expect(parseToolArgs("terminal", { command: "pnpm dev" }).subject).toBe("pnpm dev");
  });
});

/**
 * 转后台回执的识别（docs/design/129 P2 工具行徽标）：只认两种回执开头；
 * 结束通知 / 停止回执 / 普通输出不得命中——那些行就该是普通完成态。
 */
describe("parseBackgroundJob", () => {
  it("finish 让路的回执带出作业 id 与 label", () => {
    const receipt = [
      "Job J-2 (dev server) moved to the background after 5m12s (no output for a while).",
      "Command: pnpm dev",
    ].join("\n");
    expect(parseBackgroundJob(receipt)).toEqual({ id: "J-2", label: "dev server" });
  });

  it("显式 detach 的回执没有 label", () => {
    expect(parseBackgroundJob("Job J-1 started in the background (mode=detach).")).toEqual({
      id: "J-1",
      label: undefined,
    });
  });

  it("结束通知 / 停止回执 / 普通输出不命中", () => {
    expect(parseBackgroundJob("Bash job J-1 finished: exit 0 after 5m.")).toBeNull();
    expect(parseBackgroundJob("Stopped job J-1: killed the whole process tree.")).toBeNull();
    expect(parseBackgroundJob("Job started\nsome output")).toBeNull();
  });

  it("buildToolResult 把作业身份带进 terminal 载荷", () => {
    const result = buildToolResult(
      "terminal",
      { command: "pnpm dev" },
      "Job J-3 moved to the background after 3m (soft budget reached).",
      false,
    );
    expect(result).toMatchObject({ kind: "terminal", job: { id: "J-3" } });
  });
});
