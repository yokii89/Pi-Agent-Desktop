import { describe, expect, it } from "vitest";
import { buildComposerPrompt } from "./composerPrompt";
import type { PositionedFileMention } from "./fileMentionFormat";
import { parseUserMessageSegments, readableUserMessage } from "./userMessageSegments";

const file: PositionedFileMention = {
  path: "D:/project/src/a.ts",
  displayPath: "src/a.ts",
  kind: "file",
  offset: 0,
};

describe("composer prompt serialization", () => {
  it.each(["/steer ", "  /STEER\n\n"])(
    "keeps the real inline chip position after removing %j",
    (prefix) => {
      const body = "手打 @src/a.ts 然后@src/a.ts继续";
      const raw = `${prefix}${body}`;
      const mention = { ...file, offset: raw.lastIndexOf("@") };
      const prompt = buildComposerPrompt(raw, [mention], ["D:/project/notes.pdf"]);
      expect(prompt.intent).toBe("steer");
      expect(prompt.body).toBe(body);
      const segments = parseUserMessageSegments(prompt.text);
      expect(readableUserMessage(segments)).toBe("手打 @src/a.ts 然后@a.ts继续\n\n@notes.pdf");
      expect(segments[0].parts?.filter((part) => part.kind === "file")).toMatchObject([
        { kind: "file", mention: { ...file, offset: body.lastIndexOf("@") } },
      ]);
      expect(mention.offset).toBe(raw.lastIndexOf("@"));
    },
  );

  it("preserves the follow-up default and the positions of ordinary file references", () => {
    const raw = "  看@src/a.ts继续  ";
    const prompt = buildComposerPrompt(raw, [{ ...file, offset: raw.indexOf("@") }]);
    expect(prompt.intent).toBe("followUp");
    expect(prompt.body).toBe(raw);
    expect(readableUserMessage(parseUserMessageSegments(prompt.text))).toBe("看@a.ts继续");
  });

  it("keeps image-only steer and file-only follow-up messages valid", () => {
    expect(buildComposerPrompt("/steer", [])).toEqual({ text: "", body: "", intent: "steer" });
    expect(buildComposerPrompt("", [], ["D:/project/spec.pdf"])).toEqual({
      text: "引用路径：\n- D:/project/spec.pdf",
      body: "",
      intent: "followUp",
    });
  });

  it("leaves real pi slash commands intact", () => {
    const prompt = buildComposerPrompt("/skill:review 看@src/a.ts", [{ ...file, offset: 15 }]);
    expect(prompt.body).toBe("/skill:review 看@src/a.ts");
    expect(prompt.intent).toBe("followUp");
    expect(prompt.text).toContain("/skill:review");
  });
});
