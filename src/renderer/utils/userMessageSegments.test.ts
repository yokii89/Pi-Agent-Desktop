import { describe, expect, it } from "vitest";
import { formatFileMentionPrompt, type PositionedFileMention } from "./fileMentionFormat";
import { buildPageContext } from "./pageContext";
import {
  parseUserMessageSegments,
  readableUserMessage,
  readableUserMessageWithImages,
} from "./userMessageSegments";

describe("parseUserMessageSegments", () => {
  it("plain text stays a single text segment", () => {
    expect(parseUserMessageSegments("帮我写个函数")).toEqual([
      { kind: "text", content: "帮我写个函数" },
    ]);
  });

  it("extracts the plan-mode prefix line", () => {
    const text = "【计划模式】先给出实现计划，经确认后再修改文件。\n\n重构登录模块";
    expect(parseUserMessageSegments(text)).toEqual([
      { kind: "plan", content: "先给出实现计划，经确认后再修改文件。" },
      { kind: "text", content: "重构登录模块" },
    ]);
  });

  it("extracts trailing path note", () => {
    const text = "看一下这两个文件\n\n引用路径：\n- D:/proj/a.ts\n- D:/proj/b.ts";
    expect(parseUserMessageSegments(text)).toEqual([
      { kind: "text", content: "看一下这两个文件" },
      {
        kind: "files",
        content: "",
        parts: [
          { kind: "file", mention: { path: "D:/proj/a.ts", displayPath: "a.ts", kind: undefined } },
          { kind: "file", mention: { path: "D:/proj/b.ts", displayPath: "b.ts", kind: undefined } },
        ],
      },
    ]);
  });

  it("splits a quote block in the middle (docs/design/12 引用动线)", () => {
    const text = '这段报错是什么意思\n> import { foo } from "bar"\n> \n另外帮我看看 lint';
    expect(parseUserMessageSegments(text)).toEqual([
      { kind: "text", content: "这段报错是什么意思" },
      { kind: "quote", content: 'import { foo } from "bar"\n' },
      { kind: "text", content: "另外帮我看看 lint" },
    ]);
  });

  it("combines plan prefix, quote and path note", () => {
    const text = [
      "【计划模式】先给出实现计划，经确认后再修改文件。",
      "",
      "> 旧实现太绕",
      "",
      "按引用重构",
      "",
      "引用路径：",
      "- src/a.ts",
    ].join("\n");
    expect(parseUserMessageSegments(text)).toEqual([
      { kind: "plan", content: "先给出实现计划，经确认后再修改文件。" },
      { kind: "quote", content: "旧实现太绕" },
      { kind: "text", content: "按引用重构" },
      {
        kind: "files",
        content: "",
        parts: [
          { kind: "file", mention: { path: "src/a.ts", displayPath: "a.ts", kind: undefined } },
        ],
      },
    ]);
  });

  it("keeps internal blank lines within a text segment", () => {
    expect(parseUserMessageSegments("第一段\n\n第二段")).toEqual([
      { kind: "text", content: "第一段\n\n第二段" },
    ]);
  });

  it("does not treat 引用路径 mid-text as trailing note", () => {
    const text = "引用路径：\n- a.ts\n然后继续";
    expect(parseUserMessageSegments(text)).toEqual([
      { kind: "text", content: "引用路径：\n- a.ts\n然后继续" },
    ]);
  });

  it("handles empty text", () => {
    expect(parseUserMessageSegments("")).toEqual([]);
  });

  it("restores legacy Windows paths inline without a second path list", () => {
    const segments = parseUserMessageSegments(
      "检查 @src/a.ts 和 @docs/my file.md\r\n\r\n引用路径：\r\n- D:\\proj\\src\\a.ts\r\n- D:\\proj\\docs\\my file.md\r\n",
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].parts?.filter((part) => part.kind === "file")).toHaveLength(2);
    expect(readableUserMessage(segments)).toBe("检查 @a.ts 和 @my file.md");
  });

  it("does not turn hand-typed mentions into chips without attachment evidence", () => {
    expect(parseUserMessageSegments("检查 @a.ts @someone")).toEqual([
      { kind: "text", content: "检查 @a.ts @someone" },
    ]);
  });

  it("does not confuse prefix paths or ambiguous basenames in old messages", () => {
    const segments = parseUserMessageSegments(
      "@a.tsx @a.ts\n\n引用路径：\n- D:/one/a.ts\n- D:/two/a.ts",
    );
    expect(segments[0]).toEqual({ kind: "text", content: "@a.tsx @a.ts" });
    expect(segments[1].parts).toHaveLength(2);
  });

  it("uses the longest matching legacy path and deduplicates path notes", () => {
    const segments = parseUserMessageSegments(
      "@src/a.ts\n\n引用路径：\n- D:/src/a.ts\n- D:/a.ts\n- D:/src/a.ts",
    );
    expect(segments[0].parts?.[0]).toMatchObject({
      kind: "file",
      mention: { path: "D:/src/a.ts" },
    });
    expect(segments[1].parts).toHaveLength(1);
  });

  it("copies quotes but excludes the historical plan instruction and machine notes", () => {
    const text = "【计划模式】机器指令\n\n> 引用\n> 下一行\n\n看看\n\n引用路径：\n- D:/a.ts";
    expect(readableUserMessage(parseUserMessageSegments(text))).toBe(
      "> 引用\n> 下一行\n\n看看\n\n@a.ts",
    );
  });
});

describe("file mention round trips", () => {
  const file: PositionedFileMention = {
    path: "D:\\项目\\src\\a.ts",
    displayPath: "src/a.ts",
    kind: "file",
    offset: 0,
  };
  const files = (text: string) =>
    parseUserMessageSegments(text).flatMap(
      (segment) =>
        segment.parts?.flatMap((part) => (part.kind === "file" ? [part.mention] : [])) ?? [],
    );

  it("keeps only actual chip positions, including adjacent text and identical manual tokens", () => {
    const text = "  手打 @src/a.ts 然后@src/a.ts继续  ";
    const prompt = formatFileMentionPrompt(text, [{ ...file, offset: text.lastIndexOf("@") }]);
    expect(files(prompt)).toHaveLength(1);
    expect(readableUserMessage(parseUserMessageSegments(prompt))).toBe(
      "手打 @src/a.ts 然后@a.ts继续",
    );
    expect(prompt).toContain("引用路径：\n- D:\\项目\\src\\a.ts");
  });

  it("preserves same-name files, directories, spaces, Unicode and chip order", () => {
    const text = "@src/a.ts @test/a.ts @文 档";
    const prompt = formatFileMentionPrompt(text, [
      file,
      { ...file, path: "D:\\项目\\test\\a.ts", displayPath: "test/a.ts", offset: 10 },
      { path: "D:\\项目\\文 档", displayPath: "文 档", kind: "dir", offset: 21 },
    ]);
    expect(files(prompt).map((mention) => mention.kind)).toEqual(["file", "file", "dir"]);
    expect(readableUserMessage(parseUserMessageSegments(prompt))).toBe("@a.ts @a.ts @文 档");
  });

  it("supports reference-only messages", () => {
    const prompt = formatFileMentionPrompt("@src/a.ts ", [file]);
    expect(files(prompt)).toEqual([file]);
    expect(readableUserMessage(parseUserMessageSegments(prompt))).toBe("@a.ts");
  });

  it("appends strip file attachments as trailing path-only chips (docs/design/25)", () => {
    const prompt = formatFileMentionPrompt("看看这个", [], ["D:/proj/spec.md"]);
    expect(prompt).toBe("看看这个\n\n引用路径：\n- D:/proj/spec.md");
    const segments = parseUserMessageSegments(prompt);
    expect(segments.map((segment) => segment.kind)).toEqual(["text", "files"]);
    expect(readableUserMessage(segments)).toBe("看看这个\n\n@spec.md");
  });

  it("allows empty body with only file attachments and merges unique paths", () => {
    const prompt = formatFileMentionPrompt(
      "",
      [],
      ["D:/proj/a.ts", "D:/proj/a.ts", "D:/proj/b.pdf"],
    );
    expect(prompt).toBe("引用路径：\n- D:/proj/a.ts\n- D:/proj/b.pdf");
    const segments = parseUserMessageSegments(prompt);
    expect(segments).toEqual([
      {
        kind: "files",
        content: "",
        parts: [
          {
            kind: "file",
            mention: { path: "D:/proj/a.ts", displayPath: "a.ts", kind: undefined },
          },
          {
            kind: "file",
            mention: { path: "D:/proj/b.pdf", displayPath: "b.pdf", kind: undefined },
          },
        ],
      },
    ]);
  });

  it("restores exact positions and directory kinds after browser context wraps persisted text", () => {
    const text = "手打 @docs 然后 @docs";
    const prompt = formatFileMentionPrompt(text, [
      { path: "D:/project/docs", displayPath: "docs", kind: "dir", offset: text.lastIndexOf("@") },
    ]);
    const history = buildPageContext({ text: prompt, items: [], consoleErrors: [] });
    expect(files(history)).toHaveLength(1);
    expect(files(history)[0].kind).toBe("dir");
    expect(
      parseUserMessageSegments(history)[0]
        .parts?.filter((part) => part.kind === "text")
        .map((part) => part.text)
        .join(""),
    ).toContain("手打 @docs 然后 ");
  });

  it("preserves references within quote lines and following paragraphs", () => {
    const text = "> @src/a.ts\n> 第二行\n\n继续";
    const prompt = formatFileMentionPrompt(text, [{ ...file, offset: 2 }]);
    expect(files(prompt)).toHaveLength(1);
    expect(readableUserMessage(parseUserMessageSegments(prompt))).toBe("> @a.ts\n> 第二行\n\n继续");
  });

  it("falls back safely for corrupt or mismatched metadata", () => {
    const prompt = formatFileMentionPrompt("@src/a.ts", [file]);
    for (const broken of [
      prompt.replace('"offset":0', '"offset":99'),
      prompt.replace('[{"path"', '[broken{"path"'),
    ]) {
      expect(files(broken)).toHaveLength(1);
      expect(readableUserMessage(parseUserMessageSegments(broken))).toBe("@a.ts");
    }
  });

  it("keeps a message without references unchanged", () => {
    expect(formatFileMentionPrompt("  普通文字 @手打  ", [])).toBe("普通文字 @手打");
  });
});

describe("readableUserMessageWithImages", () => {
  it("returns text when present, otherwise an image placeholder", () => {
    const withText = parseUserMessageSegments("看这张图");
    expect(readableUserMessageWithImages(withText, 2)).toBe("看这张图");

    const empty = parseUserMessageSegments("");
    expect(readableUserMessageWithImages(empty, 1)).toBe("[图片]");
    expect(readableUserMessageWithImages(empty, 3)).toBe("[图片 ×3]");
    expect(readableUserMessageWithImages(empty, 0)).toBe("");
  });
});
