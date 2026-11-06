import { describe, expect, it } from "vitest";
import type { PiChatMessage } from "../../shared/ipc";
import { customNoticeFromMessage, customNoticeSummary } from "./customMessage";

function message(overrides: Record<string, unknown>): PiChatMessage {
  return { role: "custom", content: [], ...overrides } as unknown as PiChatMessage;
}

describe("customNoticeFromMessage", () => {
  it("keeps the extension's type and the plain text", () => {
    const notice = customNoticeFromMessage(
      message({
        customType: "bash-job",
        content: [{ type: "text", text: "Bash job J-7 finished: exit 0 after 2h03m." }],
      }),
    );
    expect(notice).toEqual({
      customType: "bash-job",
      text: "Bash job J-7 finished: exit 0 after 2h03m.",
    });
  });

  it("accepts a plain string body", () => {
    expect(
      customNoticeFromMessage(message({ customType: "bash-job", content: "job done" }))?.text,
    ).toBe("job done");
  });

  it("renders nothing for display:false — that message is context only", () => {
    expect(
      customNoticeFromMessage(
        message({ customType: "bash-job", display: false, content: "hidden" }),
      ),
    ).toBeNull();
  });

  it("renders nothing for a non-custom role or an empty body", () => {
    expect(
      customNoticeFromMessage({
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
      } as PiChatMessage),
    ).toBeNull();
    expect(customNoticeFromMessage(message({ customType: "bash-job", content: "   " }))).toBeNull();
    expect(customNoticeFromMessage(message({ customType: "bash-job", content: [] }))).toBeNull();
  });

  it("falls back to a generic type when the extension did not name one", () => {
    expect(customNoticeFromMessage(message({ content: "hello" }))?.customType).toBe("extension");
    expect(
      customNoticeFromMessage(message({ customType: "  ", content: "hello" }))?.customType,
    ).toBe("extension");
  });

  it("keeps an unknown extension's text instead of dropping it", () => {
    const notice = customNoticeFromMessage(
      message({ customType: "some-new-extension", content: "hi" }),
    );
    expect(notice?.customType).toBe("some-new-extension");
    expect(notice?.text).toBe("hi");
  });
});

describe("customNoticeSummary", () => {
  it("takes the first non-empty line", () => {
    expect(customNoticeSummary("\n\nBash job J-7 finished\nCommand: pnpm dev\n")).toBe(
      "Bash job J-7 finished",
    );
  });

  it("falls back to the whole text for a one-line notice", () => {
    expect(customNoticeSummary("job done")).toBe("job done");
  });
});
