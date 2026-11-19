import { describe, expect, it } from "vitest";
import { sanitizeRemoteText } from "./sanitize";

describe("remote text redaction", () => {
  it("removes Windows and common POSIX absolute paths before sending private session text", () => {
    expect(
      sanitizeRemoteText(
        "Open C:\\Users\\Alice\\secret\\notes.md and /home/alice/private/notes.md",
      ),
    ).toBe("Open [local path] and [local path]");
  });
  it("preserves ordinary prose, HTTPS links and relative project paths", () => {
    const text = "https://example.com/docs/remote-protocol.html; open src/main/session.ts";
    expect(sanitizeRemoteText(text)).toBe(text);
  });
});
