import { describe, expect, it } from "vitest";
import type { PiChatMessage, SessionTranscriptPayload } from "../../shared/ipc";
import { buildSessionMarkdown, toExportFileName } from "./exportMarkdown";

const payload = (messages: PiChatMessage[], truncated = false): SessionTranscriptPayload => ({
  messages,
  startedAt: 1735689600000,
  truncated,
});

describe("toExportFileName", () => {
  it("净化非法字符并追加 .md", () => {
    expect(toExportFileName('a/b:c*d?"<>|.md')).toBe("bcd.md");
  });

  it("保留中文标题、去掉重复扩展名", () => {
    expect(toExportFileName("性能优化方案")).toBe("性能优化方案.md");
    expect(toExportFileName("发布记录.markdown")).toBe("发布记录.md");
  });

  it("空标题回退默认名", () => {
    expect(toExportFileName("   ")).toBe("会话记录.md");
    expect(toExportFileName(undefined)).toBe("会话记录.md");
  });

  it("Windows 保留设备名加前缀", () => {
    expect(toExportFileName("CON")).toBe("_CON.md");
  });
});

describe("buildSessionMarkdown", () => {
  it("渲染角色正文、折叠思考与工具调用、工具失败，跳过正常工具结果", () => {
    const markdown = buildSessionMarkdown(
      payload([
        { role: "user", content: [{ type: "text", text: "你好" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "想一下" },
            { type: "text", text: "答复" },
            { type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } },
          ],
        },
        {
          role: "toolResult",
          content: [{ type: "text", text: "文件内容" }],
          toolCallId: "t1",
          toolName: "read",
        },
        {
          role: "toolResult",
          content: [{ type: "text", text: "boom" }],
          toolCallId: "t2",
          toolName: "bash",
          isError: true,
        },
      ]),
      { title: "会话标题", file: "C:\\sessions\\s.jsonl", exportedAt: 1735689600000 },
    );

    expect(markdown).toContain("# 会话标题");
    expect(markdown).toContain("**用户**\n\n你好");
    expect(markdown).toContain("**助手**\n\n<details>");
    expect(markdown).toContain("<summary>思考过程</summary>");
    expect(markdown).toContain("<summary>工具调用：read</summary>");
    expect(markdown).toContain('"path": "a.ts"');
    expect(markdown).toContain("**工具失败** `bash`：boom");
    // 正常工具结果不进文档，避免文件内容淹没对话主线
    expect(markdown).not.toContain("文件内容");
  });

  it("用户图片附件只记数量", () => {
    const markdown = buildSessionMarkdown(
      payload([
        {
          role: "user",
          content: [
            { type: "text", text: "看这张图" },
            { type: "image", data: "QUJD", mimeType: "image/png" },
          ],
        },
      ]),
      { title: "t", file: "f", exportedAt: 0 },
    );
    expect(markdown).toContain("图片附件 ×1");
    expect(markdown).not.toContain("QUJD");
  });

  it("截断会话写入显式提示", () => {
    const markdown = buildSessionMarkdown(payload([], true), {
      title: "t",
      file: "f",
      exportedAt: 0,
    });
    expect(markdown).toContain("导出仅包含最近的部分消息");
  });

  it("无内容消息不产生空角色段", () => {
    const markdown = buildSessionMarkdown(payload([{ role: "assistant", content: [] }]), {
      title: "t",
      file: "f",
      exportedAt: 0,
    });
    expect(markdown).not.toContain("**助手**");
  });
});
