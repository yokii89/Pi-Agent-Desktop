import { Copy, Minus, Square, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useT } from "../../hooks/useT";
import { windowService } from "../../services/windowService";
import styles from "./WindowControls.module.css";

/** 窗口控制三键：最小化 / 最大化-还原 / 关闭。 */
export function WindowControls() {
  const t = useT();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    void windowService.isMaximized().then((v) => {
      if (!disposed) setIsMaximized(v);
    });
    const unsubscribe = windowService.onWindowStateChange((v) => setIsMaximized(v));
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return (
    <div className={styles.controls}>
      <button
        type="button"
        title={t("titleBar.minimize")}
        aria-label={t("titleBar.minimize")}
        className={styles.button}
        onClick={() => void windowService.minimize()}
      >
        <Minus size={16} weight="regular" />
      </button>
      <button
        type="button"
        title={isMaximized ? t("titleBar.restore") : t("titleBar.maximize")}
        aria-label={isMaximized ? t("titleBar.restore") : t("titleBar.maximize")}
        className={styles.button}
        onClick={() => void windowService.toggleMaximize()}
      >
        {isMaximized ? <Copy size={14} weight="regular" /> : <Square size={14} weight="regular" />}
      </button>
      <button
        type="button"
        title={t("titleBar.close")}
        aria-label={t("titleBar.close")}
        className={[styles.button, styles.close].join(" ")}
        onClick={() => void windowService.close()}
      >
        <X size={16} weight="regular" />
      </button>
    </div>
  );
}
