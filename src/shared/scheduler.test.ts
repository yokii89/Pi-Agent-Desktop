import { describe, expect, it } from "vitest";
import {
  countMissedOccurrences,
  formatHHMM,
  isAbsolutePath,
  nextRunAfter,
  normalizeScheduleRule,
  parseHHMM,
  type ScheduleRule,
  sanitizeSchedulerTaskInput,
} from "./scheduler";

/** 用本地时区构造毫秒时刻，测试与运行机器的时区无关。 */
function at(y: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return new Date(y, month - 1, day, hour, minute, second, 0).getTime();
}

describe("parseHHMM", () => {
  it("接受合法时刻并补全语义", () => {
    expect(parseHHMM("09:30")).toEqual({ hour: 9, minute: 30 });
    expect(parseHHMM("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseHHMM(" 0:05 ")).toEqual({ hour: 0, minute: 5 });
  });

  it("拒绝越界与残缺输入", () => {
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("12:60")).toBeNull();
    expect(parseHHMM("9:5")).toBeNull();
    expect(parseHHMM("")).toBeNull();
    expect(parseHHMM("abc")).toBeNull();
  });

  it("formatHHMM 输出两位段", () => {
    expect(formatHHMM(9, 5)).toBe("09:05");
  });
});

describe("nextRunAfter · interval", () => {
  const rule: ScheduleRule = { kind: "interval", minutes: 30 };
  const anchor = at(2026, 9, 26, 8, 0);

  it("锚点整除推进，严格大于 after", () => {
    // 锚点 8:00，30 分钟一格：9:10 的下一格是 9:30
    expect(nextRunAfter(rule, at(2026, 9, 26, 9, 10), anchor)).toBe(at(2026, 9, 26, 9, 30));
  });

  it("恰好落在格点上时取下一格", () => {
    expect(nextRunAfter(rule, at(2026, 9, 26, 9, 30), anchor)).toBe(at(2026, 9, 26, 10, 0));
  });

  it("after 早于锚点时返回锚点（首个计划点）", () => {
    expect(nextRunAfter(rule, at(2026, 9, 26, 7, 0), anchor)).toBe(anchor);
  });
});

describe("nextRunAfter · daily", () => {
  it("同日未到取今天", () => {
    const rule: ScheduleRule = { kind: "daily", time: "09:30", weekdays: null };
    expect(nextRunAfter(rule, at(2026, 9, 26, 8, 0), 0)).toBe(at(2026, 9, 26, 9, 30));
  });

  it("同日已过取明天", () => {
    const rule: ScheduleRule = { kind: "daily", time: "09:30", weekdays: null };
    expect(nextRunAfter(rule, at(2026, 9, 26, 9, 30), 0)).toBe(at(2026, 9, 27, 9, 30));
  });

  it("工作日过滤：周六跳到周一（2026-09-26 是周六）", () => {
    const rule: ScheduleRule = { kind: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] };
    const next = nextRunAfter(rule, at(2026, 9, 26, 12, 0), 0);
    expect(next).toBe(at(2026, 9, 28, 9, 0));
  });

  it("周日全天不命中的工作日规则跳 7 天内循环", () => {
    const rule: ScheduleRule = { kind: "daily", time: "23:00", weekdays: [1] };
    // 2026-09-27 周日 23:30 → 下一格是 9-28 周一 23:00
    expect(nextRunAfter(rule, at(2026, 9, 27, 23, 30), 0)).toBe(at(2026, 9, 28, 23, 0));
  });
});

describe("nextRunAfter · once", () => {
  const target = at(2026, 10, 1, 9, 0);

  it("未来时刻原样返回", () => {
    expect(nextRunAfter({ kind: "once", at: target }, at(2026, 9, 26, 8, 0), 0)).toBe(target);
  });

  it("已过时刻返回 null", () => {
    expect(nextRunAfter({ kind: "once", at: target }, at(2026, 10, 1, 9, 0), 0)).toBeNull();
  });
});

describe("countMissedOccurrences", () => {
  it("区间 [from, to) 内的间隔点逐个计入", () => {
    const rule: ScheduleRule = { kind: "interval", minutes: 10 };
    const anchor = at(2026, 9, 26, 8, 0);
    // 8:00 起每 10 分钟：8:00、8:10、8:20 共 3 个
    expect(countMissedOccurrences(rule, anchor, at(2026, 9, 26, 8, 25), anchor)).toBe(3);
  });

  it("to 恰在计划点上时不计入（半开区间）", () => {
    const rule: ScheduleRule = { kind: "interval", minutes: 10 };
    const anchor = at(2026, 9, 26, 8, 0);
    expect(countMissedOccurrences(rule, anchor, at(2026, 9, 26, 8, 20), anchor)).toBe(2);
  });

  it("daily 跨天计数", () => {
    const rule: ScheduleRule = { kind: "daily", time: "09:00", weekdays: null };
    const missed = countMissedOccurrences(rule, at(2026, 9, 24, 9, 0), at(2026, 9, 27, 10, 0), 0);
    // 24 / 25 / 26 / 27 四天的 9:00
    expect(missed).toBe(4);
  });

  it("once 只算区间内的那一个点", () => {
    const target = at(2026, 10, 1, 9, 0);
    expect(countMissedOccurrences({ kind: "once", at: target }, target - 1, target + 1, 0)).toBe(1);
    expect(countMissedOccurrences({ kind: "once", at: target }, target + 1, target + 2, 0)).toBe(0);
  });

  it("空区间返回 0", () => {
    expect(
      countMissedOccurrences(
        { kind: "interval", minutes: 10 },
        at(2026, 9, 26, 9, 0),
        at(2026, 9, 26, 9, 0),
        0,
      ),
    ).toBe(0);
  });
});

describe("normalizeScheduleRule", () => {
  it("间隔分钟取整并拒绝越界", () => {
    expect(normalizeScheduleRule({ kind: "interval", minutes: 15.9 })).toEqual({
      kind: "interval",
      minutes: 15,
    });
    expect(() => normalizeScheduleRule({ kind: "interval", minutes: 0 })).toThrow();
    expect(() => normalizeScheduleRule({ kind: "interval", minutes: 999999 })).toThrow();
    // NaN 与任何数值比较均为 false，必须显式拒绝
    expect(() => normalizeScheduleRule({ kind: "interval", minutes: Number.NaN })).toThrow();
  });

  it("daily 拒绝非法时间与空周几", () => {
    expect(() => normalizeScheduleRule({ kind: "daily", time: "9:0", weekdays: null })).toThrow();
    expect(() => normalizeScheduleRule({ kind: "daily", time: "09:00", weekdays: [] })).toThrow();
    expect(normalizeScheduleRule({ kind: "daily", time: "08:05", weekdays: [6, 0] })).toEqual({
      kind: "daily",
      time: "08:05",
      weekdays: [0, 6],
    });
  });

  it("once 拒绝非正数", () => {
    expect(() => normalizeScheduleRule({ kind: "once", at: 0 })).toThrow();
    expect(normalizeScheduleRule({ kind: "once", at: 123 })).toEqual({ kind: "once", at: 123 });
  });

  it("未知 kind 抛错", () => {
    expect(() => normalizeScheduleRule({ kind: "cron" })).toThrow();
  });
});

describe("sanitizeSchedulerTaskInput", () => {
  const valid = {
    name: "  巡检  ",
    prompt: "  检查依赖更新  ",
    cwd: "D:\\Code\\PI",
    sessionFile: null,
    rule: { kind: "interval", minutes: 60 },
  };

  it("裁剪空白并通过", () => {
    const out = sanitizeSchedulerTaskInput(valid);
    expect(out.name).toBe("巡检");
    expect(out.prompt).toBe("检查依赖更新");
  });

  it("enabled 缺省时不兜底（编辑停用任务不得被隐式重新启用）", () => {
    expect(sanitizeSchedulerTaskInput(valid).enabled).toBeUndefined();
    expect(sanitizeSchedulerTaskInput({ ...valid, enabled: false }).enabled).toBe(false);
  });

  it("拒绝空名称 / 空 prompt / 相对路径 cwd", () => {
    expect(() => sanitizeSchedulerTaskInput({ ...valid, name: "  " })).toThrow();
    expect(() => sanitizeSchedulerTaskInput({ ...valid, prompt: "" })).toThrow();
    expect(() => sanitizeSchedulerTaskInput({ ...valid, cwd: "relative/path" })).toThrow();
  });

  it("sessionFile 必须是绝对路径或 null", () => {
    expect(() => sanitizeSchedulerTaskInput({ ...valid, sessionFile: "x.jsonl" })).toThrow();
    expect(
      sanitizeSchedulerTaskInput({ ...valid, sessionFile: "D:\\tmp\\a.jsonl" }).sessionFile,
    ).toBe("D:\\tmp\\a.jsonl");
  });
});

describe("isAbsolutePath", () => {
  it("识别 Windows 盘符 / UNC / POSIX 根", () => {
    expect(isAbsolutePath("D:\\a\\b")).toBe(true);
    expect(isAbsolutePath("D:/a/b")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share")).toBe(true);
    expect(isAbsolutePath("/home/u")).toBe(true);
    expect(isAbsolutePath("a/b")).toBe(false);
  });
});
