import { describe, expect, it } from "vitest";
import { CdpPipeDecoder, encodeCdpMessage } from "./chromiumCdpPipe";

describe("CdpPipeDecoder", () => {
  it("decodes NUL separated messages", () => {
    const decoder = new CdpPipeDecoder();
    expect(decoder.push(encodeCdpMessage({ id: 1, result: { ok: true } }))).toEqual([
      { id: 1, result: { ok: true } },
    ]);
  });

  it("reassembles a message split across chunks", () => {
    const decoder = new CdpPipeDecoder();
    const frame = encodeCdpMessage({ id: 7, result: { value: "split" } });
    expect(decoder.push(frame.slice(0, 6))).toEqual([]);
    expect(decoder.push(frame.slice(6))).toEqual([{ id: 7, result: { value: "split" } }]);
  });

  it("decodes several messages from one chunk and keeps the trailing partial", () => {
    const decoder = new CdpPipeDecoder();
    const messages = decoder.push(
      encodeCdpMessage({ id: 1, method: "Page.loadEventFired" }) +
        encodeCdpMessage({ id: 2, result: {} }) +
        '{"id":3,"result":{"partial"',
    );
    expect(messages).toEqual([
      { id: 1, method: "Page.loadEventFired" },
      { id: 2, result: {} },
    ]);
    expect(decoder.push(":true}}\0")).toEqual([{ id: 3, result: { partial: true } }]);
  });

  it("ignores empty frames and unparsable payloads", () => {
    const decoder = new CdpPipeDecoder();
    expect(decoder.push("\0\0not-json\0")).toEqual([]);
  });
});
