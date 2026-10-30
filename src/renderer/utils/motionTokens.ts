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
  /** 浮层动效统一封顶帧率（60 = 在 60Hz 屏上等于不封顶，高刷屏上仍锁在 60）。 */
  fps: 60,
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
 * 横向分段控件的橡皮筋动效令牌（docs/design/52，复刻 `docs/ui-design/rubber-segment-rubber-band.html`）。
 * 曲线复用 GLIDE_MOTION.easeOut、时间轴复用 glideMotion（同为封顶 60fps），
 * 这里只管"两条边各自怎么走"的时序——滑块不是移动的元素，而是被 clip-path 裁出来的文案副本。
 */
export const SEGMENT_MOTION = {
  /** 张开：两条边先撑到能同时罩住起点槽与终点槽。 */
  dilate: 0.19,
  /** 交接时刻：张开演到这里就让前缘带着速度弹进目标槽，后缘还在原地。 */
  handoff: 0.15,
  /** 前缘弹入时长（临界阻尼，到位不外弹）。 */
  land: 0.3,
  /** 后缘冲过目标边之后的松弛时长。 */
  settle: 0.16,
  /** 落位弹簧的回弹系数（ζ = 1 - bounce）；0 为临界阻尼。 */
  bounce: 0,
  /** 后缘过冲像素：多冲这么多再松弛回去，就是橡皮筋"扯一下"的那下。 */
  squash: 3,
  /** 张开幅度（100 = 恰好罩住起点槽与终点槽的并集，0 = 没有橡皮筋）。 */
  stretch: 100,
  /** 半途被打断时允许接管的最大边速度（px/s），防止连续点击把滑块甩出轨道。 */
  maxVelocity: 2000,
} as const;

/**
 * 发送键形变（箭头 ↔ 停止方块，复刻 docs/ui-design/prompt-bar-micro-interactions.html 的形变）：
 * 7 个顶点在两个形状间插值，中途叠加 sin(πt) 的挤压与倾斜，于是"发送"与"停止"互相变成对方。
 * 缓动刻意用两端慢中间快的形变曲线，与浮层 easeOut（快速到位）不同——形变要"看到过程"。
 */
export const SEND_MOTION = {
  /** 形变时长。 */
  morph: 0.24,
  /** 中途挤压幅度：scale(sx, 1/sx)，sx = 1 - squash·sin(πt)。 */
  squash: 0.12,
  /** 中途倾斜峰值（deg），方向随形变方向翻转。 */
  tilt: 8,
  /** 形变缓动控制点（设计稿 EASE_IN_OUT），供 makeCubicBezier 消费。 */
  ease: [0.77, 0, 0.175, 1],
} as const;

/**
 * 排队托盘进出场（docs/design/95，方案 1「抽屉升出」）：
 * 高度 0→实测 H 的定帧补间，顶缘带着托盘自己的边框上移，底边始终被输入卡压住；
 * 队列增减时用 resize 续接，收起比展开快。收起曲线为缓入（起步慢、收尾利落）。
 */
export const QUEUE_TRAY_MOTION = {
  enter: 0.26,
  exit: 0.19,
  /** 队列条数变化（展开态追加 / 交付）的高度续接。 */
  resize: 0.18,
  easeIn: [0.4, 0, 1, 1],
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
