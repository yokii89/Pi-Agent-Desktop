import { describe, expect, it, vi } from "vitest";
import { ProcessRegistry } from "./processRegistry";

function input(pid: number, startedAt = 1000) {
  return {
    sessionId: "s1",
    pid,
    ppid: 1,
    commandLine: "node vite",
    name: "node.exe",
    startedAt,
  };
}

describe("ProcessRegistry", () => {
  it("registers unique processes per session and avoids duplicate pids", () => {
    const reg = new ProcessRegistry();
    const a = reg.register(input(10, 1000));
    const b = reg.register(input(10, 1000));
    expect(b?.id).toBe(a?.id);
    expect(reg.listBySession("s1")).toHaveLength(1);
  });

  it("does not re-register ignored pids in the same session", () => {
    const reg = new ProcessRegistry();
    const p = reg.register(input(10));
    expect(p).not.toBeNull();
    reg.setStatus((p as { id: string }).id, "ignored");
    expect(reg.register(input(10))).toBeNull();
    expect(reg.listBySession("s1")).toHaveLength(1);
    expect(reg.listBySession("s1")[0].status).toBe("ignored");
  });

  it("buckets by sessionId", () => {
    const reg = new ProcessRegistry();
    reg.register(input(10));
    reg.register({ ...input(20), sessionId: "s2" });
    expect(reg.countAlive("s1")).toBe(1);
    expect(reg.countAlive("s2")).toBe(1);
    expect(reg.countAllAlive()).toBe(2);
  });

  it("tracks status transitions and filters alive", () => {
    const reg = new ProcessRegistry();
    const p = reg.register(input(10));
    expect(p).not.toBeNull();
    reg.setStatus((p as { id: string }).id, "ignored");
    expect(reg.listAliveBySession("s1")).toHaveLength(0);
    expect(reg.listBySession("s1")[0].status).toBe("ignored");
    expect(reg.countAllAlive()).toBe(0);
  });

  it("emits onChange on register and status", () => {
    const onChange = vi.fn();
    const reg = new ProcessRegistry({ onChange });
    const p = reg.register(input(10));
    expect(onChange).toHaveBeenCalledWith("s1", expect.any(Array));
    expect(p).not.toBeNull();
    reg.setStatus((p as { id: string }).id, "exited");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("clearSession drops bucket and abandonAll empties", () => {
    const reg = new ProcessRegistry();
    reg.register(input(10));
    reg.register({ ...input(20), sessionId: "s2" });
    reg.clearSession("s1");
    expect(reg.listBySession("s1")).toEqual([]);
    expect(reg.countAlive("s2")).toBe(1);
    reg.abandonAll();
    expect(reg.countAllAlive()).toBe(0);
  });
});
