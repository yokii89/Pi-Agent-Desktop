import { ArrowsClockwise, ArrowsIn, X } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { InspectorFloatHandoff } from "../shared/ipc";
import { BrowserInspector } from "./components/ContextSidebar/panels/browser/BrowserInspector";
import { useT } from "./hooks/useT";
import styles from "./inspector.module.css";
import { inspectorFloatService } from "./services/inspectorFloatService";
import { BrowserProvider } from "./stores/browserStore";
import { InspectorProvider, useInspectorStore } from "./stores/inspectorStore";
import { StyleEditProvider, useStyleEditStore } from "./stores/styleEditStore";
import { UiProvider, useUiStore } from "./stores/uiStore";
import "./styles/global.css";
import "./styles/tokens.css";

/**
 * 检查器系统级浮窗入口（docs/design/38）。
 * 独立 BrowserWindow 渲染进程：只挂检查器相关 Provider，不加载主应用壳。
 * 同一时刻唯一交互宿主；停靠 ⇄ 浮窗经 handoff 移交 UI 草稿。
 */

document.documentElement.dataset.theme = "dark";

function FloatChrome({ children }: { children: ReactNode }) {
  const t = useT();
  const { dispatch, browserPanelTab } = useUiStore();
  const edit = useStyleEditStore();
  const inspector = useInspectorStore();
  const [hydrated, setHydrated] = useState(false);
  const editRef = useRef(edit);
  editRef.current = edit;
  const tabRef = useRef(browserPanelTab);
  tabRef.current = browserPanelTab;

  // 挂载取回上次 handoff，恢复 tab 与热更草稿（只跑一次）
  useEffect(() => {
    let cancelled = false;
    void inspectorFloatService.takeHandoff().then((handoff) => {
      if (cancelled) return;
      if (handoff) {
        dispatch({ type: "setBrowserPanelTab", tab: handoff.tab });
        editRef.current.hydrateHandoffBody(handoff);
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  // 点窗口 X / 主窗请求停靠：交回草稿后再关
  useEffect(() => {
    const deliver = (): void => {
      const snapshot: InspectorFloatHandoff = {
        tab: tabRef.current,
        ...editRef.current.serializeHandoffBody(),
      };
      void inspectorFloatService.returnHandoff(snapshot);
    };
    const offReturn = inspectorFloatService.onRequestReturn(deliver);
    const offDock = inspectorFloatService.onRequestDock(deliver);
    return () => {
      offReturn();
      offDock();
    };
  }, []);

  const dock = (): void => {
    const handoff: InspectorFloatHandoff = {
      tab: browserPanelTab,
      ...edit.serializeHandoffBody(),
    };
    dispatch({ type: "setInspectorFloatOpen", open: false });
    void inspectorFloatService.dock(handoff);
  };

  return (
    <div className={styles.shell}>
      <header className={styles.titleBar}>
        <span className={styles.title}>{t("browser.inspector.floatTitle")}</span>
        <div className={styles.titleActions}>
          <button
            type="button"
            className={styles.titleBtn}
            title={t("browser.inspector.refreshNode")}
            disabled={inspector.nodeId === null}
            onClick={inspector.refresh}
          >
            <ArrowsClockwise size={14} weight="regular" />
          </button>
          <button
            type="button"
            className={styles.titleBtn}
            title={t("browser.inspector.floatDock")}
            onClick={dock}
          >
            <ArrowsIn size={14} weight="regular" />
          </button>
          <button
            type="button"
            className={styles.titleBtn}
            title={t("browser.inspector.floatClose")}
            onClick={dock}
          >
            <X size={14} weight="regular" />
          </button>
        </div>
      </header>
      <div className={styles.body}>{hydrated ? children : null}</div>
    </div>
  );
}

function InspectorApp() {
  return (
    <UiProvider>
      <BrowserProvider>
        <InspectorProvider>
          <StyleEditProvider>
            <FloatChrome>
              <BrowserInspector floatHost />
            </FloatChrome>
          </StyleEditProvider>
        </InspectorProvider>
      </BrowserProvider>
    </UiProvider>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<InspectorApp />);
}
