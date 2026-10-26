/**
 * 侧栏动效的运行时开关与常驻路径。
 *
 * `import("gsap")` 是显式的动态 import：Vite/Rollup 会把它单独切块并按需加载，
 * 不与主 bundle 打包在一起——侧栏渲染不依赖它。侧栏挂载后会在启动空闲期经
 * `loadGsap()` 预热一次（SideNav），首次交互不必再等 chunk 下载。
 * 之所以不用 CSS：原生 `popover` / `details` 的展开动画在 Chromium 上行为不一致，
 * 且 `height: auto` 不可插值；高度收展走 glide() 定帧时间轴（useCollapseAnimation），
 * GSAP 只负责图标回弹、悬浮揭示这类小元素动效。
 */
export type Gsap = typeof import("gsap").gsap;

let gsapPromise: Promise<Gsap> | null = null;

/** 首次调用才加载 GSAP 主 chunk；后续复用同一 Promise。 */
export function loadGsap(): Promise<Gsap> {
  gsapPromise ??= import("gsap").then((mod) => mod.gsap);
  return gsapPromise;
}

/** 用户是否要求减少动效（系统级无障碍偏好）。 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
