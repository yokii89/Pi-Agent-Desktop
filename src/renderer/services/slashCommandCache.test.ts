import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeCwdKey,
  readSlashCommandCache,
  writeSlashCommandCache,
} from "./slashCommandCache";

const commands = [{ name: "review", description: "审查", source: "prompt" as const }];

afterEach(() => {
  vi.useRealTimers();
});

describe("normalizeCwdKey（Windows cwd 归一化，docs/会话进程懒加载方案 §5.2）", () => {
  it("unifies separators, drive-letter case and surrounding spaces", () => {
    expect(normalizeCwdKey("D:\\Code\\PI")).toBe(normalizeCwdKey("d:/code/pi"));
    expect(normalizeCwdKey(" D:\\a ")).toBe("d:/a");
  });

  it("returns null for blank input", () => {
    expect(normalizeCwdKey(null)).toBeNull();
    expect(normalizeCwdKey(undefined)).toBeNull();
    expect(normalizeCwdKey("  ")).toBeNull();
  });
});

describe("slashCommandCache", () => {
  it("hit within TTL across separator/case variants of the same cwd", () => {
    vi.useFakeTimers();
    writeSlashCommandCache("D:\\Code\\PI", commands);
    expect(readSlashCommandCache("d:/code/pi")).toEqual(commands);
  });

  it("miss on unknown cwd", () => {
    expect(readSlashCommandCache("d:/never-written")).toBeNull();
  });

  it("expires after TTL", () => {
    vi.useFakeTimers();
    writeSlashCommandCache("d:/a", commands);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(readSlashCommandCache("d:/a")).toBeNull();
  });

  it("ignores empty command writes (多为失败兜底，不污染缓存)", () => {
    writeSlashCommandCache("d:/empty", []);
    expect(readSlashCommandCache("d:/empty")).toBeNull();
  });

  it("ignores blank cwd writes", () => {
    writeSlashCommandCache(null, commands);
    expect(readSlashCommandCache(null)).toBeNull();
  });
});
