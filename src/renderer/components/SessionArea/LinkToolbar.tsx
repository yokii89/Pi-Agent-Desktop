import { ArrowSquareOut, Browser } from "@phosphor-icons/react";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGlideOverlay } from "../../hooks/useGlideOverlay";
import { useT } from "../../hooks/useT";
import { useBrowserStore } from "../../stores/browserStore";
import { useUiStore } from "../../stores/uiStore";
import styles from "./SelectionToolbar.module.css";

interface LinkTarget {
  url: string;
  anchor: HTMLAnchorElement;
}

/** 会话流外链的打开方式工具条，与划选操作共用外观和浮层动效。 */
export function LinkToolbar({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const t = useT();
  const browser = useBrowserStore();
  const { dispatch, showToast } = useUiStore();
  const [target, setTarget] = useState<LinkTarget | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const overlay = useGlideOverlay(panelRef);
  const close = useCallback(() => {
    overlay.exit(() => setTarget(null));
  }, [overlay]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onClick = (event: MouseEvent): void => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || !container.contains(anchor)) return;
      if (!/^https?:\/\//i.test(anchor.href)) return;
      event.preventDefault();
      event.stopPropagation();
      window.getSelection()?.removeAllRanges();
      setTarget({ url: anchor.href, anchor });
    };
    // 在 UrlLink 的默认系统打开动作之前接管，仅限中央会话流。
    container.addEventListener("click", onClick, true);
    return () => container.removeEventListener("click", onClick, true);
  }, [containerRef]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!target || !panel) return;
    overlay.prime();
    const rect = target.anchor.getBoundingClientRect();
    const gap = 8;
    const above = rect.top - gap - panel.offsetHeight >= gap;
    const top = above ? rect.top - gap - panel.offsetHeight : rect.bottom + gap;
    panel.style.left = `${Math.max(gap, Math.min(rect.left + rect.width / 2 - panel.offsetWidth / 2, window.innerWidth - panel.offsetWidth - gap))}px`;
    panel.style.top = `${Math.max(gap, Math.min(top, window.innerHeight - panel.offsetHeight - gap))}px`;
    panel.style.transformOrigin = above ? "bottom center" : "top center";
    overlay.enter();
  }, [target, overlay]);

  useEffect(() => {
    if (!target) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      target.anchor.focus({ preventScroll: true });
      close();
    };
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [target, close]);

  const openSidebar = async (url: string): Promise<void> => {
    if (browser.pages.length === 0 && !(await browser.createPage())) return;
    if (!(await browser.navigate(url))) return;
    dispatch({ type: "setRightSidebar", open: true, tab: "browser" });
  };

  if (!target) return null;
  return createPortal(
    <div
      ref={panelRef}
      className={styles.panel}
      data-overlay-panel=""
      role="toolbar"
      aria-label={t("ui.linkBar.aria")}
    >
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            close();
            void openSidebar(target.url);
          }}
        >
          <Browser size={16} weight="regular" />
          <span>{t("ui.linkBar.sidebar")}</span>
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            close();
            void window.pidesk?.window
              .openExternal(target.url)
              .then((result) => {
                if (!result.ok) showToast(result.error ?? t("common.openFailed"));
              })
              .catch(() => showToast(t("common.openFailed")));
          }}
        >
          <ArrowSquareOut size={16} weight="regular" />
          <span>{t("ui.linkBar.system")}</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
