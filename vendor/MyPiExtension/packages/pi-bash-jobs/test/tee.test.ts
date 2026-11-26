import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRingBuffer } from "../infra/ring.ts";
import { createJobLogTee } from "../infra/tee.ts";

function ringWithLines(lines: string[]) {
	const ring = createRingBuffer({ maxBytes: 262_144, maxLines: 4_000 });
	for (const line of lines) ring.append(`${line}\n`);
	return ring;
}

let dir: string;

beforeEach(() => {
	dir = join(tmpdir(), `pi-bash-jobs-tee-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("createJobLogTee", () => {
	it("把 committed 行（stripAnsi 后）写入 <dir>/<jobId>.log", () => {
		const tee = createJobLogTee({ dir, maxBytes: 8_388_608 });
		const ring = ringWithLines([]);
		tee.attach("J-1", ring);
		ring.append("\x1b[32mhello\x1b[0m world\x1b[0m\n");
		ring.append("second\r\n");
		tee.flushAll();
		tee.dispose();
		const text = readFileSync(join(dir, "J-1.log"), "utf8");
		expect(text).toBe("hello world\nsecond\n");
	});

	it("debounce 内的行合并成一次 flush，flushAll 兜底", () => {
		const tee = createJobLogTee({ dir, maxBytes: 8_388_608, flushMs: 60_000 });
		const ring = ringWithLines([]);
		tee.attach("J-1", ring);
		ring.append("a\n");
		ring.append("b\n");
		tee.flushAll();
		expect(readFileSync(join(dir, "J-1.log"), "utf8")).toBe("a\nb\n");
		tee.dispose();
	});

	it("超过 maxBytes 停写并落截断标记，订阅退订后不再写入", () => {
		const tee = createJobLogTee({ dir, maxBytes: 16, flushMs: 60_000 });
		const ring = ringWithLines([]);
		tee.attach("J-1", ring);
		ring.append("aaaa\n"); // 5 bytes
		tee.flushAll();
		ring.append("bbbbbbbbbbbbbbbbbbbb\n"); // 超过 16 → 停写
		tee.flushAll();
		const text = readFileSync(join(dir, "J-1.log"), "utf8");
		expect(text).toContain("aaaa\n");
		expect(text).toContain("truncated");
		expect(text.length).toBeLessThan(200);
		tee.dispose();
	});

	it("同一 jobId 重复 attach 幂等；flushAll 后 buffer 清空不重复写", () => {
		const tee = createJobLogTee({ dir, maxBytes: 8_388_608, flushMs: 60_000 });
		const ring = ringWithLines([]);
		tee.attach("J-1", ring);
		ring.append("only-once\n");
		tee.attach("J-1", ring);
		tee.flushAll();
		tee.flushAll();
		expect(readFileSync(join(dir, "J-1.log"), "utf8")).toBe("only-once\n");
		tee.dispose();
	});

	it("dispose 停止订阅并 flush；之后 ring 继续输出不落盘", () => {
		const tee = createJobLogTee({ dir, maxBytes: 8_388_608, flushMs: 60_000 });
		const ring = ringWithLines([]);
		tee.attach("J-1", ring);
		ring.append("before\n");
		tee.dispose();
		ring.append("after\n");
		tee.flushAll();
		expect(readFileSync(join(dir, "J-1.log"), "utf8")).toBe("before\n");
	});

	it("已有同名文件时从现有大小续写（扩展重载不覆盖历史）", () => {
		writeFileSync(join(dir, "J-1.log"), "old\n", "utf8");
		const tee = createJobLogTee({ dir, maxBytes: 8_388_608, flushMs: 60_000 });
		const ring = ringWithLines([]);
		tee.attach("J-1", ring);
		ring.append("new\n");
		tee.flushAll();
		tee.dispose();
		expect(readFileSync(join(dir, "J-1.log"), "utf8")).toBe("old\nnew\n");
		expect(existsSync(join(dir, "J-1.log"))).toBe(true);
	});
});
