import { useEffect, useState } from "react";
import { gitService } from "../../services/gitService";
import type { SessionPhase } from "../../stores/sessionBuckets";

/** 监控卡「环境信息」区的数据：工作目录、当前分支、推送状态。 */
export interface MonitorEnvironment {
  /** 会话工作目录（绝对路径）；null = 还没绑目录。 */
  dir: string | null;
  /** 当前分支；非 git 仓库 / 读取失败为 null。 */
  branch: string | null;
  /** 推送状态；非仓库、无 remote 或读取失败为 null。 */
  push: { ahead: number; hasUpstream: boolean } | null;
}

const EMPTY: MonitorEnvironment = { dir: null, branch: null, push: null };

/**
 * 环境信息的取数：只在卡片可见时读，进会话 / 切换目录 / 每轮收口各读一次。
 *
 * 这里刻意不订阅 git push 事件（没有这种事件），也不做轮询：分支与推送状态
 * 只可能被"用户手动操作"或"agent 一轮任务"改变，这两个时机上面两个依赖都能覆盖；
 * 用户在卡片里提交/推送后由调用方递增 reloadTick 补一次。
 */
export function useMonitorEnvironment(
  cwd: string | null,
  phase: SessionPhase,
  active: boolean,
  reloadTick = 0,
): MonitorEnvironment {
  const [env, setEnv] = useState<MonitorEnvironment>(EMPTY);

  // biome-ignore lint/correctness/useExhaustiveDependencies: phase 是「每轮收口重读」的信号——agent 一轮任务能改分支与提交，但这里不直接读它的值；reloadTick 同理
  useEffect(() => {
    if (!active || !cwd) {
      setEnv(EMPTY);
      return;
    }
    let cancelled = false;
    setEnv((prev) => (prev.dir === cwd ? prev : { ...EMPTY, dir: cwd }));

    void Promise.allSettled([gitService.branches(cwd), gitService.pushPlan(cwd)]).then(
      ([branchResult, pushResult]) => {
        if (cancelled) return;
        setEnv({
          dir: cwd,
          branch: branchResult.status === "fulfilled" ? branchResult.value.current : null,
          push:
            pushResult.status === "fulfilled"
              ? { ahead: pushResult.value.ahead, hasUpstream: pushResult.value.hasUpstream }
              : null,
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [active, cwd, phase, reloadTick]);

  return env;
}
