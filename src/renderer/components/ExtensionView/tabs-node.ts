/**
 * tabs 节点的纯语义（docs/design/08 §5.1）：切换权分两层。
 * - Host 本地切换（点击 chip / ←→）先改渲染、不等扩展回包，同时用既有的 `action`
 *   信封把落点回报给扩展（见 `tabSwitchActionId`）；
 * - 扩展通过 update 携带 activeTab 显式接管（如答完自动前进）。
 *
 * 为什么回报走 action 而不是新事件类型：view/v1 的 actionId 是自由字符串，Host 不校验
 * 它是否声明在 spec.actions 里，扩展认得就处理、不认得就忽略。所以「扩展需要知道用户
 * 实际看到哪一页」（footer 主按钮目标、自动前进起点都按它算账）这个需求是零协议字段
 * 新增，老扩展配新 Host、新扩展配老 Host 两个方向都不必协商 capability。
 *
 * 显式接管只在「prop 与上次显式值不同」时生效：扩展的 change 回显总是携带
 * 它自己那份可能滞后的 activeTab，若每次回显都强制生效，用户本地切换会被
 * 弹回旧页签。因此 prop 等于上次显式值（或缺省）时维持本地状态。
 * 有了本地上报之后，扩展回显的 activeTab 通常已经跟用户所在页一致，
 * 于是这里多数情况下直接返回 null（不弹回、不抢焦点）。
 */

export interface ActiveTabState {
  activeId: string;
  /** 上一次从 prop 显式接管的值；undefined = 尚未接管过。 */
  lastExplicit: string | undefined;
}

/** 本地切页回报的 actionId 前缀；与扩展侧按钮的 `goto:` 族分开，避免撞语义。 */
export const TAB_SWITCH_ACTION_PREFIX = "tab:";

/** 本地切页 → 回报给扩展的 actionId（`tab:<页签 id>`，含 review 这类非数字 id）。 */
export function tabSwitchActionId(tabId: string): string {
  return `${TAB_SWITCH_ACTION_PREFIX}${tabId}`;
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
