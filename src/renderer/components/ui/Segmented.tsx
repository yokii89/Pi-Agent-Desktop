import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { prefersReducedMotion } from "../../utils/animation";
import { type GlideCancel, glide, glideSpring, mix } from "../../utils/glideMotion";
import { GLIDE_MOTION, SEGMENT_MOTION } from "../../utils/motionTokens";
import styles from "./Segmented.module.css";

export interface SegmentedItem<T extends string = string> {
  value: T;
  label: ReactNode;
  /** 行首图标：尺寸由站点按 Phosphor 档位自己传，滑块那层副本渲染的是同一个节点。 */
  icon?: ReactNode;
  /** 悬停说明（纯图标档必须有）。 */
  title?: string;
  /**
   * 可访问名。文案被收成图标（`display: none`）时可见名字就没了，
   * 侧栏那种响应式收文案的条必须显式给名字。
   */
  ariaLabel?: string;
  /** role=tab 档的面板配对（`aria-controls`）；页签自带 panel id 时要传。 */
  ariaControls?: string;
  disabled?: boolean;
}

/** 语义档位：各站点保持原有的读屏表达，不因换了控件形态而改变公告内容。 */
export type SegmentedSemantics = "toggle" | "tab" | "radio";

interface SegmentedProps<T extends string = string> {
  /** 受控值；null 表示当前没有落点（滑块收拢不可见）。 */
  value: T | null;
  items: readonly SegmentedItem<T>[];
  onChange: (value: T, index: number) => void;
  /** 读屏用途：控件没有伴随文字标签时必须传。 */
  ariaLabel?: string;
  semantics?: SegmentedSemantics;
  size?: "sm" | "md" | "lg";
  /** 等分槽位（默认）；false 则按文案宽度分槽。 */
  equal?: boolean;
  /** 项目数不固定、可能长过容器时开横向滚动。 */
  scrollable?: boolean;
  /** 撑满父容器（等分段占满一列的形态）；不要让站点自己覆盖 display/width。 */
  stretch?: boolean;
  disabled?: boolean;
  /** 站点附加类名：尺寸差异一律走 --seg-* 变量覆盖，不要直写 padding。 */
  className?: string;
  /**
   * Tab 可达档位：roving = 只有落点进 Tab 序（tab/radio 默认）、all = 每项都进（toggle 默认）、
   * none = 整组都不进（焦点归外部输入框的那类，如命令面板的档位标签）。
   */
  focusMode?: SegmentedFocusMode;
}

export type SegmentedFocusMode = "roving" | "all" | "none";

/** 一条裁剪边的状态：位置、解析速度、以及接管它的补间取消句柄。 */
interface Edge {
  v: number;
  vel: number;
  cancel: GlideCancel;
}

interface Slot {
  l: number;
  r: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const noop = (): void => {};

function indexOfValue<T extends string>(
  items: readonly SegmentedItem<T>[],
  value: T | null,
): number {
  if (value === null) return -1;
  return items.findIndex((item) => item.value === value);
}

/** 行只靠 data-seg-index 认领，副本层没有这个属性，查询不会命中两层。 */
function nodeAtIndex(track: HTMLElement | null, index: number): HTMLElement | null {
  return track?.querySelector<HTMLElement>(`[data-seg-index="${index}"]`) ?? null;
}

/** 张开：把一条边补间到位，中途被打断就从当前值接着走。 */
function tweenEdge(edge: Edge, to: number, duration: number, apply: () => void): void {
  edge.cancel();
  const from = edge.v;
  edge.cancel = glide({
    duration,
    onUpdate: (progress) => {
      const next = mix(from, to, progress);
      // 定帧轴每步恰好 1/fps 秒，速度直接由差值还原
      edge.vel = (next - edge.v) * GLIDE_MOTION.fps;
      edge.v = next;
      apply();
    },
    onComplete: () => {
      edge.v = to;
      edge.vel = 0;
      apply();
    },
  });
}

/** 落位：阻尼弹簧接管一条边，并把上一段的速度原样交进来，换向时才不会看到台阶。 */
function springEdge(
  edge: Edge,
  to: number,
  duration: number,
  velocity: number,
  apply: () => void,
  onSettled?: () => void,
): void {
  edge.cancel();
  edge.cancel = glideSpring({
    from: edge.v,
    to,
    duration,
    bounce: SEGMENT_MOTION.bounce,
    velocity,
    onUpdate: (next, nextVelocity) => {
      edge.v = next;
      edge.vel = nextVelocity;
      apply();
    },
    onComplete: () => {
      edge.v = to;
      edge.vel = 0;
      apply();
      onSettled?.();
    },
  });
}

/**
 * 横向分段控件（docs/design/52）：把「哪一项被选中」从一次背景色替换改成一条看得见的连续位移。
 *
 * 复刻的是 `docs/ui-design/rubber-segment-rubber-band.html` 的裁剪模型——滑块不是一块移动的元素，
 * 而是铺满整条轨道的一份文案副本，只由 `clip-path: inset(0 右 0 左 round 圆角)` 裁出左右两条边。
 * 于是"橡皮筋"就是两条边各自独立补间：先张开到同时罩住起点槽与终点槽，交接后前缘带着速度弹簧弹进
 * 目标槽，后缘多冲 `squash` 像素再松弛回去。文案不参与缩放，所以不会像 `scaleX` 那样把字拉糊。
 *
 * 两条边走 `utils/glideMotion` 的定帧时间轴（封顶 `GLIDE_MOTION.fps`），与浮层共用同一条曲线、
 * 同一处帧率真值；组件内不写时长字面量，时序全部登记在 `SEGMENT_MOTION`。
 * 键盘换档一律瞬移（连按方向键时补间会落后于光标），鼠标换档才演橡皮筋。
 *
 * 站点可用的公开钩子：
 * - `data-seg-root` / `data-seg-viewport`：需要自己量「带文案放不放得下」的响应式条用
 *   （右侧边栏靠它做纯图标折叠的滞回判定）；
 * - `data-seg-thumb`：唯一能碰到滑块那一层副本的选择器，用来给选中态的自定义墨色上色；
 * - 皮肤与尺寸只走 `--seg-*` 变量（默认值声明在 `:where()` 里，权重为 0，站点单类名即可覆盖）。
 */
export function Segmented<T extends string = string>({
  value,
  items,
  onChange,
  ariaLabel,
  semantics = "toggle",
  size = "md",
  equal = true,
  scrollable = false,
  stretch = false,
  disabled = false,
  className,
  focusMode,
}: SegmentedProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);

  const edgeL = useRef<Edge>({ v: 0, vel: 0, cancel: noop });
  const edgeR = useRef<Edge>({ v: 0, vel: 0, cancel: noop });
  const slots = useRef<Slot[]>([]);
  const box = useRef({ width: 0, radius: 0 });
  const generation = useRef(0);
  const handoff = useRef<number | undefined>(undefined);
  /** 键盘换档标记：只被下一次落位消费。 */
  const instant = useRef(false);

  const target = indexOfValue(items, value);
  const committed = useRef(target);
  // 补间跑在定时器与观察器里，读 ref 才不会拿到过期的那一份 items
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const apply = useCallback((): void => {
    const thumb = thumbRef.current;
    if (!thumb) return;
    const left = Math.max(0, edgeL.current.v);
    const right = Math.max(left, edgeR.current.v);
    thumb.style.clipPath =
      `inset(0 ${(box.current.width - right).toFixed(2)}px 0 ${left.toFixed(2)}px` +
      ` round ${box.current.radius.toFixed(2)}px)`;
  }, []);

  const jumpTo = useCallback(
    (index: number): void => {
      window.clearTimeout(handoff.current);
      edgeL.current.cancel();
      edgeR.current.cancel();
      generation.current += 1;
      const slot = slots.current[index];
      edgeL.current.v = slot ? slot.l : 0;
      edgeR.current.v = slot ? slot.r : 0;
      edgeL.current.vel = 0;
      edgeR.current.vel = 0;
      apply();
    },
    [apply],
  );

  const land = useCallback(
    (index: number, generationAt: number, withSquash: boolean): void => {
      const slot = slots.current[index];
      if (!slot) return;
      const mid = (edgeL.current.v + edgeR.current.v) / 2;
      // 往右走时前缘是右边、后缘是左边；过冲方向跟着这个符号翻一次
      const dir = Math.sign((slot.l + slot.r) / 2 - mid) || 1;
      const front = dir > 0 ? edgeR.current : edgeL.current;
      const back = dir > 0 ? edgeL.current : edgeR.current;
      const frontTo = dir > 0 ? slot.r : slot.l;
      const backTo = dir > 0 ? slot.l : slot.r;
      const carry = (edge: Edge): number =>
        clamp(edge.vel, -SEGMENT_MOTION.maxVelocity, SEGMENT_MOTION.maxVelocity);

      springEdge(front, frontTo, SEGMENT_MOTION.land, carry(front), apply);
      const backVelocity = carry(back);
      if (!withSquash || SEGMENT_MOTION.squash <= 0) {
        springEdge(back, backTo, SEGMENT_MOTION.land, backVelocity, apply);
        return;
      }
      springEdge(
        back,
        backTo + dir * SEGMENT_MOTION.squash,
        SEGMENT_MOTION.land,
        backVelocity,
        apply,
        () => {
          // 松弛只在还是这一轮时补，否则会把新落点又拽回去
          if (generation.current === generationAt) {
            springEdge(back, backTo, SEGMENT_MOTION.settle, 0, apply);
          }
        },
      );
    },
    [apply],
  );

  const travel = useCallback(
    (from: number, to: number): void => {
      const a = slots.current[from];
      const b = slots.current[to];
      if (!a || !b) {
        jumpTo(to);
        return;
      }
      window.clearTimeout(handoff.current);
      generation.current += 1;
      const generationAt = generation.current;
      if (prefersReducedMotion()) {
        jumpTo(to);
        return;
      }
      const stretch = SEGMENT_MOTION.stretch / 100;
      tweenEdge(
        edgeL.current,
        b.l + (Math.min(a.l, b.l) - b.l) * stretch,
        SEGMENT_MOTION.dilate,
        apply,
      );
      tweenEdge(
        edgeR.current,
        b.r + (Math.max(a.r, b.r) - b.r) * stretch,
        SEGMENT_MOTION.dilate,
        apply,
      );
      handoff.current = window.setTimeout(
        () => land(to, generationAt, true),
        SEGMENT_MOTION.handoff * 1000,
      );
    },
    [apply, jumpTo, land],
  );

  const measure = useCallback((): void => {
    const root = rootRef.current;
    const track = trackRef.current;
    if (!root || !track) return;
    // 用 offset* 而不是 getBoundingClientRect：前者是布局坐标，不受祖先 transform 影响。
    // 浮层入场时整块面板挂在 scale(0.95) 上，rect 会把槽位量小一档，而裁剪本来就活在元素自身坐标系里。
    box.current.width = track.offsetWidth;
    const rootStyle = getComputedStyle(root);
    const inset =
      (Number.parseFloat(rootStyle.borderLeftWidth) || 0) +
      (Number.parseFloat(rootStyle.paddingLeft) || 0);
    const radius = Number.parseFloat(rootStyle.borderTopLeftRadius);
    box.current.radius = Math.max(0, (Number.isNaN(radius) ? 0 : radius) - inset);
    slots.current = Array.from(track.querySelectorAll<HTMLElement>("[data-seg-index]"), (node) => ({
      l: node.offsetLeft,
      r: node.offsetLeft + node.offsetWidth,
    }));
    // 重测一律瞬移：拉窗口、换字体时演一段橡皮筋只会像是选错了项
    jumpTo(committed.current);
  }, [jumpTo]);

  /** 长条里把落点滚进视野：只动这层视口的 scrollLeft，不碰任何祖先滚动容器。 */
  const revealTarget = useCallback((index: number): void => {
    const viewport = viewportRef.current;
    const node = nodeAtIndex(trackRef.current, index);
    if (!viewport || !node) return;
    const left = node.offsetLeft;
    const right = left + node.offsetWidth;
    const viewEnd = viewport.scrollLeft + viewport.clientWidth;
    if (left < viewport.scrollLeft) viewport.scrollLeft = left;
    else if (right > viewEnd) viewport.scrollLeft = right - viewport.clientWidth;
  }, []);

  useLayoutEffect(() => {
    measure();
    const track = trackRef.current;
    if (!track) return;
    // 观察轨道而不是根节点：侧栏那种「根被 flex 钉死宽度、内容却收窄/展开」的变化，
    // 只有轨道的 max-content 宽度会跟着动；观察根节点会漏掉重测，滑块停在旧槽位上
    const observer = new ResizeObserver(() => measure());
    observer.observe(track);
    // 图标字体与中文回退字体到位后行宽会变，不重测副本就会错开半格
    let alive = true;
    document.fonts.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [measure]);

  // 值由外部改动（含对话框里被拒绝的改值回弹）都只走这一条路：动画跟着真相，不跟着点击
  useEffect(() => {
    const from = committed.current;
    if (from === target) return;
    committed.current = target;
    if (instant.current || !slots.current[from] || !slots.current[target]) jumpTo(target);
    else travel(from, target);
    revealTarget(target);
  }, [target, jumpTo, travel, revealTarget]);

  // 被拒绝的改值不会触发上面那条效果，标记在这里清掉，不留给下一次外部变化
  useEffect(() => {
    instant.current = false;
  });

  useEffect(
    () => () => {
      window.clearTimeout(handoff.current);
      edgeL.current.cancel();
      edgeR.current.cancel();
    },
    [],
  );

  /** 方向键跳过禁用的槽位。 */
  const stepFrom = (from: number, dir: number): number => {
    let next = from + dir;
    while (next >= 0 && next < itemsRef.current.length && itemsRef.current[next].disabled) {
      next += dir;
    }
    return next >= 0 && next < itemsRef.current.length ? next : from;
  };

  const edgeItem = (from: number, dir: number): number => {
    let i = dir > 0 ? 0 : itemsRef.current.length - 1;
    while (i >= 0 && i < itemsRef.current.length && itemsRef.current[i].disabled) i += dir;
    return i >= 0 && i < itemsRef.current.length ? i : from;
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled || items.length === 0) return;
    const at = target < 0 ? 0 : target;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = stepFrom(at, 1);
    else if (event.key === "ArrowLeft") next = stepFrom(at, -1);
    else if (event.key === "Home") next = edgeItem(at, 1);
    else if (event.key === "End") next = edgeItem(at, -1);
    if (next === null) return;
    event.preventDefault();
    if (next === at) return;
    instant.current = true;
    onChange(itemsRef.current[next].value, next);
    nodeAtIndex(trackRef.current, next)?.focus();
  };

  const sizeClass = size === "sm" ? styles.sm : size === "lg" ? styles.lg : styles.md;
  const rootClass = [
    styles.root,
    sizeClass,
    equal ? null : styles.auto,
    stretch ? styles.stretch : null,
    disabled ? styles.disabled : null,
    className,
  ].filter(Boolean);
  const focus = focusMode ?? (semantics === "toggle" ? "all" : "roving");
  const tabIndexFor = (index: number): number | undefined => {
    if (focus === "none") return -1;
    if (focus === "all") return undefined;
    // 没有落点时至少让首项能被 Tab 走到，否则整组对键盘消失
    return index === (target < 0 ? 0 : target) ? 0 : -1;
  };

  const selectedProps = (index: number) => {
    const on = index === target;
    if (semantics === "tab") return { role: "tab" as const, "aria-selected": on };
    if (semantics === "radio") return { role: "radio" as const, "aria-checked": on };
    return { "aria-pressed": on };
  };

  return (
    // role 由 semantics 动态给出（tablist / radiogroup / group），Biome 读不到字面量，
    // 会把带 onKeyDown 与 aria-label 的根节点误判成"静态元素挂交互"。
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useAriaPropsSupportedByRole: 动态 role 无法静态判定
    <div
      ref={rootRef}
      className={rootClass.join(" ")}
      data-seg-root=""
      role={
        semantics === "tab" ? "tablist" : semantics === "radio" ? "radiogroup" : ("group" as const)
      }
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
    >
      <div
        ref={viewportRef}
        data-seg-viewport=""
        className={scrollable ? `${styles.viewport} ${styles.scroll}` : styles.viewport}
      >
        <div ref={trackRef} className={styles.track}>
          {items.map((item, index) => (
            <button
              key={item.value}
              type="button"
              data-seg-index={index}
              className={index === target ? `${styles.item} ${styles.itemOn}` : styles.item}
              disabled={disabled || item.disabled}
              title={item.title}
              aria-label={item.ariaLabel}
              aria-controls={item.ariaControls}
              tabIndex={tabIndexFor(index)}
              onClick={() => onChange(item.value, index)}
              {...selectedProps(index)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          {/* 滑块：铺满轨道的一份副本，只靠 clip-path 裁出两条边，指针一律穿到真标签上。
              data-seg-thumb 是站点唯一能碰到这一层的钩子（选中态的自定义墨色要靠它）。 */}
          <span ref={thumbRef} className={styles.thumb} data-seg-thumb="" aria-hidden="true">
            {items.map((item) => (
              <span key={item.value} className={`${styles.item} ${styles.itemOn}`}>
                {item.icon}
                {item.label}
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
