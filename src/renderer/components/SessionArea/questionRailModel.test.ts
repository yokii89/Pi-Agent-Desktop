import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../stores/sessionTranscript";
import {
  buildQuestionSegments,
  createQuestionSegmentsSelector,
  pickActiveSegment,
  previewFromText,
  type QuestionRow,
  segmentVisualState,
} from "./questionRailModel";

/** 构造一条用户条目（其余字段用不到）。 */
function user(
  id: string,
  text: string,
  images?: { src: string; mimeType: string }[],
): SessionEntry {
  return { kind: "user", id, text, images: images as never };
}

describe("previewFromText", () => {
  it("压缩段内空白并按空行切段", () => {
    expect(previewFromText("  hello   world \n\n  second   para  ")).toBe(
      "hello world\nsecond para",
    );
  });

  it("只取前 2 段", () => {
    expect(previewFromText("a\n\nb\n\nc\n\nd")).toBe("a\nb");
  });

  it("超过 maxChars 截断并加省略号", () => {
    const text = "x".repeat(50);
    const out = previewFromText(text, 20);
    expect(out.length).toBe(20);
    expect(out.endsWith("...")).toBe(true);
  });

  it("maxChars 有下限 8，不会截成负数", () => {
    expect(previewFromText("abcdefghij", 1)).toBe("abcde...");
  });

  it("空文本返回空串", () => {
    expect(previewFromText("   \n\n  ")).toBe("");
  });
});

describe("buildQuestionSegments", () => {
  it("只取 user 条目，index 为序列内下标", () => {
    const entries: SessionEntry[] = [
      user("u1", "第一个问题"),
      { kind: "run", id: "r1" } as never,
      { kind: "assistant", id: "a1", blocks: [] },
      user("u2", "第二个问题"),
    ];
    const segments = buildQuestionSegments(entries);
    expect(segments.map((s) => s.id)).toEqual(["u1", "u2"]);
    expect(segments.map((s) => s.index)).toEqual([0, 1]);
    expect(segments[0].preview).toBe("第一个问题");
  });

  it("剥离计划模式前缀", () => {
    const segments = buildQuestionSegments([user("u1", "【计划模式】请规划一下\n\n正文内容")]);
    expect(segments[0].preview).not.toContain("计划模式");
    expect(segments[0].preview).toContain("正文内容");
  });

  it("纯图无文回退图片计数文案", () => {
    const one = buildQuestionSegments([user("u1", "", [{ src: "data:", mimeType: "image/png" }])]);
    expect(one[0].preview).toBe("[图片]");
    const many = buildQuestionSegments([
      user("u1", "", [
        { src: "data:", mimeType: "image/png" },
        { src: "data:", mimeType: "image/png" },
      ]),
    ]);
    expect(many[0].preview).toBe("[图片 ×2]");
  });

  it("无用户条目返回空数组", () => {
    expect(buildQuestionSegments([{ kind: "assistant", id: "a1", blocks: [] }])).toEqual([]);
  });
});

describe("createQuestionSegmentsSelector", () => {
  it("助手流式更新和乐观状态确认复用目录引用", () => {
    const select = createQuestionSegmentsSelector();
    const first = user("u1", "正文");
    const initial = select([first], "zh-CN");
    expect(select([{ ...first }, { kind: "assistant", id: "a", blocks: [] }], "zh-CN")).toBe(
      initial,
    );
  });

  it("同长度改文、图片数量、顺序、删除与语言变化均失效", () => {
    const select = createQuestionSegmentsSelector();
    let entries = [user("u1", "甲"), user("u2", "乙")];
    let previous = select(entries, "zh-CN");
    for (const next of [
      [user("u1", "丙"), entries[1]],
      [user("u1", "丙", [{ src: "data:", mimeType: "image/png" }]), entries[1]],
      [entries[1], entries[0]],
      [entries[0]],
      [],
    ]) {
      entries = next;
      const result = select(entries, "zh-CN");
      expect(result).not.toBe(previous);
      expect(result).toEqual(buildQuestionSegments(entries));
      previous = result;
    }
    expect(select(entries, "en-US")).not.toBe(previous);
  });
});

describe("pickActiveSegment", () => {
  const rows: QuestionRow[] = [
    { index: 0, start: 0, end: 100 },
    { index: 1, start: 100, end: 300 },
    { index: 2, start: 300, end: 500 },
  ];

  it("无序、相同起点与等距离候选保留原排序裁决", () => {
    expect(
      pickActiveSegment(
        [
          { index: 7, start: 120, end: 150 },
          { index: 4, start: 80, end: 110 },
          { index: 2, start: 80, end: 110 },
        ],
        100,
        200,
      ),
    ).toBe(2);
    expect(
      pickActiveSegment(
        [
          { index: 2, start: 80, end: 90 },
          { index: 4, start: 80, end: 90 },
        ],
        200,
        50,
      ),
    ).toBe(4);
    expect(
      pickActiveSegment(
        [
          { index: 4, start: 80, end: 90 },
          { index: 2, start: 80, end: 90 },
        ],
        0,
        20,
      ),
    ).toBe(2);
    expect(pickActiveSegment([{ index: 3, start: NaN, end: -1 }], NaN, Infinity)).toBe(3);
  });

  it("空行返回 undefined", () => {
    expect(pickActiveSegment([], 0, 200)).toBeUndefined();
  });

  it("取与视口相交且 start 最接近 scrollTop 的行", () => {
    // 视口 [120, 320]：row1(start100) 与 row2(start300) 相交，row2.start 更接近 120？
    // |100-120|=20 < |300-120|=180 → row1
    expect(pickActiveSegment(rows, 120, 200)).toBe(1);
  });

  it("滚到某行起点即激活该行", () => {
    expect(pickActiveSegment(rows, 300, 200)).toBe(2);
  });

  it("无相交行时退回上方最后一行", () => {
    // 视口远在下方 [1000,1200]，无相交 → 上方最后一行 index 2
    expect(pickActiveSegment(rows, 1000, 200)).toBe(2);
  });

  it("无相交行且在首行之上时退回下方第一行", () => {
    const below: QuestionRow[] = [
      { index: 0, start: 500, end: 600 },
      { index: 1, start: 600, end: 700 },
    ];
    // 视口 [0,100] 在所有行上方，无相交 → 下方第一行 index 0
    expect(pickActiveSegment(below, 0, 100)).toBe(0);
  });
});

describe("segmentVisualState", () => {
  it("无焦点时全部落基线档", () => {
    expect(segmentVisualState(3, undefined)).toEqual({
      scaleX: 1,
      opacity: 0.58,
      focus: false,
    });
  });

  it("按距离分 4 档缩放", () => {
    expect(segmentVisualState(5, 5)).toEqual({
      scaleX: 2.6,
      opacity: 1,
      focus: true,
    });
    expect(segmentVisualState(4, 5)).toEqual({
      scaleX: 1.7,
      opacity: 0.86,
      focus: false,
    });
    expect(segmentVisualState(7, 5)).toEqual({
      scaleX: 1.25,
      opacity: 0.72,
      focus: false,
    });
    expect(segmentVisualState(1, 5)).toEqual({
      scaleX: 1,
      opacity: 0.58,
      focus: false,
    });
  });
});
