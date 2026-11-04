import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../stores/sessionTranscript";
import { buildUserHistory } from "./composerHistory";
import { formatFileMentionPrompt } from "./fileMentionFormat";
import { buildPageContext } from "./pageContext";

function user(text: string): SessionEntry {
  return { kind: "user", id: `u-${text.slice(0, 8)}`, text };
}

const assistant: SessionEntry = { kind: "assistant", id: "a-1", blocks: [] };

describe("buildUserHistory", () => {
  it("reads newest first, ignoring non-user and blank entries", () => {
    const entries = [user("第一条"), assistant, user("第二条"), user("   \n  ")];
    expect(buildUserHistory(entries)).toEqual(["第二条", "第一条"]);
  });

  it("keeps only the most recent occurrence of a repeated input", () => {
    const entries = [user("改一下"), user("先看报错"), user("改一下")];
    expect(buildUserHistory(entries)).toEqual(["改一下", "先看报错"]);
  });

  it("strips machine path notes and chip metadata down to readable text", () => {
    const prompt = formatFileMentionPrompt("看看 @src/a.ts 有没有笔误", [
      { path: "D:/proj/src/a.ts", displayPath: "src/a.ts", kind: "file", offset: 3 },
    ]);
    expect(prompt).toContain("引用路径：");
    expect(buildUserHistory([user(prompt)])).toEqual(["看看 @a.ts 有没有笔误"]);
  });

  it("keeps only the user instruction out of a browser page-context payload", () => {
    const prompt = buildPageContext({ text: "这个按钮点不动", items: [], consoleErrors: [] });
    expect(buildUserHistory([user(prompt)])).toEqual(["这个按钮点不动"]);
  });

  it("splits at the payload heading, not at a heading quoted inside the user text", () => {
    const prompt = buildPageContext({
      text: "## 用户说明\n这行是文档原话",
      items: [],
      consoleErrors: [],
    });
    expect(buildUserHistory([user(prompt)])).toEqual(["## 用户说明\n这行是文档原话"]);
  });

  it("drops context-only messages that carry no user instruction", () => {
    const prompt = buildPageContext({ text: "   ", items: [], consoleErrors: [] });
    expect(buildUserHistory([user(prompt), user("上一条")])).toEqual(["上一条"]);
  });
});
