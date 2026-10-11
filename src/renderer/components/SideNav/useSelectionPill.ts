import { type RefObject, useCallback, useEffect, useRef } from "react";
import { type GlideCancel, glide, mix } from "../../utils/glideMotion";
import { GLIDE_MOTION } from "../../utils/motionTokens";

/** 页面级选中（顶部导航项 / 设置）优先于会话行：查询顺序即优先级。 */
const PAGE_TARGET = '[data-side-active="page"]';
const SESSION_TARGET = '[data-side-active="session"]';
/** 可被悬浮药丸指向的行：选项行 / 项目行 / 历史会话行。 */
const HOVER_TARGET = "[data-side-hover]";

/** 几何比对容差：亚像素布局读数的抖动不值得一次重对齐。 */
const GEOMETRY_EPSILON = 0.25;

interface PillRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const sameRect = (a: PillRect, b: PillRect): boolean =>
  Math.abs(a.x - b.x) <= GEOMETRY_EPSILON &&
  Math.abs(a.y - b.y) <= GEOMETRY_EPSILON &&
  Math.abs(a.width - b.width) <= GEOMETRY_EPSILON &&
  Math.abs(a.height - b.height) <= GEOMETRY_EPSILON;

const INITIAL_STATE = {
  rect: null as PillRect | null,
  opacity: 0,
  target: null as HTMLElement | null,
  /** 滑行起点记录的目标几何：结构变化时判断「落点是否已被布局挪走」。 */
  tweenTarget: null as PillRect | null,
  moving: false,
  /** 指针当前指向的行；离开侧栏即清空（药丸滑回选中行或淡出）。 */
  hoverRow: null as HTMLElement | null,
};

/**
 * 左侧边栏的「选中药丸」（docs/design/54）：顶部导航项（扩展 / MCP / 定时任务 / 设置）
 * 与历史会话行（置顶 / 项目嵌套 / 任务）共用同一块高亮底，沿下拉曲线
 * （`GLIDE_MOTION.easeOut`，定帧时间轴封顶 `GLIDE_MOTION.fps`）在行之间滑行。
 *
 * 药丸同时表达两层指向，单一写入方收敛到「有效落点 = 悬停行 ?? 选中行」：
 * - **悬浮跟随**：指针扫过 `data-side-hover` 行（选项 / 项目 / 历史）时药丸滑过去，
 *   跨行连续移动时是同一条连续滑行（对齐下拉药丸的擦选手感）；
 * - **选中落位**：离开侧栏后药丸滑回 `data-side-active` 选中行——这里不能像下拉的
 *   `rememberPosition` 那样停在原地，因为侧栏药丸还承担选中高亮，行上的选中底色已删。
 *   指向非药丸行（分区头、显示更多、空态行）时药丸保持原位，不做两次语义。
 *
 * 与 `useGlidePill`（下拉列表的指向药丸）的分工：下拉行自身透明、悬浮/擦选全归药丸；
 * 侧栏行的 ⋯ 揭示、标题位移、悬浮卡等反馈仍由行自己承担，药丸只接管「指向哪一行」
 * 的底色。没有实现按住擦选：侧栏行按住拖动跨行松手会误触发打开会话。
 *
 * 落点时机全部由 DOM / 指针事件说话（hook 不知道选中真值是哪几个 store 字段）：
 * 标记换行（page / settingsOpen / activeSessionFile 变化）是 `data-side-active`
 * 属性变更，分区折叠展开、「显示更多」、会话增删是节点增删，都由 MutationObserver
 * 驱动；悬浮由 pointerover / pointerleave 驱动。落点逻辑统一：目标行没变就按当前
 * 几何对齐（行被布局挪动），变了才滑行/瞬移（瞬移只认「没有停驻目标」或「正在淡出」）。
 *
 * 几何用 getBoundingClientRect 差值 + 滚动补偿，而不是 offsetTop：
 * 不依赖「nav 恰好是行的 offsetParent」，未来任何中间层挂上定位都不静默漂移；
 * 侧栏全程没有 scale 变换（折叠是高度补间），rect 不存在 doc 52 量小的坑。
 */
export function useSelectionPill(nav: HTMLElement | null): {
  pillRef: RefObject<HTMLSpanElement | null>;
} {
  const pillRef = useRef<HTMLSpanElement>(null);
  const state = useRef({ ...INITIAL_STATE });
  const moveTween = useRef<GlideCancel>(() => {});
  const fadeTween = useRef<GlideCancel>(() => {});

  const apply = useCallback((): void => {
    const pill = pillRef.current;
    const { rect, opacity } = state.current;
    if (!pill || !rect) return;
    pill.style.transform = `translate(${rect.x.toFixed(2)}px, ${rect.y.toFixed(2)}px)`;
    pill.style.width = `${rect.width.toFixed(2)}px`;
    pill.style.height = `${rect.height.toFixed(2)}px`;
    pill.style.opacity = String(opacity);
  }, []);

  const measure = useCallback(
    (row: HTMLElement): PillRect | null => {
      if (!nav?.isConnected) return null;
      const navRect = nav.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      // 坐标落在滚动内容上：药丸是滚动容器（.nav）的绝对定位子元素，随内容一起滚
      return {
        x: rowRect.left - navRect.left + nav.scrollLeft,
        y: rowRect.top - navRect.top + nav.scrollTop,
        width: rowRect.width,
        height: rowRect.height,
      };
    },
    [nav],
  );

  const retarget = useCallback(() => {
    if (!nav?.isConnected) return;
    const { hoverRow } = state.current;
    const row = hoverRow?.isConnected
      ? hoverRow
      : (nav.querySelector<HTMLElement>(PAGE_TARGET) ??
        nav.querySelector<HTMLElement>(SESSION_TARGET));
    const current = state.current;

    if (!row) {
      // 目标行不在 DOM（所在分区折叠、会话被删、无选中且指针已离开）：淡出，回来再瞬移落位
      if (!current.target && current.opacity === 0) return;
      current.target = null;
      current.moving = false;
      current.tweenTarget = null;
      moveTween.current();
      if (current.opacity <= 0) return;
      const from = current.opacity;
      fadeTween.current();
      fadeTween.current = glide({
        duration: GLIDE_MOTION.pillFade,
        onUpdate: (p) => {
          current.opacity = mix(from, 0, p);
          apply();
        },
      });
      return;
    }

    const rect = measure(row);
    if (!rect) return;

    if (current.target === row) {
      const baseline = current.moving ? current.tweenTarget : current.rect;
      if (baseline && sameRect(baseline, rect)) return;
      if (!current.moving) {
        // 布局把行挪动了（上方分区折叠/展开、列表增删）：这是几何修正，
        // 行的位置变化本身不是一次"选中切换"，直接对齐，不演成滑行
        current.rect = rect;
        apply();
        return;
      }
      // 滑行途中落点漂移：落到下方通用滑行路径，从当前视觉值重新起算
    } else {
      moveTween.current();
      fadeTween.current();
    }

    const fromRect = current.rect;
    // 首次出现（没有停驻目标）/ 正在淡出时直接落位：从一段看不见的旧位置滑过来
    // 会被读成「选错了行」；正常换行必须走滑行，这里判错就会把整条曲线短路成瞬移
    const jump = current.target === null || current.opacity < 1 || !fromRect;
    current.target = row;
    current.tweenTarget = rect;

    if (jump) {
      current.moving = false;
      moveTween.current();
      current.rect = rect;
    } else {
      current.moving = true;
      const startX = fromRect.x;
      const startY = fromRect.y;
      const startWidth = fromRect.width;
      const startHeight = fromRect.height;
      moveTween.current();
      moveTween.current = glide({
        duration: GLIDE_MOTION.glide,
        onUpdate: (p) => {
          const target = current.tweenTarget;
          if (!target) return;
          current.rect = {
            x: mix(startX, target.x, p),
            y: mix(startY, target.y, p),
            width: mix(startWidth, target.width, p),
            height: mix(startHeight, target.height, p),
          };
          apply();
        },
        onComplete: () => {
          current.moving = false;
          current.tweenTarget = null;
        },
      });
    }

    if (current.opacity < 1) {
      const from = current.opacity;
      fadeTween.current();
      fadeTween.current = glide({
        duration: GLIDE_MOTION.pillFade,
        onUpdate: (p) => {
          current.opacity = mix(from, 1, p);
          apply();
        },
      });
    }
    apply();
  }, [apply, measure, nav]);

  // 落点触发全在 DOM / 指针上：标记换行（属性）与结构增删（子树）走 MutationObserver，
  // 悬浮跟随走 pointerover / pointerleave（同一套落点逻辑，滑行/瞬移判定不区分来源）
  useEffect(() => {
    if (!nav) return;
    retarget();
    const onPointerOver = (event: PointerEvent): void => {
      // 触屏的点按即选中，不需要"指向"层；桌面指针才驱动药丸
      if (event.pointerType === "touch") return;
      const row =
        event.target instanceof Element ? event.target.closest<HTMLElement>(HOVER_TARGET) : null;
      if (!row || row === state.current.hoverRow) return;
      state.current.hoverRow = row;
      retarget();
    };
    const onPointerLeave = (): void => {
      if (!state.current.hoverRow) return;
      state.current.hoverRow = null;
      retarget();
    };
    const observer = new MutationObserver(retarget);
    observer.observe(nav, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-side-active"],
    });
    nav.addEventListener("pointerover", onPointerOver);
    nav.addEventListener("pointerleave", onPointerLeave);
    return () => {
      observer.disconnect();
      nav.removeEventListener("pointerover", onPointerOver);
      nav.removeEventListener("pointerleave", onPointerLeave);
      moveTween.current();
      fadeTween.current();
      state.current = { ...INITIAL_STATE };
    };
  }, [nav, retarget]);

  return { pillRef };
}
