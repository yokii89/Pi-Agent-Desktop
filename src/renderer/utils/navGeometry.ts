/**
 * 左侧导航栏几何（docs/design/137）：宽度夹取与轨道读数。
 *
 * 为什么和 `panelGeometry.ts` 分开：那一份是**唯一写入方**（网格三列 + 右侧两个面板）；
 * 两条把手都能拖，必须只有一个地方拼 `grid-template-columns`，否则后写的一方会把
 * 另一方正在补间/拖拽的列打回兜底值。本模块只提供「左栏能有多宽」的判定与读数，
 * 真正落盘仍是 `writePanelGeometry(root, { nav })`。
 *
 * 夹取方向与右栏相反：右栏的上限也由「中央区最小宽」决定，但左栏可以先吃掉右栏让出的
 * 空间——只要会话区还有 `NAV_MAIN_MIN_WIDTH`，就把多余宽度给左栏。
 */

import { clampNavWidth, NAV_WIDTH_MIN } from "../../shared/navWidth";

/** 中央区最小宽（px）：左栏上限 = 网格宽 - 右栏 - 该值，保证会话区始终可用。 */
export const NAV_MAIN_MIN_WIDTH = 560;

/**
 * 左栏宽度上限：网格总宽 - 右侧栏宽 - 中央区最小宽。
 *
 * 与起始宽度无关（不是「中央区左缘 x」）：那个值会随本栏自身宽度一起变，
 * 于是越拖越紧/越拖越松。结果仍抬到 `NAV_WIDTH_MIN`：窗口过窄时宁可挤压中央区，
 * 也不让侧栏塌成一条缝（与右栏 `clampWidth` 同序：先夹上限，再抬硬下限）。
 */
export function navMaxWidth(gridWidth: number, sidebarWidth: number): number {
  return Math.max(NAV_WIDTH_MIN, Math.floor(gridWidth - sidebarWidth - NAV_MAIN_MIN_WIDTH));
}

/** 把宽度夹进「网格允许区间」：先按可用空间夹上限，再交给 clampNavWidth 抬下限。 */
export function clampNavWidthToGrid(
  value: number,
  gridWidth: number,
  sidebarWidth: number,
): number {
  return clampNavWidth(Math.min(value, navMaxWidth(gridWidth, sidebarWidth)));
}

const toNumber = (raw: string | undefined): number => {
  const parsed = Number.parseFloat(raw ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
};

/** 网格根元素当前的实际列宽（左栏 / 中央区 / 右栏），读 computed 值而不是令牌。 */
export function readGridTracks(grid: HTMLElement): [number, number, number] {
  const [nav, main, aside] = getComputedStyle(grid).gridTemplateColumns.split(" ");
  return [toNumber(nav), toNumber(main), toNumber(aside)];
}
