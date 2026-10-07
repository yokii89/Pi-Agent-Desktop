import type { PideskGlobalApi } from "../global.d";

/** 取 window.pidesk API；preload 未就绪时返回 null（各 service 自行降级）。 */
export function pideskApi(): PideskGlobalApi | null {
  return window.pidesk ?? null;
}
