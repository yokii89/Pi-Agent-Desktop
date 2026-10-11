import {
  ArrowsClockwise,
  Cookie,
  DeviceMobile,
  DeviceTablet,
  DotsThree,
  Files,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Monitor,
  SignIn,
  Toolbox,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGlideOverlay } from "../../../../hooks/useGlideOverlay";
import { useGlidePill } from "../../../../hooks/useGlidePill";
import { useT } from "../../../../hooks/useT";
import { browserService } from "../../../../services/browserService";
import { useBrowserStore, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../../../../stores/browserStore";
import {
  handoffOverlaySuppress,
  prepareOverlayFreeze,
  releaseOverlayFreeze,
} from "../../../../utils/overlayFreeze";
import glideStyles from "../../../ui/GlideList.module.css";
import { IconButton } from "../../../ui/IconButton";
import styles from "./BrowserMoreMenu.module.css";
import { ImportLoginDialog } from "./ImportLoginDialog";

/** 面板与触发按钮的垂直间隔。 */
const GAP = 6;
/** 贴视口边缘的安全距离。 */
const VIEWPORT_MARGIN = 8;
/** 菜单自身的抑制来源。 */
const SUPPRESS_REASON = "moreMenu";
/** 导入对话框的抑制来源（与 ImportLoginDialog 保持一致）。 */
const IMPORT_SUPPRESS_REASON = "loginImport";

/** 视口预设（P1-4）；desktop = 跟随面板宽度。 */
const VIEWPORT_PRESETS = [
  { key: "mobile", label: "Mobile", width: 390, icon: DeviceMobile },
  { key: "tablet", label: "Tablet", width: 768, icon: DeviceTablet },
  { key: "desktop", label: "Desktop", width: null, icon: Monitor },
] as const;

/**
 * 「更多」菜单：触发按钮 + 真正的浮层（portal + fixed）。
 *
 * WebContentsView 是原生合成层，会盖住渲染层浮层，打开时需藏掉页面视图。
 * 防闪：先截冻结帧并画在宿主区，再 suppress（见 prepareOverlayFreeze）。
 *
 * 三态 `phase` 而不是布尔 `open`：收起要演完 120ms 动画再卸载，而**抑制释放必须等面板真的没了**
 * ——视图先挂回来会把淡出中的面板直接盖掉。所以释放挂在 `phase → closed` 边沿上，
 * 而不是"用户点了关闭"那一刻（docs/design/43 的时序契约因此保持不变，只是多撑 120ms 冻结帧）。
 */
export function BrowserMoreMenu() {
  const t = useT();
  const store = useBrowserStore();
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const [importOpen, setImportOpen] = useState(false);
  const openingRef = useRef(false);
  const hadPanelRef = useRef(false);
  /** 已交接给导入对话框：菜单关闭时只摘 moreMenu，保留冻结帧。 */
  const handingOffRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = phase === "open";

  // 仅在面板真正落地到 closed 时恢复；不把 store 放进依赖，避免无关重渲染误清冻结帧
  // biome-ignore lint/correctness/useExhaustiveDependencies: setOverlayFreeze 稳定；此 effect 只关心面板卸载边沿
  useEffect(() => {
    if (phase !== "closed") {
      hadPanelRef.current = true;
      return;
    }
    if (!hadPanelRef.current) return;
    hadPanelRef.current = false;
    if (handingOffRef.current) {
      handingOffRef.current = false;
      // 仅释放菜单原因；loginImport 仍抑制，冻结帧留给对话框
      void browserService.setOverlaySuppressed(false, SUPPRESS_REASON);
      return;
    }
    releaseOverlayFreeze(SUPPRESS_REASON, store.setOverlayFreeze);
  }, [phase]);

  const openMenu = (): void => {
    if (phase !== "closed" || openingRef.current) return;
    openingRef.current = true;
    void (async () => {
      try {
        await prepareOverlayFreeze(SUPPRESS_REASON, store.setOverlayFreeze);
        setPhase("open");
      } catch {
        browserService.setOverlaySuppressed(true, SUPPRESS_REASON);
        setPhase("open");
      } finally {
        openingRef.current = false;
      }
    })();
  };

  /** `glide: false` 用于交给导入对话框：那里要立刻把冻结帧让给 Modal，不能多演一拍。 */
  const beginClose = useCallback(
    (glide = true): void => {
      if (phase === "closed") return;
      if (!glide || phase === "closing") {
        setPhase("closed");
        return;
      }
      setPhase("closing");
    },
    [phase],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      beginClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") beginClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, beginClose]);

  return (
    <>
      <IconButton
        ref={triggerRef}
        title={t("browser.moreTrigger")}
        active={open}
        aria-expanded={phase !== "closed"}
        aria-haspopup="menu"
        onClick={() => {
          if (phase !== "closed") beginClose();
          else openMenu();
        }}
      >
        <DotsThree size={16} weight="regular" />
      </IconButton>
      {phase !== "closed" &&
        createPortal(
          <MoreMenuPanel
            panelRef={panelRef}
            anchor={triggerRef.current}
            closing={phase === "closing"}
            onClosedNow={() => setPhase("closed")}
            onClose={() => beginClose()}
            onImportLogin={() => {
              // 先把抑制权交给对话框，再关菜单：避免视图短暂恢复盖住 Modal
              handingOffRef.current = true;
              void (async () => {
                await handoffOverlaySuppress(IMPORT_SUPPRESS_REASON, SUPPRESS_REASON);
                setImportOpen(true);
                beginClose(false);
              })();
            }}
          />,
          document.body,
        )}
      <ImportLoginDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

/** 菜单面板：贴「…」下方、右对齐；放不下则翻到上方。进出场都走浮层定帧补间（docs/design/51）。 */
function MoreMenuPanel({
  panelRef,
  anchor,
  closing,
  onClosedNow,
  onClose,
  onImportLogin,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  anchor: HTMLElement | null;
  /** 父级请求收起：面板自己演完出场动画再通知卸载。 */
  closing: boolean;
  onClosedNow: () => void;
  onClose: () => void;
  onImportLogin: () => void;
}) {
  const t = useT();
  const overlay = useGlideOverlay(panelRef);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    // 用布局盒尺寸而非 getBoundingClientRect：入场补间期间盒子带着 scale，会量小一档
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let top = rect.bottom + GAP;
    let vOrigin = "top";
    if (top + height > viewportH - VIEWPORT_MARGIN) {
      const above = rect.top - GAP - height;
      if (above >= VIEWPORT_MARGIN) {
        top = above;
        vOrigin = "bottom";
      } else top = Math.max(VIEWPORT_MARGIN, viewportH - height - VIEWPORT_MARGIN);
    }
    let left = rect.right - width;
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    if (left + width > viewportW - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, viewportW - width - VIEWPORT_MARGIN);
    }

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    // 面板右缘对齐触发按钮：缩放要从贴着按钮的那一角长出
    panel.style.transformOrigin = `${vOrigin} right`;

    overlay.prime();
    overlay.enter();
  }, [anchor, overlay, panelRef]);

  // 出场只演一次：动画期间父级可能因 store 更新重渲染，重演会把淡到一半的面板拉回去
  const exiting = useRef(false);
  useEffect(() => {
    if (!closing || exiting.current) return;
    exiting.current = true;
    overlay.exit(onClosedNow);
  }, [closing, overlay, onClosedNow]);

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      data-overlay-panel=""
      role="menu"
      aria-label={t("browser.more")}
    >
      <MenuBody onClose={onClose} onImportLogin={onImportLogin} />
    </div>
  );
}

/** 菜单内容：强制刷新 / DevTools / 登录态导入 / 缩放 / 视口 / 清理。 */
function MenuBody({ onClose, onImportLogin }: { onClose: () => void; onImportLogin: () => void }) {
  const t = useT();
  const store = useBrowserStore();
  const zoomPercent = Math.round(store.zoomFactor * 100);
  const listRef = useRef<HTMLDivElement>(null);
  /** 可点行的动作，下标与 data-glide-index 对齐（缩放/视口是控件行，不占行序）。 */
  const picks = useRef<(() => void)[]>([]);
  const pill = useGlidePill(listRef, { onPick: (index) => picks.current[index]?.() });
  picks.current = [
    () => {
      void store.forceReload();
      onClose();
    },
    () => {
      void store.openDevTools();
      onClose();
    },
    onImportLogin,
    () => {
      void store.clearCookies();
      onClose();
    },
    () => {
      void store.clearCache();
      onClose();
    },
  ];

  return (
    <div ref={listRef} className={styles.menu} {...pill.listProps}>
      <span ref={pill.pillRef} className={glideStyles.pill} aria-hidden="true" />
      <button
        type="button"
        role="menuitem"
        className={styles.action}
        data-glide-index={0}
        onClick={(event) => {
          if (pill.consumeClick(event.detail)) return;
          void store.forceReload();
          onClose();
        }}
      >
        <span className={styles.actionIcon}>
          <ArrowsClockwise size={16} weight="regular" />
        </span>
        <span>{t("browser.forceReload")}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        className={styles.action}
        data-glide-index={1}
        onClick={(event) => {
          if (pill.consumeClick(event.detail)) return;
          void store.openDevTools();
          onClose();
        }}
      >
        <span className={styles.actionIcon}>
          <Toolbox size={16} weight="regular" />
        </span>
        <span>DevTools</span>
      </button>

      <button
        type="button"
        role="menuitem"
        className={styles.action}
        data-glide-index={2}
        onClick={(event) => {
          if (pill.consumeClick(event.detail)) return;
          onImportLogin();
        }}
      >
        <span className={styles.actionIcon}>
          <SignIn size={16} weight="regular" />
        </span>
        <span>{t("browser.loginImport.menuItem")}</span>
      </button>

      <div className={styles.zoomRow}>
        <span className={styles.zoomLabel}>{t("browser.zoom")}</span>
        <button
          type="button"
          className={styles.zoomButton}
          title={t("browser.zoom.out")}
          aria-label={t("browser.zoom.out")}
          disabled={store.zoomFactor <= ZOOM_MIN + 1e-6}
          onClick={() => store.stepZoom(-ZOOM_STEP)}
        >
          <MagnifyingGlassMinus size={16} weight="regular" />
        </button>
        <span className={styles.zoomValue}>{zoomPercent}%</span>
        <button
          type="button"
          className={styles.zoomButton}
          title={t("browser.zoom.in")}
          aria-label={t("browser.zoom.in")}
          disabled={store.zoomFactor >= ZOOM_MAX - 1e-6}
          onClick={() => store.stepZoom(ZOOM_STEP)}
        >
          <MagnifyingGlassPlus size={16} weight="regular" />
        </button>
      </div>

      {/* 各按钮自带 title 语义，不叠加 role=group（Biome a11y：无对应原生元素） */}
      <div className={styles.viewportRow}>
        <span className={styles.viewportLabel}>{t("browser.viewport.width")}</span>
        {VIEWPORT_PRESETS.map((preset) => {
          const active = store.viewportWidth === preset.width;
          const Icon = preset.icon;
          return (
            <button
              key={preset.key}
              type="button"
              className={[styles.viewportButton, active ? styles.viewportActive : ""].join(" ")}
              title={
                preset.width
                  ? t("browser.viewport.preset", { width: preset.width })
                  : t("browser.viewport.followPanel")
              }
              aria-pressed={active}
              onClick={() => store.setViewport(preset.width)}
            >
              <Icon size={14} weight="regular" />
            </button>
          );
        })}
        <input
          key={store.viewportWidth ?? "follow"}
          className={styles.viewportInput}
          title={t("browser.viewport.custom")}
          inputMode="numeric"
          placeholder={t("browser.viewport.widthPlaceholder")}
          defaultValue={store.viewportWidth ?? ""}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            const raw = (event.target as HTMLInputElement).value.trim();
            const width = Number.parseInt(raw, 10);
            store.setViewport(Number.isFinite(width) && width >= 200 ? width : null);
            (event.target as HTMLInputElement).blur();
          }}
        />
      </div>

      <hr className={styles.divider} />

      <button
        type="button"
        role="menuitem"
        className={[styles.action, styles.actionDanger].join(" ")}
        data-glide-index={3}
        onClick={(event) => {
          if (pill.consumeClick(event.detail)) return;
          void store.clearCookies();
          onClose();
        }}
      >
        <span className={styles.actionIcon}>
          <Cookie size={16} weight="regular" />
        </span>
        <span>{t("browser.clearCookies")}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        className={[styles.action, styles.actionDanger].join(" ")}
        data-glide-index={4}
        onClick={(event) => {
          if (pill.consumeClick(event.detail)) return;
          void store.clearCache();
          onClose();
        }}
      >
        <span className={styles.actionIcon}>
          <Files size={16} weight="regular" />
        </span>
        <span>{t("browser.clearCache")}</span>
      </button>
    </div>
  );
}
