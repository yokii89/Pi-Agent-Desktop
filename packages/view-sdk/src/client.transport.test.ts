import { EventEmitter } from "node:events";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopViewClient, ViewHostError } from "./client.js";
import { VIEW_LIMITS } from "./types.js";

/** Inject Buffer chunks into the real data handler: TCP may merge writes. */
class TestSocket extends EventEmitter {
  destroyed = false;
  writableLength = 0;
  write = vi.fn((frame: string) => {
    if (JSON.parse(frame).token) {
      queueMicrotask(() =>
        this.emit(
          "data",
          envelope("hello", {
            protocol: "view/v1",
            placements: ["modal"],
            capabilities: ["view-patch"],
            limits: { ...VIEW_LIMITS, maxMessageBytes: 1024 },
          }),
        ),
      );
    }
    return this.writableLength === 0;
  });
  destroy() {
    if (!this.destroyed) {
      this.destroyed = true;
      queueMicrotask(() => this.emit("close"));
    }
    return this;
  }
}

function envelope(type: string, payload: unknown, id?: string): Buffer {
  return Buffer.from(`${JSON.stringify({ v: "view/v1", type, payload, id })}\n`);
}

const clients: DesktopViewClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  vi.restoreAllMocks();
});

async function connect() {
  const socket = new TestSocket();
  vi.spyOn(net, "connect").mockImplementation(() => {
    queueMicrotask(() => socket.emit("connect"));
    return socket as unknown as net.Socket;
  });
  const client = new DesktopViewClient({
    endpoint: "http://127.0.0.1:1",
    token: "transport-test",
    protocol: "view/v1",
  });
  clients.push(client);
  const session = await client.openLive({ root: { type: "text", content: "test" } });
  return { socket, client, session };
}

describe("DesktopViewClient transport", () => {
  it.each([
    ["中", 1],
    ["中", 2],
    ["😀", 1],
    ["😀", 2],
    ["😀", 3],
  ] as const)("preserves %s split after byte %i", async (character, offset) => {
    const { socket, session } = await connect();
    const received = vi.fn();
    session.onEvent(received);
    const payload = { type: "change", nodeId: "answer", value: `中文${character}输入😀` };
    const frame = envelope("event", payload, session.id);
    const split = frame.indexOf(Buffer.from(character)) + offset;
    socket.emit("data", frame.subarray(0, split));
    expect(received).not.toHaveBeenCalled();
    socket.emit("data", frame.subarray(split));
    expect(received).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("handles byte-by-byte UTF-8 and multiple CRLF/LF frames", async () => {
    const { socket, session } = await connect();
    const received = vi.fn();
    session.onEvent(received);
    const payload = { type: "change", nodeId: "answer", value: "中文😀" };
    const frame = envelope("event", payload, session.id);
    for (const byte of frame) socket.emit("data", Buffer.from([byte]));
    socket.emit("data", Buffer.from(`${frame.toString().trimEnd()}\r\n${frame.toString()}`));
    expect(received).toHaveBeenCalledTimes(3);
    for (const [event] of received.mock.calls) expect(event).toEqual(payload);
  });

  it.each([false, true])("rejects an oversized UTF-8 line (terminated=%s)", async (terminated) => {
    const { socket, session } = await connect();
    const received = vi.fn();
    session.onEvent(received);
    // Fewer than 1024 characters, but over 1024 bytes.
    const frame = envelope(
      "event",
      { type: "change", nodeId: "a", value: "中".repeat(400) },
      session.id,
    );
    const suffix = envelope("event", { type: "dismiss" }, session.id);
    socket.emit("data", terminated ? Buffer.concat([frame, suffix]) : frame.subarray(0, -1));
    expect(socket.destroyed).toBe(true);
    expect(received).not.toHaveBeenCalled();
    await expect(session.closed).resolves.toMatchObject({ reason: "dispose" });
  });

  it("allows a frame at the byte limit and a larger batch of valid frames", async () => {
    const { socket, session } = await connect();
    const payload = { type: "change", nodeId: "a", value: "" };
    payload.value = "x".repeat(1024 - (envelope("event", payload, session.id).length - 1));
    const frame = envelope("event", payload, session.id);
    const received = vi.fn();
    session.onEvent(received);
    socket.emit("data", Buffer.concat([frame, frame]));
    expect(socket.destroyed).toBe(false);
    expect(received).toHaveBeenCalledTimes(2);
  });

  it.each([0, 1])(
    "checks fragmented CRLF against the payload byte limit (overflow=%i)",
    async (overflow) => {
      const { socket, session } = await connect();
      const payload = { type: "change", nodeId: "a", value: "" };
      payload.value = "x".repeat(
        1024 - (envelope("event", payload, session.id).length - 1) + overflow,
      );
      const line = envelope("event", payload, session.id).subarray(0, -1);
      const received = vi.fn();
      session.onEvent(received);

      socket.emit("data", Buffer.concat([line, Buffer.from("\r")]));
      expect(socket.destroyed).toBe(overflow > 0);
      expect(received).not.toHaveBeenCalled();
      socket.emit("data", Buffer.from("\n"));
      if (overflow === 0) expect(received).toHaveBeenCalledExactlyOnceWith(payload);
      else await expect(session.closed).resolves.toMatchObject({ reason: "dispose" });
    },
  );

  it("does not allow extra carriage returns beyond the payload budget", async () => {
    const { socket } = await connect();
    socket.emit("data", Buffer.from(`${"x".repeat(1024)}\r\r`));
    expect(socket.destroyed).toBe(true);
  });

  it("does not mistake write(false) for a rejected frame", async () => {
    const { socket, session } = await connect();
    socket.writableLength = 1;
    socket.write.mockClear();
    expect(
      session.patch({ ops: [{ path: [], node: { type: "text", content: "buffered" } }] }),
    ).toBe(true);
    expect(socket.write).toHaveBeenCalledOnce();
    expect(socket.destroyed).toBe(false);
  });

  it("bounds the write queue and reports a dropped frame before closing sessions", async () => {
    const { socket, session } = await connect();
    socket.writableLength = 4 * VIEW_LIMITS.maxMessageBytes;
    socket.write.mockClear();
    expect(() => session.update({ type: "text", content: "blocked" })).toThrow(ViewHostError);
    expect(socket.write).not.toHaveBeenCalled();
    expect(socket.destroyed).toBe(true);
    await expect(session.closed).resolves.toMatchObject({ reason: "dispose" });
  });

  it("reports synchronous write failure and stops a coalesced writer", async () => {
    const { socket, session } = await connect();
    const onError = vi.fn();
    const writer = session.coalesced({ onError });
    socket.write.mockImplementation(() => {
      throw new Error("pipe gone");
    });
    writer.set({ type: "text", content: "failed" });
    await writer.flush();
    expect(writer.lastError).toMatchObject({ code: "closed" });
    expect(onError).toHaveBeenCalledOnce();
    socket.write.mockClear();
    writer.set({ type: "text", content: "after close" });
    await writer.flushNow();
    expect(socket.write).not.toHaveBeenCalled();
  });
});
