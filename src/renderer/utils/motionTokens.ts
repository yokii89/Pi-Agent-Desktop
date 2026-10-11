/**
 * 侧栏动效令牌：时长与缓动集中在此，避免散落在各处。
 * 单位为秒（GSAP 约定）。新增加速/回弹曲线先在此登记。
 * 颜色与间距令牌见 styles/tokens.css，两者职责不同：这里只管"变化的节奏"。
 */
export const NAV_MOTION = {
  /** 折叠面板展开时长。 */
  collapseEnter: 0.28,
  /** 折叠面板收起时长（收起要更快，减少等待感）。 */
  collapseExit: 0.18,
  /** 折叠过程中内容的淡入淡出。 */
  fade: 0.16,
  /** 悬浮态微反馈（列表项左移、图标放大）。 */
  hover: 0.14,
  /**
   * 行内操作按钮的悬浮揭示延迟：快速扫过列表不闪按钮，停留才出现
   * （键盘聚焦不延迟；侧栏 CSS 里时间戳的淡出延迟与本值咬合，改动需两边同步）。
   */
  revealDelay: 0.1,
  /** 按下回弹。 */
  press: 0.12,
  /** 引用块落点高亮的淡出时长（docs/design/12 P1-2）。 */
  quoteFlash: 0.8,
  /** 分区标签切换时的横向补间。 */
  labelSlider: 0.24,
  /** 标准缓出（GSAP 幂次曲线）：用于"出现/展开"。 */
  easeOut: "power3.out",
  /** 标准缓入：用于"消失/收起"，让收尾更干脆。 */
  easeIn: "power2.in",
  /** 弹性缓出：用于"更多操作"等小元素出现。 */
  easeBack: "back.out(1.6)",
} as const;

/**
 * 下拉浮层动效令牌（docs/design/51，复刻 `docs/ui-design/glide-select-bezier.html`）。
 * 单位秒，与 NAV_MOTION 一致；数值由 utils/glideMotion 的独立时间轴消费，
 * 不走 CSS transition（CSS 表达不了帧率封顶），也不动全局 gsap.ticker（会连带侧栏动效降档）。
 */
export const GLIDE_MOTION = {
  /** 浮层动效统一封顶帧率。 */
  fps: 30,
  /** 贝塞尔控制点：菜单弹出、药丸滑行、箭头翻转共用同一条曲线。 */
  easeOut: [0.23, 1, 0.32, 1],
  /** 菜单入场（scale 0.95→1 + 淡入）。 */
  pop: 0.18,
  /** 菜单收起：入场时长的 2/3，收得比展开快。 */
  popOut: 0.12,
  /** 高亮药丸在条目之间滑行。 */
  glide: 0.22,
  /** 药丸淡入淡出（比滑行短，先亮再到位）。 */
  pillFade: 0.15,
  /** 触发器按压回弹。 */
  press: 0.16,
  /** 箭头翻转。 */
  chevron: 0.2,
  /** 选中值换字（淡入 + 去模糊）。 */
  swap: 0.16,
} as const;

/**
 * 冷启动进度条（PiColdStartBar，docs/会话进程懒加载方案 §4.2）：
 * 分段轨道爬行到 90% 封顶，进程就绪后补到 100% 再淡出卸载。
 */
export const COLD_START_MOTION = {
  /** 分段数（沿用动画原型的 24 段轨道）。 */
  segments: 24,
  /**
   * 爬行到 90% 的总时长：前快后慢（幂次缓出），冷启动通常 1–4s 内就绪，
   * 就绪即被打断收尾，不会真的播满。
   */
  crawl: 6,
  /** 就绪补到 100% 的时长。 */
  complete: 0.18,
  /** 100% 后淡出卸载的时长。 */
  fadeOut: 0.24,
  /** 爬行缓动：前快后慢，模拟"连接建立后趋于稳定"。 */
  easeCrawl: "power2.out",
  easeOut: "power3.out",
} as const;
