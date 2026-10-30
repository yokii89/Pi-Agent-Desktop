import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { ManagedProcess } from "../../shared/ipc";
import { readProcessDetail } from "./processDetail";
import { queryProcess } from "./processKill";

/**
 * 真实进程集成校验（PowerShell 枚举 + Get-NetTCPConnection）。
 * 默认跳过：`PIDESK_PROC_INTEGRATION=1 pnpm exec vitest run --config src/main/vitest.config.ts src/main/proc/processDetail.integration.test.ts`
 */
const run = process.env.PIDESK_PROC_INTEGRATION === "1" ? it : it.skip;

describe("readProcessDetail（真实子进程）", () => {
  let child: ReturnType<typeof spawn> | null = null;

  afterEach(() => {
    child?.kill();
    child = null;
  });

  run(
    "返回监听端口、子进程计数与内存",
    async () => {
      const script =
        "const s=require('http').createServer((q,r)=>r.end('ok'));" +
        "s.listen(0,'127.0.0.1',()=>process.stdout.write('PORT:'+s.address().port));";
      child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
      const port = await new Promise<string>((resolve, reject) => {
        let buffer = "";
        const timer = setTimeout(() => reject(new Error("等待端口超时")), 10_000);
        child?.stdout?.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const match = /PORT:(\d+)/.exec(buffer);
          if (!match) return;
          clearTimeout(timer);
          resolve(match[1] as string);
        });
      });

      const pid = child.pid as number;
      const row = await queryProcess(pid);
      expect(row).not.toBeNull();
      const proc: ManagedProcess = {
        id: `it:${pid}:${row?.startedAt ?? 0}`,
        sessionId: "it",
        pid,
        ppid: row?.ppid ?? 0,
        commandLine: row?.commandLine ?? "",
        name: row?.name ?? "node.exe",
        startedAt: row?.startedAt ?? 0,
        registeredAt: Date.now(),
        status: "alive",
      };

      const detail = await readProcessDetail(proc);
      expect(detail.alive).toBe(true);
      expect(detail.processCount).toBeGreaterThanOrEqual(1);
      expect(detail.memoryBytes).toBeGreaterThan(0);
      expect(detail.portsReadable).toBe(true);
      expect(
        detail.ports.some((p) => p.localPort === Number(port) && p.state === "LISTENING"),
      ).toBe(true);
    },
    30_000,
  );
});
