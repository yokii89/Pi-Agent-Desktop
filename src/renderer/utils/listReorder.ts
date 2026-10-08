/** 附件条拖拽排序的纯列表变换（docs/design/21 P2 / 25）。 */
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
