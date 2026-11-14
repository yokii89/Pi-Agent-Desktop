/**
 * 「会话是否可能还在等某个后台进程」的旁路登记（docs/design/138 §3.4）。
 *
 * 为什么需要它：`busy` 只覆盖「agent 正在跑」这一种运行形态，而有一种形态会**长时间**
 * 落在 `idle` 上——模型用 `bash_job` 起了后台作业（pi-bash-jobs，docs/design/129/133），
 * 作业没结束时 turn 已经交还，session 的 runtime 状态就是 `idle`。
 * 15 小时下载、转码、`docker pull` 都属于这一类：会话看上去"停了 8 小时"，
 * 实际上仍在等一条命令回执。按空闲回收掉它，等于把用户的长任务连根拔掉。
 *
 * 查询走 procService.hasBackgroundWork：完整 bash 边界、未认领项、忽略项与新鲜进程快照。
 * service / job 的展示启发式不足以证明没有工作，证据缺失时也必须保留。
 *
 * 为什么放独立模块：procService → session 已有依赖（`piSession` 在 dispose 时调
 * `procService.noteSessionDisposed`），反向再 import 会成环。这里只持有一个可注入的查询函数，
 * 由 `procService` 初始化时注入（同 `setScheduledOccupancy` 的做法）。
 */

import type { SessionId } from "../../shared/contribution";

/** true = 仍有后台工作或无法确认；只接受明确的 false 作为回收依据。 */
type BackgroundJobProbe = (sessionId: SessionId) => boolean | Promise<boolean>;

const UNKNOWN_BACKGROUND_JOBS: BackgroundJobProbe = () => true;

let probe: BackgroundJobProbe = UNKNOWN_BACKGROUND_JOBS;

/** 注入后台进程存活查询（procService 初始化时调用）；返回解绑函数。 */
export function setBackgroundJobProbe(fn: BackgroundJobProbe): () => void {
  probe = fn;
  return () => {
    if (probe === fn) probe = UNKNOWN_BACKGROUND_JOBS;
  };
}

/**
 * 该会话是否还有存活的后台进程（= 可能仍在等命令回执）。
 * 未注入、查询失败或返回未知值时保留进程。
 */
export async function hasLiveBackgroundJobs(sessionId: SessionId): Promise<boolean> {
  try {
    return (await probe(sessionId)) !== false;
  } catch {
    // 查询失败按「有」处理更安全：宁可少回收一次，也不要杀掉正在等结果的会话
    return true;
  }
}

/** 测试用。 */
export function __resetBackgroundJobsForTests(): void {
  probe = UNKNOWN_BACKGROUND_JOBS;
}
