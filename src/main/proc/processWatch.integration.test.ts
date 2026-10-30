import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessWatcher } from "./processWatch";

const run = process.env.PIDESK_PROC_INTEGRATION === "1" ? it : it.skip;

/**
 * 真实枚举下的边界竞态回归（docs/design/104 F1）。
 * 默认跳过：`PIDESK_PROC_INTEGRATION=1 pnpm exec vitest run --config src/main/vitest.config.ts src/main/proc/processWatch.integration.test.ts`
 */
describe("ProcessWatcher（真实枚举）", () => {
  let child: ReturnType<typeof spawn> | null = null;
  afterEach(() => {
    child?.kill();
    child = null;
  });

  run(
    "bash 立即返回（&）时，真实 vite 进程能被登记",
    async () => {
      const registered: Array<{ pid: number; commandLine: string }> = [];
      const watcher = new ProcessWatcher({
        enumerate: async () => {
          const { enumerateProcesses } = await import("./processKill");
          return enumerateProcesses();
        },
        register: (input) => {
          registered.push({ pid: input.pid, commandLine: input.commandLine });
        },
        markExited: () => {},
      });

      const started = watcher.noteBashStart("s1", process.pid, "t1");
      child = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)", "vite"], {
        stdio: "ignore",
      });
      watcher.noteBashEnd("s1", "t1");
      await started;
      await new Promise((r) => setTimeout(r, 6000));
      console.log(
        `[probe] 真实 vite 子进程 pid=${child?.pid}；6s 后登记表 = ${JSON.stringify(registered)}`,
      );
      expect(registered).toHaveLength(1);
      expect(registered[0]?.pid).toBe(child?.pid);
      watcher.dispose();
    },
    30_000,
  );
});
