/**
 * tabs 节点的纯语义（docs/design/08 §5.1）：切换权分两层。
 * - Host 本地切换（点击 chip / ←→）不产生事件、不经过扩展；
 * - 扩展通过 update 携带 activeTab 显式接管（如答完自动前进）。
 *
 * 显式接管只在「prop 与上次显式值不同」时生效：扩展的 change 回显总是携带
 * 它自己那份可能滞后的 activeTab，若每次回显都强制生效，用户本地切换会被
 * 弹回旧页签。因此 prop 等于上次显式值（或缺省）时维持本地状态。
 */

export interface ActiveTabState {
  activeId: string;
  /** 上一次从 prop 显式接管的值；undefined = 尚未接管过。 */
  lastExplicit: string | undefined;
}

/** 返回 null 表示无需变更（本地状态继续生效）。 */
export function reconcileActiveTab(
  current: ActiveTabState,
  prop: string | undefined,
): ActiveTabState | null {
  if (prop === undefined || prop === current.lastExplicit) return null;
  return { activeId: prop, lastExplicit: prop };
}

/** 环绕步进：←→ 在页签间、↑↓ 在选项间循环。 */
export function wrappedStep(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((index + delta) % length) + length) % length;
}
