/**
 * 文本写盘的判定部分（docs/design/141）——不碰 fs / electron，便于纯测。
 *
 * 两件事必须在主进程拍板，渲染层说了不算：
 * 1. **冲突**：渲染层传来的是「我以为磁盘上是什么 mtime」，真实值只能由主进程 stat 得到；
 *    把 stat 放渲染层再回传等于让"想覆盖的人自己盖章"。
 * 2. **体量**：侧栏只做轻量就地编辑，超大内容该交给真正的编辑器，不该由一次 IPC 拖过来。
 */

/** 单次写盘上限（8MB）：远大于侧栏 1MB 的读取上限，留出粘贴扩充的余量。 */
export const MAX_WRITE_BYTES = 8 * 1024 * 1024;

export type TextSavePlan = { status: "write" } | { status: "conflict"; mtimeMs: number };

export interface TextSaveInput {
  /** 磁盘现状 mtime（ms，主进程刚 stat 得到）。 */
  diskMtimeMs: number;
  /** 渲染层持有的基线 mtime（打开 / 上次保存时读到的值）。 */
  expectedMtimeMs: number;
  /** 用户已确认覆盖。 */
  force: boolean;
  /** 待写入内容的 UTF-8 字节数。 */
  byteLength: number;
}

/**
 * 判定这次保存能不能写。
 *
 * mtime 取整后比较：`fs.Stats.mtimeMs` 是浮点毫秒，同一时刻两个来源可能差一点点小数，
 * 直接 `===` 会把"没改过"误判成冲突。NTFS 的精度远高于 1ms，取整不会漏掉真实改动。
 */
export function planTextSave(input: TextSaveInput): TextSavePlan {
  if (!Number.isFinite(input.byteLength) || input.byteLength < 0) {
    throw new Error("写入内容无效");
  }
  if (input.byteLength > MAX_WRITE_BYTES) {
    throw new Error(`文件超过 ${Math.round(MAX_WRITE_BYTES / 1024 / 1024)}MB，侧栏不支持保存`);
  }
  if (input.force) return { status: "write" };
  // 没有合法基线（老渲染层 / 手工构造的请求）：不拦，退化到"直接覆盖"
  if (!Number.isFinite(input.expectedMtimeMs)) return { status: "write" };
  if (Math.round(input.diskMtimeMs) !== Math.round(input.expectedMtimeMs)) {
    return { status: "conflict", mtimeMs: input.diskMtimeMs };
  }
  return { status: "write" };
}
