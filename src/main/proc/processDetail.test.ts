import { describe, expect, it } from "vitest";
import type { ManagedProcess, ProcEndpoint } from "../../shared/ipc";
import {
  buildDescendants,
  buildProcDetail,
  parseHostPort,
  parseNetstatOutput,
  selectPorts,
} from "./processDetail";
import type { ProcessSnapshot, ProcessSnapshotRow } from "./processWatch";

function row(partial: Partial<ProcessSnapshotRow> & { pid: number }): ProcessSnapshotRow {
  return {
    ppid: 0,
    name: "node.exe",
    commandLine: "",
    startedAt: 1000,
    workingSet: 1024,
    ...partial,
  };
}

function snap(...rows: ProcessSnapshotRow[]): ProcessSnapshot {
  return new Map(rows.map((r) => [r.pid, r]));
}

function managed(partial: Partial<ManagedProcess> = {}): ManagedProcess {
  return {
    id: "s1:100:1000",
    sessionId: "s1",
    pid: 100,
    ppid: 50,
    commandLine: "node vite",
    name: "node.exe",
    startedAt: 1000,
    registeredAt: 2000,
    status: "alive",
    ...partial,
  };
}

function port(partial: Partial<ProcEndpoint> & { pid: number }): ProcEndpoint {
  return {
    localAddress: "127.0.0.1",
    localPort: 5173,
    remoteAddress: null,
    remotePort: null,
    state: "Listen",
    ...partial,
  };
}

describe("buildDescendants", () => {
  it("取 root 的子孙（BFS、按 pid 稳定），不包含无关进程", () => {
    const snapshot = snap(
      row({ pid: 100, ppid: 50 }),
      row({ pid: 101, ppid: 100 }),
      row({ pid: 102, ppid: 100 }),
      row({ pid: 103, ppid: 101 }),
      row({ pid: 200, ppid: 0 }),
    );
    expect(buildDescendants(snapshot, 100).map((r) => r.pid)).toEqual([101, 102, 103]);
  });

  it("异常环不会死循环，也不会把根算进子孙", () => {
    const snapshot = snap(
      row({ pid: 100, ppid: 101 }),
      row({ pid: 101, ppid: 100 }),
      row({ pid: 102, ppid: 101 }),
    );
    expect(buildDescendants(snapshot, 100).map((r) => r.pid)).toEqual([101, 102]);
  });

  it("超过上限截断", () => {
    const rows = [row({ pid: 100, ppid: 50 })];
    for (let i = 0; i < 10; i += 1) rows.push(row({ pid: 101 + i, ppid: 100 }));
    expect(buildDescendants(snap(...rows), 100, 3)).toHaveLength(3);
  });
});

describe("parseHostPort", () => {
  it("解析 IPv4 / IPv6 端点，端口非法返回 null", () => {
    expect(parseHostPort("127.0.0.1:5173")).toEqual({ address: "127.0.0.1", port: 5173 });
    expect(parseHostPort("[::1]:5000")).toEqual({ address: "::1", port: 5000 });
    expect(parseHostPort("bad")).toBeNull();
    expect(parseHostPort("127.0.0.1:0")).toBeNull();
  });
});

describe("parseNetstatOutput", () => {
  it("跳过表头/空行，解析 TCP 行（含 IPv6），外部地址端口 0 保留 0", () => {
    const output = [
      "",
      "活动连接",
      "  协议  本地地址          外部地址        状态           PID",
      "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1588",
      "  TCP    127.0.0.1:5173         127.0.0.1:52344        ESTABLISHED     1000",
      "  TCP    [::1]:5000             [::]:0                 LISTENING       2000",
      "",
    ].join("\r\n");
    const ports = parseNetstatOutput(output);
    expect(ports).toHaveLength(3);
    expect(ports[0]).toMatchObject({ pid: 1588, localPort: 135, state: "LISTENING" });
    expect(ports[1]).toMatchObject({ pid: 1000, localPort: 5173, remotePort: 52344 });
    expect(ports[2]).toMatchObject({
      pid: 2000,
      localAddress: "::1",
      remoteAddress: null,
      remotePort: null,
    });
  });

  it("坏行直接丢弃", () => {
    expect(parseNetstatOutput("")).toEqual([]);
    expect(parseNetstatOutput("TCP\nTCP   :80  :0  LISTENING  10")).toEqual([]);
  });
});

describe("selectPorts", () => {
  it("只保留归属进程，监听在前，按端口排序并截断", () => {
    const ports = [
      port({ pid: 101, localPort: 3000, state: "Established" }),
      port({ pid: 100, localPort: 5174 }),
      port({ pid: 100, localPort: 5173 }),
      port({ pid: 999, localPort: 80 }),
    ];
    const selected = selectPorts(ports, new Set([100, 101]), 2);
    expect(selected.map((p) => [p.pid, p.localPort])).toEqual([
      [100, 5173],
      [100, 5174],
    ]);
  });
});

describe("buildProcDetail", () => {
  const snapshot = snap(
    row({ pid: 100, ppid: 50, workingSet: 1000, commandLine: "node vite" }),
    row({ pid: 101, ppid: 100, workingSet: 2000 }),
    row({ pid: 102, ppid: 101, workingSet: 3000 }),
  );
  const ports = [port({ pid: 100 }), port({ pid: 101, localPort: 3000, state: "Established" })];

  it("存活：汇总子孙、内存与端点", () => {
    const detail = buildProcDetail({ proc: managed(), snapshot, ports, now: 123 });
    expect(detail.alive).toBe(true);
    expect(detail.at).toBe(123);
    expect(detail.descendants.map((r) => r.pid)).toEqual([101, 102]);
    expect(detail.processCount).toBe(3);
    expect(detail.memoryBytes).toBe(6000);
    expect(detail.ports.map((p) => p.pid)).toEqual([100, 101]);
    expect(detail.portsReadable).toBe(true);
  });

  it("PID 被复用（命令行不符）：判为已退出，不返回子树与端点", () => {
    const detail = buildProcDetail({
      proc: managed({ commandLine: "node old-server" }),
      snapshot,
      ports,
    });
    expect(detail.alive).toBe(false);
    expect(detail.descendants).toEqual([]);
    expect(detail.ports).toEqual([]);
    expect(detail.processCount).toBe(0);
    expect(detail.memoryBytes).toBe(0);
  });

  it("子孙超过展示上限：展示行截断，但进程数/内存/端口按全部子孙统计", () => {
    const rows = [row({ pid: 100, ppid: 50, workingSet: 500, commandLine: "node vite" })];
    for (let i = 0; i < 60; i += 1) {
      rows.push(row({ pid: 201 + i, ppid: 100, workingSet: 1000 }));
    }
    const detail = buildProcDetail({
      proc: managed(),
      snapshot: snap(...rows),
      ports: [port({ pid: 260, localPort: 9999 })],
    });
    expect(detail.descendants).toHaveLength(48);
    expect(detail.processCount).toBe(61);
    expect(detail.memoryBytes).toBe(500 + 60 * 1000);
    expect(detail.ports.map((p) => p.pid)).toEqual([260]);
  });

  it("端口查询失败：portsReadable=false，其余信息保留", () => {
    const detail = buildProcDetail({ proc: managed(), snapshot, ports: [], portsReadable: false });
    expect(detail.alive).toBe(true);
    expect(detail.ports).toEqual([]);
    expect(detail.portsReadable).toBe(false);
  });
});
