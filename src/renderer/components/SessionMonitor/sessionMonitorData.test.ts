import { describe, expect, it } from "vitest";
import type { PiNestedToolCall, PiSlashCommand, SessionSummary } from "../../../shared/ipc";
import type { SessionEntry, ToolAssistantBlock } from "../../stores/sessionTranscript";
import {
  collectCapabilityUsage,
  collectSources,
  editsFromWorkingTree,
  lastAssistantText,
  parseSkillInvocation,
  sessionUpdatedAt,
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

describe("parseSkillInvocation", () => {
  it("识别 pi 展开后的 <skill> 块并取 name", () => {
    const expanded =
      '<skill name="cloudflare" location="C:\\Users\\me\\.pi\\agent\\skills\\cloudflare\\SKILL.md">\nReferences are relative to C:\\Users\\me\\.pi\\agent\\skills\\cloudflare.\n\n正文\n</skill>\n\n顺便看下文档';
    expect(parseSkillInvocation(expanded)).toEqual({ name: "cloudflare", expanded: true });
  });

  it("识别输入栏原样发出的 /skill: 命令（带参数）", () => {
    expect(parseSkillInvocation("/skill:web-perf 首页慢")).toEqual({
      name: "web-perf",
      expanded: false,
    });
    expect(parseSkillInvocation("/skill:web-perf")).toEqual({
      name: "web-perf",
      expanded: false,
    });
  });

  it("不在开头、普通正文都不算；名字里带换行/制表符对齐 pi 的「按空格切」", () => {
    expect(parseSkillInvocation("帮我看看 /skill:web-perf")).toBeNull();
    expect(parseSkillInvocation("/skill:web-perf,继续")).toEqual({
      name: "web-perf,继续",
      expanded: false,
    });
    expect(parseSkillInvocation("/skill:web-perf\n继续")).toBeNull();
    expect(parseSkillInvocation("/skill:web-perf\t继续")).toBeNull();
    expect(parseSkillInvocation("普通消息")).toBeNull();
    expect(parseSkillInvocation("")).toBeNull();
  });
});

describe("collectCapabilityUsage", () => {
  const CATALOG: PiSlashCommand[] = [
    {
      name: "skill:cloudflare",
      source: "skill",
      filePath: "C:\\Users\\me\\.pi\\agent\\skills\\cloudflare\\SKILL.md",
    },
    // 旧缓存没有 filePath：按目录名兜底
    { name: "skill:web-perf", source: "skill" },
    { name: "review", source: "prompt" },
  ];

  let seq = 0;
  function toolEntry(
    name: string,
    toolKind: ToolAssistantBlock["toolKind"],
    options: { path?: string; nested?: PiNestedToolCall[] } = {},
  ): SessionEntry {
    seq += 1;
    const block: ToolAssistantBlock = {
      kind: "tool",
      toolCallId: `call-${seq}`,
      name,
      toolKind,
      action: "",
      subject: options.path ?? "",
      argsText: "",
      args: options.path ? { path: options.path } : {},
      status: "ok",
      result: null,
      resultText: null,
      startedAt: null,
      endedAt: null,
      durationMs: null,
      contentIndex: 0,
      ...(options.nested ? { nestedCalls: options.nested } : {}),
    };
    return { kind: "assistant", id: `a-${seq}`, blocks: [block] };
  }

  function userEntry(text: string): SessionEntry {
    seq += 1;
    return { kind: "user", id: `u-${seq}`, text };
  }

  it("技能命令与模型读取分别计数，并按总数排序", () => {
    const usage = collectCapabilityUsage(
      [
        userEntry("/skill:cloudflare 查下文档"),
        userEntry("/skill:cloudflare 再看一次"),
        toolEntry("read", "read", {
          path: "c:/users/me/.pi/agent/skills/cloudflare/SKILL.md",
        }),
        toolEntry("read", "read", { path: "D:/pi/skills/web-perf/SKILL.md" }),
      ],
      CATALOG,
    );
    expect(usage.skills).toEqual([
      { name: "cloudflare", commands: 2, reads: 1 },
      { name: "web-perf", commands: 0, reads: 1 },
    ]);
  });

  it("未登记的 SKILL.md 读取不算技能调用", () => {
    const usage = collectCapabilityUsage(
      [toolEntry("read", "read", { path: "D:/work/random/SKILL.md" })],
      CATALOG,
    );
    expect(usage.skills).toEqual([]);
  });

  it("没有目录时用户命令仍计数（读取无法识别）", () => {
    const usage = collectCapabilityUsage(
      [
        userEntry("/skill:cloudflare"),
        toolEntry("read", "read", {
          path: "C:/Users/me/.pi/agent/skills/cloudflare/SKILL.md",
        }),
      ],
      null,
    );
    expect(usage.skills).toEqual([{ name: "cloudflare", commands: 1, reads: 0 }]);
  });

  it("目录已加载但没有该技能：原文 /skill: 不计，pi 展开块仍计", () => {
    const usage = collectCapabilityUsage(
      [
        userEntry("/skill:not-a-real-skill 试试"),
        userEntry('<skill name="ghost" location="D:/x/SKILL.md">\n正文\n</skill>'),
      ],
      CATALOG,
    );
    // ghost 不在目录里，但块只有 pi 真的展开才会出现，说明它当时确实存在
    expect(usage.skills).toEqual([{ name: "ghost", commands: 1, reads: 0 }]);
  });

  it("带浏览器上下文的消息不把原文 /skill: 当成调用（pi 收到的不是命令开头）", () => {
    const entry: SessionEntry = {
      kind: "user",
      id: "u-items",
      text: "/skill:cloudflare 看下这个按钮",
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
    };
    expect(collectCapabilityUsage([entry], CATALOG).skills).toEqual([]);
  });

  it("独立 .md 技能（文件名不是 SKILL.md）按精确路径识别", () => {
    const commands: PiSlashCommand[] = [
      { name: "skill:release-notes", source: "skill", filePath: "D:/pi/skills/release-notes.md" },
    ];
    const usage = collectCapabilityUsage(
      [toolEntry("read", "read", { path: "d:/pi/skills/release-notes.md" })],
      commands,
    );
    expect(usage.skills).toEqual([{ name: "release-notes", commands: 0, reads: 1 }]);
  });

  it("MCP 直接调用按 server 汇总、按工具拆分", () => {
    const usage = collectCapabilityUsage(
      [
        toolEntry("mcp__filesystem__read_file", "mcp"),
        toolEntry("mcp__filesystem__list_directory", "mcp"),
        toolEntry("mcp__filesystem__read_file", "mcp"),
        toolEntry("mcp__deepwiki__read_wiki", "mcp"),
      ],
      CATALOG,
    );
    expect(usage.mcp).toEqual([
      {
        server: "filesystem",
        count: 3,
        tools: [
          { tool: "read_file", count: 2 },
          { tool: "list_directory", count: 1 },
        ],
      },
      { server: "deepwiki", count: 1, tools: [{ tool: "read_wiki", count: 1 }] },
    ]);
  });

  it("codemode 的嵌套 MCP 调用计入，非 MCP 嵌套调用忽略", () => {
    const usage = collectCapabilityUsage(
      [
        toolEntry("codemode", "generic", {
          nested: [
            { name: "mcp__filesystem__list_directory", status: "ok" },
            { name: "mcp__filesystem__list_directory", status: "error" },
            { name: "read", status: "ok" },
          ],
        }),
      ],
      CATALOG,
    );
    expect(usage.mcp).toEqual([
      { server: "filesystem", count: 2, tools: [{ tool: "list_directory", count: 2 }] },
    ]);
    expect(usage.skills).toEqual([]);
  });

  it("没有调用时返回空数组（卡上不显示可用量）", () => {
    expect(collectCapabilityUsage([assistant("普通回答")], CATALOG)).toEqual({
      skills: [],
      mcp: [],
    });
  });
});
