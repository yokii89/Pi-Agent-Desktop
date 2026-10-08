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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../../../hooks/useT";
import { browserService } from "../../../../services/browserService";
import { useBrowserStore, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../../../../stores/browserStore";
import {
  handoffOverlaySuppress,
  prepareOverlayFreeze,
  releaseOverlayFreeze,
} from "../../../../utils/overlayFreeze";
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
 */
export function BrowserMoreMenu() {
  const t = useT();
  const store = useBrowserStore();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const openingRef = useRef(false);
  const wasOpenRef = useRef(false);
  /** 已交接给导入对话框：菜单关闭时只摘 moreMenu，保留冻结帧。 */
  const handingOffRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 仅在 open → closed 时恢复；不把 store 放进依赖，避免无关重渲染误清冻结帧
  // biome-ignore lint/correctness/useExhaustiveDependencies: setOverlayFreeze 稳定；此 effect 只关心 open 边沿
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    if (handingOffRef.current) {
      handingOffRef.current = false;
      // 仅释放菜单原因；loginImport 仍抑制，冻结帧留给对话框
      void browserService.setOverlaySuppressed(false, SUPPRESS_REASON);
      return;
    }
    releaseOverlayFreeze(SUPPRESS_REASON, store.setOverlayFreeze);
  }, [open]);

  const openMenu = (): void => {
    if (open || openingRef.current) return;
    openingRef.current = true;
    void (async () => {
      try {
        await prepareOverlayFreeze(SUPPRESS_REASON, store.setOverlayFreeze);
        setOpen(true);
      } catch {
        browserService.setOverlaySuppressed(true, SUPPRESS_REASON);
        setOpen(true);
      } finally {
        openingRef.current = false;
      }
    })();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <IconButton
        ref={triggerRef}
        title={t("browser.moreTrigger")}
        active={open}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          if (open) setOpen(false);
          else openMenu();
        }}
      >
        <DotsThree size={16} weight="regular" />
      </IconButton>
      {open &&
        createPortal(
          <MoreMenuPanel
            panelRef={panelRef}
            anchor={triggerRef.current}
            onClose={() => setOpen(false)}
            onImportLogin={() => {
              // 先把抑制权交给对话框，再关菜单：避免视图短暂恢复盖住 Modal
              handingOffRef.current = true;
              void (async () => {
                await handoffOverlaySuppress(IMPORT_SUPPRESS_REASON, SUPPRESS_REASON);
                setImportOpen(true);
                setOpen(false);
              })();
            }}
          />,
          document.body,
        )}
      <ImportLoginDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

/** 菜单面板：贴「…」下方、右对齐；放不下则翻到上方。 */
function MoreMenuPanel({
  panelRef,
  anchor,
  onClose,
  onImportLogin,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  anchor: HTMLElement | null;
  onClose: () => void;
  onImportLogin: () => void;
}) {
  const t = useT();
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const { width, height } = panel.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let top = rect.bottom + GAP;
    if (top + height > viewportH - VIEWPORT_MARGIN) {
      const above = rect.top - GAP - height;
      if (above >= VIEWPORT_MARGIN) top = above;
      else top = Math.max(VIEWPORT_MARGIN, viewportH - height - VIEWPORT_MARGIN);
    }
    let left = rect.right - width;
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    if (left + width > viewportW - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, viewportW - width - VIEWPORT_MARGIN);
    }

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }, [anchor, panelRef]);

  return (
    <div ref={panelRef} className={styles.panel} role="menu" aria-label={t("browser.more")}>
      <MenuBody onClose={onClose} onImportLogin={onImportLogin} />
    </div>
  );
}

/** 菜单内容：强制刷新 / DevTools / 登录态导入 / 缩放 / 视口 / 清理。 */
function MenuBody({ onClose, onImportLogin }: { onClose: () => void; onImportLogin: () => void }) {
  const t = useT();
  const store = useBrowserStore();
  const zoomPercent = Math.round(store.zoomFactor * 100);

  return (
    <div className={styles.menu}>
      <button
        type="button"
        role="menuitem"
        className={styles.action}
        onClick={() => {
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
        onClick={() => {
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
        onClick={() => {
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
        onClick={() => {
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
        onClick={() => {
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
