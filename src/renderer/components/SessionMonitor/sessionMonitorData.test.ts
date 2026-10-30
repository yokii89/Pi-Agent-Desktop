import { describe, expect, it } from "vitest";
import type { PiSlashCommand, SessionSummary } from "../../../shared/ipc";
import type { SessionEntry } from "../../stores/sessionTranscript";
import {
  collectSources,
  editsFromWorkingTree,
  lastAssistantText,
  sessionUpdatedAt,
  shortenUrl,
  skillNames,
} from "./sessionMonitorData";

function assistant(text: string): SessionEntry {
  return {
    kind: "assistant",
    id: `a-${text}`,
    blocks: [{ kind: "text", text, contentIndex: 0 }],
  };
}

function notice(text: string, at: number): SessionEntry {
  return { kind: "notice", id: `n-${at}`, text, at };
}

describe("lastAssistantText", () => {
  it("取最后一条含正文的 assistant，并把换行折成单段", () => {
    const entries: SessionEntry[] = [assistant("第一段"), assistant("第二段\n又一行")];
    expect(lastAssistantText(entries)).toBe("第二段 又一行");
  });

  it("忽略没有正文的 assistant（纯工具调用轮）", () => {
    const toolOnly: SessionEntry = {
      kind: "assistant",
      id: "tool-only",
      blocks: [
        {
          kind: "tool",
          toolCallId: "t1",
          name: "read",
          toolKind: "read",
          action: "已读取",
          subject: "a.ts",
          argsText: "{}",
          args: {},
          status: "ok",
          result: null,
          resultText: null,
          startedAt: null,
          endedAt: null,
          durationMs: null,
          contentIndex: 0,
        },
      ],
    };
    expect(lastAssistantText([assistant("有正文"), toolOnly])).toBe("有正文");
  });

  it("没有 assistant 时返回 null", () => {
    expect(lastAssistantText([notice("提示", 1)])).toBeNull();
  });
});

describe("editsFromWorkingTree", () => {
  it("原样透传工作区汇总（全项目未提交改动，不是本轮差集）", () => {
    expect(editsFromWorkingTree({ files: 7, additions: 123, deletions: 45 })).toEqual({
      files: 7,
      additions: 123,
      deletions: 45,
    });
  });

  it("工作区干净（0 个文件）返回 null", () => {
    expect(editsFromWorkingTree({ files: 0, additions: 0, deletions: 0 })).toBeNull();
  });

  it("二进制改动只有文件数、没有增删行时仍算有改动", () => {
    expect(editsFromWorkingTree({ files: 1, additions: 0, deletions: 0 })).toEqual({
      files: 1,
      additions: 0,
      deletions: 0,
    });
  });
});

describe("sessionUpdatedAt", () => {
  const summaries: SessionSummary[] = [
    {
      file: "C:/s/a.jsonl",
      id: "a",
      startedAt: 1,
      updatedAt: 99,
      firstUserMessage: null,
      sessionName: null,
      cwd: null,
    },
  ];

  it("优先取会话摘要的 updatedAt", () => {
    expect(sessionUpdatedAt(summaries, "C:/s/a.jsonl", [notice("x", 5)])).toBe(99);
  });

  it("会话尚未落盘时回退到条目时间", () => {
    expect(sessionUpdatedAt(summaries, null, [notice("x", 5)])).toBe(5);
  });

  it("什么都没有时返回 null", () => {
    expect(sessionUpdatedAt([], null, [])).toBeNull();
  });
});

describe("collectSources", () => {
  it("图片与浏览器元素混排，新的在前，按上限截断", () => {
    const entries: SessionEntry[] = [
      { kind: "user", id: "u1", text: "看图", images: [{ src: "data:", mimeType: "image/png" }] },
      {
        kind: "user",
        id: "u2",
        text: "元素",
        items: [
          {
            id: "el1",
            kind: "element",
            url: "http://localhost:5173",
            at: 1,
            tag: "button",
            selector: "button.primary",
            label: "提交",
            outerHTML: "",
            textSummary: "",
            a11y: null,
            rect: null,
            viewport: { width: 0, height: 0 },
            styles: "",
            screenshot: null,
            attached: false,
            stale: false,
          },
        ],
      },
    ];
    const sources = collectSources(entries, 2);
    expect(sources.map((source) => source.label)).toEqual(["提交", "image.png"]);
    expect(sources[0].kind).toBe("element");
    expect(sources[1].kind).toBe("image");
  });

  it("没有附件时返回空数组", () => {
    expect(collectSources([assistant("hi")])).toEqual([]);
  });
});

describe("skillNames", () => {
  it("只保留 skill 来源，忽略扩展命令与提示模板，并剥掉 skill: 前缀", () => {
    const commands: PiSlashCommand[] = [
      { name: "skill:pidesk-dev-startup", source: "skill" },
      { name: "review", source: "prompt" },
      { name: "deploy", source: "extension" },
    ];
    expect(skillNames(commands)).toEqual(["pidesk-dev-startup"]);
  });

  it("缓存未命中时返回空数组", () => {
    expect(skillNames(null)).toEqual([]);
  });
});

describe("网址短语", () => {
  it("shortenUrl 去掉协议与尾斜杠，超长尾部截断", () => {
    expect(shortenUrl("http://localhost:5173/")).toBe("localhost:5173");
    expect(shortenUrl("https://example.com/a/very/long/path/that/keeps/going", 16)).toBe(
      "example.com/a/v…",
    );
  });
});
