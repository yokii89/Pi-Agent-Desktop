import { describe, expect, it } from "vitest";
import {
  computeUsageHeatScale,
  resolveUsageProject,
  type UsageProject,
  usageHeatLevel,
} from "../../shared/usage";
import { aggregateUsage, type FileUsage, type UsageEntry } from "./usageAggregate";

function entry(partial: Partial<UsageEntry>): UsageEntry {
  const ts = partial.ts ?? 0;
  return {
    ts,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      ...partial.usage,
    },
    provider: partial.provider ?? null,
    model: partial.model ?? null,
  };
}

const DEMO_PROJECT: UsageProject = { key: "D:\\Code\\demo", cwd: "D:\\Code\\demo", name: "demo" };

function file(partial: Partial<FileUsage> & Pick<FileUsage, "entries">): FileUsage {
  return {
    file: partial.file ?? "a.jsonl",
    project: partial.project ?? DEMO_PROJECT,
    entries: partial.entries,
  };
}

/** 本地时区当天 12:00 的 Unix ms（分桶断言与时区无关）。 */
function localNoon(day: number): number {
  return new Date(2026, 8, day, 12, 0, 0, 0).getTime();
}

describe("aggregateUsage", () => {
  const now = localNoon(30);

  it("空输入返回全零报表", () => {
    const report = aggregateUsage([], null, now);
    expect(report.totals.totalTokens).toBe(0);
    expect(report.totals.sessions).toBe(0);
    expect(report.totals.assistantMessages).toBe(0);
    expect(report.byDay).toEqual([]);
    expect(report.byProject).toEqual([]);
    expect(report.byModel).toEqual([]);
    expect(report.granularity).toBe("day");
  });

  it("按天分桶并升序排列，totals 汇总所有条目", () => {
    const files: FileUsage[] = [
      file({
        entries: [
          entry({
            ts: localNoon(1),
            usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110 },
            provider: "p1",
            model: "m1",
          }),
          entry({
            ts: localNoon(1),
            usage: { input: 50, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 55 },
            provider: "p1",
            model: "m1",
          }),
          entry({
            ts: localNoon(2),
            usage: { input: 200, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 220 },
            provider: "p1",
            model: "m1",
          }),
        ],
      }),
    ];
    const report = aggregateUsage(files, null, now);
    expect(report.totals.assistantMessages).toBe(3);
    expect(report.totals.input).toBe(350);
    expect(report.totals.totalTokens).toBe(385);
    expect(report.totals.sessions).toBe(1);
    expect(report.byDay.map((slice) => slice.key)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(report.byDay[0].totalTokens).toBe(165);
    expect(report.byDay[1].totalTokens).toBe(220);
    // 单文件跨两天：每个桶的 sessions 各计 1
    expect(report.byDay[0].sessions).toBe(1);
    expect(report.byDay[1].sessions).toBe(1);
  });

  it("同一模型跨文件时 sessions 计数正确", () => {
    const files: FileUsage[] = [
      file({
        file: "a.jsonl",
        entries: [
          entry({
            ts: localNoon(1),
            usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10 },
            provider: "p",
            model: "m",
          }),
        ],
      }),
      file({
        file: "b.jsonl",
        entries: [
          entry({
            ts: localNoon(1),
            usage: { input: 20, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 20 },
            provider: "p",
            model: "m",
          }),
        ],
      }),
    ];
    const report = aggregateUsage(files, null, now);
    expect(report.totals.sessions).toBe(2);
    expect(report.byModel).toHaveLength(1);
    expect(report.byModel[0].sessions).toBe(2);
    expect(report.byModel[0].input).toBe(30);
    // 同日两文件：按日 sessions 为 2
    expect(report.byDay[0].sessions).toBe(2);
  });

  it("byModel 按 totalTokens 降序，未知 provider/model 落 unknown 占位", () => {
    const files: FileUsage[] = [
      file({
        entries: [
          entry({
            ts: localNoon(1),
            usage: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 5 },
            provider: "small",
            model: "s1",
          }),
          entry({
            ts: localNoon(1),
            usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100 },
          }),
        ],
      }),
    ];
    const report = aggregateUsage(files, null, now);
    expect(report.byModel).toHaveLength(2);
    expect(report.byModel[0]).toMatchObject({ provider: "unknown", modelId: "unknown" });
    expect(report.byModel[0].totalTokens).toBe(100);
    expect(report.byModel[1].totalTokens).toBe(5);
  });

  it("since 过滤发生在消息级；跨度短时粒度为 day", () => {
    const files: FileUsage[] = [
      file({
        entries: [
          entry({
            ts: localNoon(1),
            usage: { input: 999, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 999 },
          }),
          entry({
            ts: localNoon(25),
            usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10 },
          }),
        ],
      }),
    ];
    const since = localNoon(20);
    const report = aggregateUsage(files, since, now);
    expect(report.since).toBe(since);
    expect(report.totals.assistantMessages).toBe(1);
    expect(report.totals.input).toBe(10);
    expect(report.granularity).toBe("day");
    expect(report.byDay).toHaveLength(1);
  });

  it("since 过滤后某文件无剩余条目时不计入 sessions", () => {
    const files: FileUsage[] = [
      file({
        file: "old.jsonl",
        entries: [
          entry({
            ts: localNoon(1),
            usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1 },
          }),
        ],
      }),
      file({
        file: "new.jsonl",
        entries: [
          entry({
            ts: localNoon(25),
            usage: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          }),
        ],
      }),
    ];
    const report = aggregateUsage(files, localNoon(20), now);
    expect(report.totals.sessions).toBe(1);
  });

  it("「全部」档跨度超过 90 天时按月分桶", () => {
    const files: FileUsage[] = [
      file({
        entries: [
          entry({
            ts: new Date(2025, 0, 15, 12).getTime(),
            usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10 },
          }),
          entry({
            ts: new Date(2026, 8, 10, 12).getTime(),
            usage: { input: 20, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 20 },
          }),
        ],
      }),
    ];
    const report = aggregateUsage(files, null, now);
    expect(report.granularity).toBe("month");
    expect(report.byDay.map((slice) => slice.key)).toEqual(["2025-01", "2026-09"]);
  });

  it("granularity 覆盖优先于跨度自动选择（热力图全年按天）", () => {
    const files: FileUsage[] = [
      file({
        entries: [
          entry({
            ts: new Date(2025, 0, 15, 12).getTime(),
            usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10 },
          }),
          entry({
            ts: new Date(2026, 8, 10, 12).getTime(),
            usage: { input: 20, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 20 },
          }),
        ],
      }),
    ];
    const report = aggregateUsage(files, null, now, { granularity: "day" });
    expect(report.granularity).toBe("day");
    expect(report.byDay.map((slice) => slice.key)).toEqual(["2025-01-15", "2026-09-10"]);
  });

  it("cost 独立求和，缺失 cost 不影响 token 汇总", () => {
    const files: FileUsage[] = [
      file({
        entries: [
          entry({
            ts: localNoon(1),
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              cost: { input: 0.5, output: 0.5, cacheRead: 0, cacheWrite: 0, total: 1 },
            },
          }),
          entry({
            ts: localNoon(1),
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          }),
        ],
      }),
    ];
    const report = aggregateUsage(files, null, now);
    expect(report.totals.cost).toBe(1);
    expect(report.totals.totalTokens).toBe(4);
    expect(report.byDay[0].cost).toBe(1);
  });
});

describe("aggregateUsage 项目维度", () => {
  const now = localNoon(30);

  it("按 cwd 归属分组，按 totalTokens 降序，sessions 计文件数", () => {
    const other: UsageProject = { key: "E:\\work\\pi", cwd: "E:\\work\\pi", name: "pi" };
    const files: FileUsage[] = [
      file({
        file: "a.jsonl",
        entries: [
          entry({
            ts: localNoon(1),
            usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11 },
          }),
        ],
      }),
      file({
        file: "b.jsonl",
        entries: [
          entry({
            ts: localNoon(2),
            usage: { input: 100, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 102 },
          }),
        ],
      }),
      file({
        file: "c.jsonl",
        project: other,
        entries: [
          entry({
            ts: localNoon(1),
            usage: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 5 },
          }),
          entry({
            ts: localNoon(2),
            usage: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 5 },
          }),
        ],
      }),
    ];
    const report = aggregateUsage(files, null, now);
    expect(report.byProject).toHaveLength(2);
    expect(report.byProject[0]).toMatchObject({ key: "D:\\Code\\demo", name: "demo", sessions: 2 });
    expect(report.byProject[0].totalTokens).toBe(113);
    expect(report.byProject[1]).toMatchObject({ key: "E:\\work\\pi", name: "pi", sessions: 1 });
    expect(report.byProject[1].totalTokens).toBe(10);
  });

  it("cwd 缺失时按会话目录名兜底分组，展示名去掉 -- 包装", () => {
    const legacy: UsageProject = resolveUsageProject(null, "--D--Code-legacy-proj--");
    expect(legacy).toEqual({
      key: "dir:--D--Code-legacy-proj--",
      cwd: null,
      name: "D--Code-legacy-proj",
    });
    const files: FileUsage[] = [
      file({
        project: legacy,
        entries: [
          entry({
            ts: localNoon(1),
            usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10 },
          }),
        ],
      }),
    ];
    const report = aggregateUsage(files, null, now);
    expect(report.byProject[0]).toMatchObject({
      cwd: null,
      name: "D--Code-legacy-proj",
      sessions: 1,
    });
  });

  it("project 过滤发生在文件级，totals 只含该项目", () => {
    const other: UsageProject = { key: "E:\\work\\pi", cwd: "E:\\work\\pi", name: "pi" };
    const files: FileUsage[] = [
      file({
        entries: [
          entry({
            ts: localNoon(1),
            usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10 },
          }),
        ],
      }),
      file({
        file: "c.jsonl",
        project: other,
        entries: [
          entry({
            ts: localNoon(1),
            usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100 },
          }),
        ],
      }),
    ];
    const report = aggregateUsage(files, null, now, { project: "E:\\work\\pi" });
    expect(report.totals.totalTokens).toBe(100);
    expect(report.totals.sessions).toBe(1);
    expect(report.byProject).toHaveLength(1);
    expect(report.byProject[0].name).toBe("pi");
    // 未匹配任何项目时返回全零报表
    const empty = aggregateUsage(files, null, now, { project: "nope" });
    expect(empty.totals.totalTokens).toBe(0);
    expect(empty.byProject).toEqual([]);
  });
});

describe("resolveUsageProject", () => {
  it("cwd 存在时以 cwd 为准，展示名取路径末段（兼容 / 与 \\）", () => {
    expect(resolveUsageProject("D:\\Code\\PI\\pidesk", "--D--Code-PI-pidesk--")).toEqual({
      key: "D:\\Code\\PI\\pidesk",
      cwd: "D:\\Code\\PI\\pidesk",
      name: "pidesk",
    });
    expect(resolveUsageProject("/home/user/proj/", "--home-user-proj--").name).toBe("proj");
  });

  it("cwd 非字符串或为空时按目录名兜底", () => {
    expect(resolveUsageProject(undefined, "--x--")).toEqual({
      key: "dir:--x--",
      cwd: null,
      name: "x",
    });
    expect(resolveUsageProject("", "--y--").name).toBe("y");
  });
});

describe("热力图色阶", () => {
  it("活跃日 ≥4 时按四分位分档", () => {
    // 1..8 的四分位（线性插值）：q1=2.75 q2=4.5 q3=6.25
    const scale = computeUsageHeatScale([8, 1, 3, 2, 7, 4, 5, 6]);
    expect(scale).not.toBeNull();
    expect(usageHeatLevel(scale, 1)).toBe(1);
    expect(usageHeatLevel(scale, 2.75)).toBe(1);
    expect(usageHeatLevel(scale, 3)).toBe(2);
    expect(usageHeatLevel(scale, 4.5)).toBe(2);
    expect(usageHeatLevel(scale, 5)).toBe(3);
    expect(usageHeatLevel(scale, 6.25)).toBe(3);
    expect(usageHeatLevel(scale, 7)).toBe(4);
  });

  it("样本不足 4 个时按最大值线性四等分", () => {
    const scale = computeUsageHeatScale([100, 50]);
    expect(scale).toEqual({ thresholds: [25, 50, 75] });
    expect(usageHeatLevel(scale, 25)).toBe(1);
    expect(usageHeatLevel(scale, 26)).toBe(2);
    expect(usageHeatLevel(scale, 76)).toBe(4);
  });

  it("无活跃日返回 null，任意值落空档；0 与非法值同为空档", () => {
    expect(computeUsageHeatScale([0, -1])).toBeNull();
    const scale = computeUsageHeatScale([10]);
    expect(usageHeatLevel(null, 100)).toBe(0);
    expect(usageHeatLevel(scale, 0)).toBe(0);
    expect(usageHeatLevel(scale, Number.NaN)).toBe(0);
    expect(usageHeatLevel(scale, 1)).toBe(1);
    expect(usageHeatLevel(scale, 11)).toBe(4);
  });
});
