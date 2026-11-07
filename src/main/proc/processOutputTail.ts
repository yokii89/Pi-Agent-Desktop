/**
 * 作业日志增量 tail（方案 B）。
 *
 * 详情页签可见时按固定间隔轮读日志文件的字节增量，直接推给渲染层（每次 tick
 * 至多一条 data 消息，间隔即合批窗口）；作业在快照里翻到 settled 且文件静默
 * 超过宽限期后推 ended 并自动停止。生命周期由渲染层驱动：页签隐藏、切换选中、
 * 卸载都要 outputStop——tail 停了只是不读，日志文件本身照常增长。
 */

import type { ManagedProcess, ProcOutputPushMessage } from "../../shared/ipc";
import { PROC_OUTPUT_TAIL_CAP } from "../../shared/ipc";

/** 作业结束后文件静默多久才推 ended（给 tee 的 flush debounce 留时间）。 */
export const ENDED_IDLE_MS = 2_000;
/** 文件消失（作业清了日志）连续多少个 tick 后按结束处理。 */
const MISSING_LIMIT = 3;

/** 纯函数：上次偏移 + 当前文件大小 → 本次读取范围；无增量返回 null。 */
export function nextReadRange(
  prevOffset: number,
  fileSize: number,
  headCap: number = PROC_OUTPUT_TAIL_CAP,
): { start: number; end: number; truncated: boolean } | null {
  if (!Number.isFinite(fileSize) || fileSize <= 0) return null;
  // 文件比上次读到的还小：被截断重写（测试/用户清理），从尾部重读
  if (prevOffset > fileSize) {
    return { start: Math.max(0, fileSize - headCap), end: fileSize, truncated: true };
  }
  if (prevOffset === fileSize) return null;
  if (prevOffset === 0) {
    // 首读：只要尾部（完整历史看「打开日志文件」）
    return { start: Math.max(0, fileSize - headCap), end: fileSize, truncated: false };
  }
  // 增量超过 headCap 时只留尾部一段（渲染层本来也只展示尾部），中间段跳过
  const start = Math.max(prevOffset, fileSize - headCap);
  return { start, end: fileSize, truncated: false };
}

export interface ProcOutputTailerDeps {
  /** 读 [start, end) 字节并按 utf8 解码；注入便于测试。 */
  readSlice(path: string, start: number, end: number): Promise<string>;
  /** 文件大小；文件不存在 / 不可 stat 返回 null。 */
  sizeOf(path: string): number | null;
  now(): number;
  /** 轮询间隔；缺省 300ms（即推送合批窗口）。 */
  intervalMs?: number;
  /** 登记项对应的作业是否仍在 running / orphaned；快照读不到返回 null（不据此收尾）。 */
  isJobLive(id: string): boolean | null;
}

export type ProcOutputPush = (message: ProcOutputPushMessage) => void;

interface TailState {
  proc: ManagedProcess;
  path: string;
  offset: number;
  lastAppendAt: number;
  missing: number;
  timer: ReturnType<typeof setInterval>;
}

export class ProcOutputTailer {
  private readonly tails = new Map<string, TailState>();

  constructor(private readonly deps: ProcOutputTailerDeps) {}

  /** 同一登记项重复 start 幂等；日志路径变化（作业换代）时重启 tail。 */
  start(proc: ManagedProcess, path: string, push: ProcOutputPush): void {
    const existing = this.tails.get(proc.id);
    if (existing) {
      if (existing.path === path) return;
      clearInterval(existing.timer);
      this.tails.delete(proc.id);
    }
    const timer = setInterval(() => {
      void this.tick(proc.id, push);
    }, this.deps.intervalMs ?? 300);
    // tail 定时器不阻止应用退出（与 pi 侧快照定时器同一姿态）
    timer.unref?.();
    this.tails.set(proc.id, {
      proc,
      path,
      offset: 0,
      lastAppendAt: this.deps.now(),
      missing: 0,
      timer,
    });
  }

  stop(id: string): void {
    const state = this.tails.get(id);
    if (!state) return;
    clearInterval(state.timer);
    this.tails.delete(id);
  }

  stopAll(): void {
    for (const state of this.tails.values()) clearInterval(state.timer);
    this.tails.clear();
  }

  private async tick(id: string, push: ProcOutputPush): Promise<void> {
    const state = this.tails.get(id);
    if (!state) return;
    const now = this.deps.now();
    const live = this.deps.isJobLive(id);
    const size = this.deps.sizeOf(state.path);
    if (size === null) {
      state.missing += 1;
      // 文件还没创建（作业尚无输出）时继续等；连续消失且作业确已结束才收尾
      if (state.missing >= MISSING_LIMIT && live === false) this.end(state, push);
      return;
    }
    state.missing = 0;
    const range = nextReadRange(state.offset, size);
    if (range) {
      try {
        const text = await this.deps.readSlice(state.path, range.start, range.end);
        state.offset = range.end;
        if (text.length > 0) {
          state.lastAppendAt = now;
          push({
            sessionId: state.proc.sessionId,
            id: state.proc.id,
            type: "data",
            payload: text,
          });
        }
      } catch {
        // 单次读失败下一轮再试；tail 是增强通道，不抛进页签
      }
    }
    if (live === false && now - state.lastAppendAt > ENDED_IDLE_MS) {
      this.end(state, push);
    }
  }

  private end(state: TailState, push: ProcOutputPush): void {
    clearInterval(state.timer);
    this.tails.delete(state.proc.id);
    push({ sessionId: state.proc.sessionId, id: state.proc.id, type: "ended", payload: "" });
  }
}
