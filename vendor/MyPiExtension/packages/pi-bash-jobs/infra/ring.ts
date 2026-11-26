/**
 * Output ring buffer (doc 129 §5.4): bytes **and** lines are both capped, `\r` also ends a
 * line (curl/wget/pip redraw the same line), and a cursor lets the model read only what is
 * new since the last inspect.
 *
 * A partial trailing line is kept out of the committed set but still shown: `Password:` with
 * no newline is exactly the state a user needs to see. Showing it twice on two inspects is
 * correct — it is a live line, not a duplicated entry.
 */

import { StringDecoder } from "node:string_decoder";

export interface RingLimits {
	maxBytes: number;
	maxLines: number;
}

interface Entry {
	seq: number;
	text: string;
	bytes: number;
}

export interface RingSnapshot {
	/** Lines after `cursor`, oldest first. */
	lines: string[];
	/** Cursor to pass to the next call. Always the highest committed seq. */
	cursor: string;
	/** True when the requested cursor was already trimmed away — the tail is lossy. */
	lost: boolean;
}

export interface RingStats {
	bytes: number;
	lines: number;
	/** Highest committed seq, `0` when nothing has been committed yet. */
	nextSeq: number;
	/**
	 * True when anything is no longer fully here: a dropped line, or a line/pending fragment that
	 * the byte cap shortened. Without it a capped single line would look like complete output.
	 */
	truncated: boolean;
}

export interface RingBuffer {
	append(chunk: Buffer | string): void;
	/** Full retained text, including the pending partial line. */
	text(): string;
	/** Last `n` lines (default all), including the pending partial line. */
	tail(n?: number): string;
	/**
	 * The streaming-frame shape: last `maxLines` lines within `maxBytes`, collected backward in
	 * one pass. Never builds the too-large intermediate that a `tailWithinBytes(tail(n))` pair
	 * would join and re-encode, and stops as soon as the byte budget is spent.
	 */
	tailWithin(maxLines: number, maxBytes: number): string;
	since(cursor?: string, limit?: number): RingSnapshot;
	stats(): RingStats;
	/** Subscribe to committed lines (doc 132's job watch hangs here). */
	onCommit(listener: (line: string) => void): () => void;
	/** Cursor for the newest committed line. */
	cursor(): string;
}

interface BoundedText {
	text: string;
	/** UTF-8 byte length of `text`, from the same scan that bounded it. */
	bytes: number;
}

/**
 * Longest suffix of `text` that fits in `maxBytes` of UTF-8, never splitting a code point, with
 * the byte length from the same pass.
 *
 * Byte caps must be measured in bytes: slicing by characters lets a CJK line keep three times the
 * budget, and slicing blind can cut a surrogate pair into a lone half that renders as `\uFFFD`.
 */
function boundedTail(text: string, maxBytes: number): BoundedText {
	if (maxBytes <= 0 || text.length === 0) return { text: "", bytes: 0 };
	const total = Buffer.byteLength(text, "utf8");
	if (total <= maxBytes) return { text, bytes: total };
	const buffer = Buffer.from(text, "utf8");
	let start = buffer.length - maxBytes;
	// A continuation byte means the cut landed inside a sequence: walk to the next lead byte.
	while (start < buffer.length && ((buffer[start] as number) & 0xc0) === 0x80) start++;
	return { text: buffer.subarray(start).toString("utf8"), bytes: buffer.length - start };
}

export function tailWithinBytes(text: string, maxBytes: number): string {
	return boundedTail(text, maxBytes).text;
}

export function createRingBuffer(limits: RingLimits): RingBuffer {
	const maxBytes = Math.max(1, limits.maxBytes);
	const maxLines = Math.max(1, limits.maxLines);
	const decoder = new StringDecoder("utf8");
	// Fixed-capacity circular buffer: a head index makes both cap evictions O(1). The previous
	// array + Array.shift memmoved up to `maxLines` pointers on *every* commit once the cap was
	// reached — measurable for jobs that emit progress lines faster than the cap drains.
	const capacity = maxLines;
	const slots: (Entry | undefined)[] = new Array(capacity);
	let head = 0; // index of the oldest entry
	let count = 0;
	let pending = "";
	let bytes = 0;
	let nextSeq = 1;
	let droppedThrough = 0;
	const listeners = new Set<(line: string) => void>();
	/** Set when a chunk ended on `\r`; the `\n` of a split `\r\n` must not become a blank line. */
	let swallowLeadingLf = false;
	let truncated = false;

	const at = (index: number): Entry => slots[(head + index) % capacity] as Entry;

	const evictOldest = () => {
		const dropped = at(0);
		slots[head] = undefined;
		head = (head + 1) % capacity;
		count--;
		bytes -= dropped.bytes;
		droppedThrough = dropped.seq;
		truncated = true;
	};

	const commit = (text: string) => {
		// One absurdly long line (a minified bundle piped into the log) must not defeat the byte
		// cap: keep its tail, which is where the error message usually is. The byte length comes
		// from the same scan that bounds the text — no second pass per committed line.
		const bounded = boundedTail(text, maxBytes);
		if (bounded.text !== text) truncated = true;
		if (count === capacity) evictOldest();
		slots[(head + count) % capacity] = { seq: nextSeq++, text: bounded.text, bytes: bounded.bytes };
		count++;
		bytes += bounded.bytes;
		while (bytes > maxBytes && count > 1) evictOldest();
		const committed = bounded.text;
		for (const listener of listeners) listener(committed);
	};

	// `\r\n` is one break; a lone `\r` is a progress redraw, which is also a break.
	const consume = (chunk: string) => {
		if (!chunk) return;
		let text = pending + chunk;
		pending = "";
		// Pipe reads split wherever the buffer ends, including between `\r` and `\n`. That pair is
		// still one break, so the leading `\n` of this chunk must not commit an empty line.
		if (swallowLeadingLf && text.startsWith("\n")) text = text.slice(1);
		swallowLeadingLf = false;
		// A trailing `\r` may be the first half of that pair: end the line it terminates now (as one
		// break) but hold the decision about a possible `\n` until the next chunk arrives.
		if (text.endsWith("\r")) {
			text = `${text.slice(0, -1)}\n`;
			swallowLeadingLf = true;
		}
		const parts = text.split(/\r\n|\r|\n/);
		// A partial line is bounded too: `progress` without a newline would otherwise grow forever.
		const partial = parts.pop() ?? "";
		const bounded = boundedTail(partial, maxBytes);
		pending = bounded.text;
		if (pending !== partial) truncated = true;
		for (const part of parts) commit(part);
	};

	/**
	 * Kept entries are a suffix of the ring (seq grows head → tail): walk back from the newest
	 * until the cursor, so a long-poll that has already read everything stops after one step.
	 */
	const snapshotLines = (from: number, limit?: number): RingSnapshot => {
		const lost = from > 0 && from < droppedThrough;
		let keptStart = count;
		while (keptStart > 0 && at(keptStart - 1).seq > from) keptStart--;
		const lines: string[] = [];
		for (let i = keptStart; i < count; i++) lines.push(at(i).text);
		if (pending.length > 0) lines.push(pending);
		const limited = limit !== undefined && limit >= 0 && lines.length > limit ? lines.slice(-limit) : lines;
		return { lines: limited, cursor: String(nextSeq - 1), lost };
	};

	return {
		append(chunk) {
			consume(typeof chunk === "string" ? chunk : decoder.write(chunk));
		},
		text() {
			const all: string[] = new Array(count);
			for (let i = 0; i < count; i++) all[i] = at(i).text;
			if (pending.length > 0) all.push(pending);
			return all.join("\n");
		},
		tail(n) {
			const hasPending = pending.length > 0;
			const allLen = count + (hasPending ? 1 : 0);
			if (n !== undefined && n >= 0 && n < allLen) {
				if (n === 0) return "";
				// Only the last `n` lines are wanted: collect that short tail, never the whole ring.
				const take = Math.min(n - (hasPending ? 1 : 0), count);
				const parts: string[] = new Array(n);
				for (let i = count - take, j = 0; i < count; i++, j++) parts[j] = at(i).text;
				if (hasPending) parts[n - 1] = pending;
				return parts.join("\n");
			}
			const parts: string[] = new Array(allLen);
			for (let i = 0; i < count; i++) parts[i] = at(i).text;
			if (hasPending) parts[count] = pending;
			return parts.join("\n");
		},
		tailWithin(maxLines: number, maxBytes: number) {
			if (maxLines <= 0 || maxBytes <= 0) return "";
			const hasPending = pending.length > 0;
			const pendingBytes = hasPending ? Buffer.byteLength(pending, "utf8") : 0;
			// Entries are pre-measured (commit stored their bytes): the backward walk costs
			// arithmetic only, and stops at the line cap or the byte budget — whichever first.
			const entryBudget = maxBytes - pendingBytes;
			const maxEntries = Math.max(0, maxLines - (hasPending ? 1 : 0));
			let take = 0;
			let sum = 0;
			while (take < count && take < maxEntries) {
				const entryBytes = at(count - 1 - take).bytes;
				if (sum + entryBytes > entryBudget) break;
				sum += entryBytes;
				take++;
			}
			if (take === 0) {
				// Nothing whole fits: keep the tail of the newest text, same rule as the byte cap.
				if (!hasPending) return count === 0 ? "" : boundedTail(at(count - 1).text, maxBytes).text;
				return boundedTail(pending, maxBytes).text;
			}
			const parts: string[] = new Array(take + (hasPending ? 1 : 0));
			for (let i = count - take, j = 0; i < count; i++, j++) parts[j] = at(i).text;
			if (hasPending) parts[parts.length - 1] = pending;
			return parts.join("\n");
		},
		since(cursor, limit) {
			const parsed = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
			return snapshotLines(Number.isFinite(parsed) && parsed > 0 ? parsed : 0, limit);
		},
		stats() {
			return { bytes, lines: count, nextSeq, truncated };
		},
		onCommit(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		cursor() {
			return String(nextSeq - 1);
		},
	};
}
