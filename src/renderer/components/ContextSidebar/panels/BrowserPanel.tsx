import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  Browsers,
  Camera,
  CaretDown,
  Copy,
  Crosshair,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { TranslateFn } from "../../../../shared/i18n";
import { useT } from "../../../hooks/useT";
import { browserService } from "../../../services/browserService";
import { useBrowserStore } from "../../../stores/browserStore";
import { useUiStore } from "../../../stores/uiStore";
import { IconButton } from "../../ui/IconButton";
import styles from "./BrowserPanel.module.css";
import { BrowserInspector } from "./browser/BrowserInspector";
import { BrowserMoreMenu } from "./browser/BrowserMoreMenu";
import { BrowserNewPageButton } from "./browser/BrowserNewPageButton";
import { RegionCaptureOverlay } from "./browser/RegionCaptureOverlay";

/** 最近地址排序：localhost / 内网 dev server 优先（P0-5）。 */
function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ||
      host.startsWith("192.168.") ||
      host.startsWith("10.")
    );
  } catch {
    return false;
  }
}

/** 页签展示名：有标题用标题，否则 URL host，都没有则占位。 */
function pageLabel(page: { title: string; url: string; started: boolean }, t: TranslateFn): string {
  if (page.title) return page.title;
  if (page.url) {
    try {
      return new URL(page.url).host || page.url;
    } catch {
      return page.url;
    }
  }
  return t("browser.page.untitled");
}

/**
 * 右侧"浏览器"面板（docs/design/05）：本地开发预览 + 元素拾取。
 * 页面内容由主进程 WebContentsView 覆盖渲染在宿主区域上方；
 * 需要叠在页面上的菜单（更多）走 portal 浮层 + setOverlaySuppressed。
 * 多页面：顶部页签条 + 加号直接新建「浏览器」页。
 */
export function BrowserPanel() {
  const t = useT();
  const store = useBrowserStore();
  const { rightSidebarWidth, navCollapsed, rightSidebarOpen } = useUiStore();
  const [addressInput, setAddressInput] = useState(store.url);
  const [showRecents, setShowRecents] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const addressFocusedRef = useRef(false);
  // 供「侧栏宽度变化」等组件外触发源复用同一份同步逻辑（见下方两个 effect）
  const syncRef = useRef<() => void>(() => {});

  // 地址栏跟随导航更新（输入中不打断）
  useEffect(() => {
    if (!addressFocusedRef.current) setAddressInput(store.url);
  }, [store.url]);

  // 宿主区域 bounds 同步：WebContentsView 需主进程定位（§11.2），拖拽/显隐经 RO 驱动。
  // 调度是「合并但不取消」：RO 在侧栏过渡期间每帧都会回调，若每次取消上一帧排队的 rAF，
  // 会出现「侧栏已经收窄、页面还停在旧宽度」的错位——所以只保证每帧至多同步一次。
  //
  // 注意 RO 只报**尺寸**变化：窗口伸缩时右栏宽度不变、整栏水平平移，host 的 x 变了
  // 但 width/height 不变，RO 不会触发——必须额外听 window resize / 根节点尺寸，
  // 否则页面会停在旧坐标（「已打开浏览器页面不随窗口伸缩移动」）。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    const sync = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = host.getBoundingClientRect();
        browserBounds({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          visible: rect.width > 2 && rect.height > 2,
        });
      });
    };
    syncRef.current = sync;
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(host);
    observer.observe(document.documentElement);
    window.addEventListener("resize", sync);
    return () => {
      syncRef.current = () => {};
      observer.disconnect();
      window.removeEventListener("resize", sync);
      cancelAnimationFrame(frame);
      frame = 0;
      browserBounds({ x: 0, y: 0, width: 0, height: 0, visible: false });
    };
  }, []);

  // 侧栏宽度 / 左导航收放 / 侧栏开合是组件外的布局事实（写的是网格 CSS 变量或类名），
  // 提交后显式补一帧：这些变化往往只平移宿主、不改尺寸，RO 抓不到。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 这几个值是「布局提交信号」，依赖它们就是本意
  useEffect(() => {
    syncRef.current();
  }, [rightSidebarWidth, navCollapsed, rightSidebarOpen]);

  // ESC：面板/输入区持有焦点时由渲染层处理；页面持焦时由主进程 before-input-event 处理。
  // 与主进程同构的分层（06 §3.1）：圈选 → 浏览 → 退出。区域截图优先退出。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (store.regionCapture) {
        event.preventDefault();
        store.endRegionCapture();
        return;
      }
      if (!store.pickActive) return;
      event.preventDefault();
      if (store.pickMode === "select") store.setPickMode("browse");
      else store.exitPick();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    store.regionCapture,
    store.endRegionCapture,
    store.pickActive,
    store.pickMode,
    store.setPickMode,
    store.exitPick,
  ]);

  const submitAddress = (): void => {
    const value = addressInput.trim();
    if (!value) return;
    void store.navigate(value);
    setShowRecents(false);
  };

  const recents = [...store.recentUrls].sort((a, b) => {
    const localDiff = Number(isLocalUrl(b.url)) - Number(isLocalUrl(a.url));
    return localDiff !== 0 ? localDiff : b.at - a.at;
  });

  // 页面区高亮边框只表示「圈选中」：浏览子模式下 overlay 已关闭，页面可正常交互
  const selecting = store.pickActive && store.pickMode === "select";

  return (
    <div className={[styles.panel, selecting ? styles.picking : ""].join(" ")}>
      <div className={styles.pageTabs} role="tablist" aria-label={t("browser.pages.label")}>
        {store.pages.map((page) => {
          const active = page.id === store.activePageId;
          return (
            <div
              key={page.id}
              className={[styles.pageTab, active ? styles.pageTabActive : ""].join(" ")}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className={styles.pageTabButton}
                title={page.url || pageLabel(page, t)}
                onClick={() => void store.setActivePage(page.id)}
              >
                <Browsers size={14} weight="regular" />
                <span className={styles.pageTabLabel}>{pageLabel(page, t)}</span>
              </button>
              {store.pages.length > 1 && (
                <button
                  type="button"
                  className={styles.pageTabClose}
                  title={t("browser.page.close")}
                  aria-label={t("browser.page.close")}
                  onClick={(event) => {
                    event.stopPropagation();
                    void store.closePage(page.id);
                  }}
                >
                  <X size={12} weight="regular" />
                </button>
              )}
            </div>
          );
        })}
        <BrowserNewPageButton />
      </div>
      <div className={styles.toolbar}>
        <IconButton title={t("browser.back")} onClick={store.back} disabled={!store.canGoBack}>
          <ArrowLeft size={16} weight="regular" />
        </IconButton>
        <IconButton
          title={t("browser.forward")}
          onClick={store.forward}
          disabled={!store.canGoForward}
        >
          <ArrowRight size={16} weight="regular" />
        </IconButton>
        <IconButton
          title={store.loading ? t("browser.stop") : t("browser.reload")}
          onClick={store.loading ? store.stop : () => void store.reload()}
        >
          <ArrowClockwise
            size={16}
            weight="regular"
            className={store.loading ? styles.spinning : ""}
          />
        </IconButton>
        <div className={styles.addressWrap}>
          <input
            className={styles.address}
            placeholder={t("browser.address.placeholder")}
            spellCheck={false}
            value={addressInput}
            onChange={(event) => setAddressInput(event.target.value)}
            onFocus={() => {
              addressFocusedRef.current = true;
            }}
            onBlur={() => {
              addressFocusedRef.current = false;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitAddress();
            }}
          />
          <button
            type="button"
            className={styles.recentToggle}
            title={t("browser.recents")}
            aria-expanded={showRecents}
            onClick={() => setShowRecents((prev) => !prev)}
          >
            <CaretDown size={14} weight="regular" className={showRecents ? styles.caretUp : ""} />
          </button>
        </div>
        <div className={styles.trailingActions}>
          <IconButton
            title={t("browser.openExternal")}
            onClick={store.openExternal}
            disabled={!store.url}
          >
            <ArrowSquareOut size={16} weight="regular" />
          </IconButton>
          <IconButton
            title={
              store.pickActive
                ? selecting
                  ? t("browser.pick.exitSelect")
                  : t("browser.pick.exit")
                : t("browser.pick.enter")
            }
            active={store.pickActive}
            onClick={store.togglePick}
          >
            <Crosshair size={16} weight={store.pickActive ? "fill" : "regular"} />
          </IconButton>
          <IconButton
            title={t("browser.capture.region")}
            active={store.regionCapture !== null}
            onClick={() => void store.startRegionCapture()}
          >
            <Camera size={16} weight="regular" />
          </IconButton>
          <IconButton
            title={t("browser.errors.title")}
            className={store.errors.length > 0 ? styles.errorButton : undefined}
            aria-expanded={showErrors}
            onClick={() => setShowErrors((prev) => !prev)}
          >
            <Warning size={16} weight={store.errors.length > 0 ? "fill" : "regular"} />
            {store.errors.length > 0 && (
              <span className={styles.errorBadge}>{store.errors.length}</span>
            )}
          </IconButton>
          <BrowserMoreMenu />
        </div>
      </div>

      {showRecents && (
        <div className={styles.section}>
          <p className={styles.sectionTitle}>{t("browser.recents.title")}</p>
          {recents.length === 0 ? (
            <p className={styles.emptyNote}>{t("browser.recents.empty")}</p>
          ) : (
            <ul className={styles.recentList}>
              {recents.slice(0, 8).map((recent) => (
                <li key={recent.url}>
                  <button
                    type="button"
                    className={[
                      styles.recentItem,
                      isLocalUrl(recent.url) ? styles.recentLocal : "",
                    ].join(" ")}
                    title={recent.url}
                    onClick={() => {
                      void store.navigate(recent.url);
                      setShowRecents(false);
                    }}
                  >
                    <Browsers size={14} weight="regular" />
                    <span className={styles.recentUrl}>{recent.url}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showErrors && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <p className={styles.sectionTitle}>{t("browser.errors.sectionTitle")}</p>
            {store.errors.length > 0 && (
              <button
                type="button"
                className={styles.linkButton}
                onClick={() =>
                  store.copyText(
                    store.errors
                      .map(
                        (error) =>
                          `${error.message}${error.source ? ` (${error.source}:${error.line ?? 0})` : ""}`,
                      )
                      .join("\n"),
                    t("browser.errors.copyLabel"),
                  )
                }
              >
                <Copy size={12} weight="regular" />
                {t("browser.errors.copyAll")}
              </button>
            )}
          </div>
          {store.errors.length === 0 ? (
            <p className={styles.emptyNote}>{t("browser.errors.empty")}</p>
          ) : (
            <ul className={styles.errorList}>
              {[...store.errors].reverse().map((error) => (
                <li key={error.id} className={styles.errorItem}>
                  <span className={styles.errorMessage}>{error.message}</span>
                  {error.source && (
                    <span className={styles.errorSource}>
                      {error.source.split("/").at(-1)}
                      {error.line !== null ? `:${error.line}` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div ref={hostRef} className={[styles.host, selecting ? styles.hostPicking : ""].join(" ")}>
        {!store.started && !store.regionCapture && (
          <div className={styles.empty}>
            <Browsers size={32} weight="regular" />
            <p>{t("browser.empty.title")}</p>
            <p className={styles.emptyHint}>{t("browser.empty.hint")}</p>
          </div>
        )}
        {/* 浮层抑制时的冻结帧：菜单打开期间垫在宿主区，避免 WebContentsView 摘掉后露黑底 */}
        {store.overlayFreeze && !store.regionCapture && (
          <img
            className={styles.overlayFreeze}
            src={store.overlayFreeze}
            alt=""
            draggable={false}
          />
        )}
        {store.regionCapture && <RegionCaptureOverlay session={store.regionCapture} />}
      </div>

      <BrowserInspector />
    </div>
  );
}

function browserBounds(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}): void {
  browserService.setBounds(rect);
}
