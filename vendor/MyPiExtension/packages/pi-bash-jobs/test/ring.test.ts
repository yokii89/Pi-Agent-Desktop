import { describe, expect, it } from "vitest";
import { createRingBuffer, tailWithinBytes } from "../infra/ring.ts";

const limits = { maxBytes: 64 * 1024, maxLines: 4_000 };

describe("ring buffer", () => {
	it("keeps a partial line visible without committing it", () => {
		const ring = createRingBuffer(limits);
		ring.append("Password:");
		expect(ring.text()).toBe("Password:");
		expect(ring.stats().lines).toBe(0);
		ring.append(" secret\n");
		expect(ring.text()).toBe("Password: secret");
		expect(ring.stats().lines).toBe(1);
	});

	it("splits on \\r as well as \\n — a progress bar is a line", () => {
		const ring = createRingBuffer(limits);
		ring.append("10%\r20%\r30%\r");
		expect(ring.text()).toBe("10%\n20%\n30%");
		expect(ring.stats().lines).toBe(3);
	});

	it("treats \\r\\n as one break, not two", () => {
		const ring = createRingBuffer(limits);
		ring.append("a\r\nb\r\n");
		expect(ring.text()).toBe("a\nb");
		expect(ring.stats().lines).toBe(2);
	});

	it("does not invent a blank line when \\r\\n is split across chunks", () => {
		// A pipe read ends wherever the buffer ends — including between the two characters.
		const ring = createRingBuffer(limits);
		ring.append("first\r");
		ring.append("\nsecond\n");
		expect(ring.text()).toBe("first\nsecond");
		expect(ring.stats().lines).toBe(2);
	});

	it("still ends a line on a trailing \\r when nothing follows it", () => {
		const ring = createRingBuffer(limits);
		ring.append("done\r");
		expect(ring.text()).toBe("done");
		expect(ring.stats().lines).toBe(1);
	});

	it("caps a partial line at maxBytes instead of growing without bound", () => {
		// A progress bar that never emits a newline is the pathological case: `pending` used to grow
		// with the process, and the whole buffer came back as the tool result.
		const ring = createRingBuffer({ maxBytes: 16, maxLines: 10 });
		for (let index = 0; index < 100; index++) ring.append("xxxxxxxxxx");
		expect(ring.stats().lines).toBe(0);
		expect(ring.text().length).toBeLessThanOrEqual(16);
		expect(ring.text().endsWith("x")).toBe(true);
		expect(ring.stats().truncated).toBe(true);
	});

	it("trims over-long lines by bytes without splitting a code point", () => {
		const ring = createRingBuffer({ maxBytes: 8, maxLines: 10 });
		// 12 bytes of CJK: only the last whole character fits in 8 bytes.
		ring.append("中文中文\n");
		expect(ring.text()).toBe("中文");
		expect(ring.text()).not.toContain("\uFFFD");
	});

	it("tailWithinBytes keeps whole code points", () => {
		expect(tailWithinBytes("", 4)).toBe("");
		expect(tailWithinBytes("abc", 0)).toBe("");
		expect(tailWithinBytes("abc", 4)).toBe("abc");
		expect(tailWithinBytes("中文", 4)).toBe("文");
		// A surrogate pair is 4 bytes and must never be cut in half.
		expect(tailWithinBytes("😀😀", 5)).toBe("😀");
	});

	it("survives a multi-byte character split across chunks", () => {
		const ring = createRingBuffer(limits);
		const buffer = Buffer.from("中文\n", "utf8");
		ring.append(buffer.subarray(0, 1));
		ring.append(buffer.subarray(1));
		expect(ring.text()).toBe("中文");
	});

	it("drops the oldest lines at maxLines", () => {
		const ring = createRingBuffer({ maxBytes: 1_000_000, maxLines: 3 });
		ring.append("1\n2\n3\n4\n5\n");
		expect(ring.text()).toBe("3\n4\n5");
		expect(ring.stats().lines).toBe(3);
		expect(ring.stats().truncated).toBe(true);
	});

	it("drops the oldest lines at maxBytes", () => {
		const ring = createRingBuffer({ maxBytes: 10, maxLines: 1_000 });
		ring.append("aaaaaa\nbbbbbb\ncccccc\n");
		// Only whole lines are dropped; the newest line is always kept.
		expect(ring.text().endsWith("cccccc")).toBe(true);
		expect(ring.stats().bytes).toBeLessThanOrEqual(20);
	});

	it("truncates one absurdly long line instead of dropping it", () => {
		const ring = createRingBuffer({ maxBytes: 8, maxLines: 10 });
		ring.append("0123456789abcdef\n");
		expect(ring.text()).toBe("89abcdef");
		// A shortened line is lossy even though nothing was dropped: say so.
		expect(ring.stats().truncated).toBe(true);
	});

	it("reports the tail and the cursor", () => {
		const ring = createRingBuffer(limits);
		ring.append("a\nb\nc\n");
		expect(ring.tail(2)).toBe("b\nc");
		expect(ring.tail()).toBe("a\nb\nc");
		expect(ring.cursor()).toBe("3");
		expect(ring.stats().truncated).toBe(false);
	});

	it("returns only new lines for a cursor", () => {
		const ring = createRingBuffer(limits);
		ring.append("a\nb\n");
		const first = ring.since();
		expect(first.lines).toEqual(["a", "b"]);
		ring.append("c\n");
		const second = ring.since(first.cursor);
		expect(second.lines).toEqual(["c"]);
		expect(second.lost).toBe(false);
		// No new output: the answer is empty, not the whole tail again.
		expect(ring.since(second.cursor).lines).toEqual([]);
	});

	it("marks a cursor that was already trimmed away as lost", () => {
		const ring = createRingBuffer({ maxBytes: 1_000_000, maxLines: 2 });
		ring.append("a\nb\n");
		const stale = ring.cursor();
		ring.append("c\nd\n");
		// Nothing lost yet: the trimmed lines were ones the caller had already read.
		expect(ring.since(stale)).toMatchObject({ lines: ["c", "d"], lost: false });
		ring.append("e\n");
		// Now a line the caller never saw (c) is gone.
		const snapshot = ring.since(stale);
		expect(snapshot.lost).toBe(true);
		expect(snapshot.lines).toEqual(["d", "e"]);
	});

	it("limits the number of returned lines", () => {
		const ring = createRingBuffer(limits);
		ring.append("a\nb\nc\n");
		expect(ring.since(undefined, 2).lines).toEqual(["b", "c"]);
	});

	it("notifies subscribers per committed line, and unsubscribes", () => {
		const ring = createRingBuffer(limits);
		const seen: string[] = [];
		const off = ring.onCommit((line) => seen.push(line));
		ring.append("a\nb\n");
		off();
		ring.append("c\n");
		expect(seen).toEqual(["a", "b"]);
	});
});
