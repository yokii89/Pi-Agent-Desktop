/** 拖拽排序的纯列表变换（附件条 docs/design/21 P2 / 25；侧栏项目 docs/design/108）。 */
export function moveById<T extends { id: string }>(
  list: readonly T[],
  fromId: string,
  toId: string,
): T[] {
  const from = list.findIndex((item) => item.id === fromId);
  const to = list.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0 || from === to) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (!moved) return [...list];
  next.splice(to, 0, moved);
  return next;
}

/** 一行在屏幕上的纵向占位：只用中线判定指针越过了哪几行。 */
export interface RowBand {
  top: number;
  height: number;
}

/**
 * 指针 Y 的插入位（0..bands.length，含被拖行本身）：越过某行中线就排到它后面。
 * 变高行（带展开子列表的项目组）只量「行自身」，子列表不参与判定，
 * 指针落在别人展开的历史里会被读成「已越过该项目的标题行」。
 */
export function insertionIndexAt(bands: readonly RowBand[], y: number): number {
  let insert = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    if (band && y > band.top + band.height / 2) insert = index + 1;
  }
  return insert;
}

/** 插入位 → 拖拽落点下标：拖回自己的原位（前后两个槽位）都算原地不动。 */
export function dropTargetIndex(insert: number, from: number): number {
  return insert > from ? insert - 1 : insert;
}

/** 按目标下标移动一项（拖拽落点 / 上移下移用）：目标越界夹取，from 非法时原样返回。 */
export function moveToIndex<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...list];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}
