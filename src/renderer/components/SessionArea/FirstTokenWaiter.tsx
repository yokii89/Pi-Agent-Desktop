import { useEffect, useState } from "react";
import { useT } from "../../hooks/useT";
import styles from "./FirstTokenWaiter.module.css";

/** 首字占位延迟：快响应不闪，慢响应有交代（docs/design/10 §3.7 / 13 P1-3）。 */
const WAITER_DELAY_MS = 400;

/**
 * 首字等待占位：run 已开始但尚无任何可见输出时出现（prefill / 长思考空窗期），
 * 轻量一行 + 呼吸线，不与工具行的过程信息竞争。延迟出现，首字到达即卸载。
 */
export function FirstTokenWaiter() {
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), WAITER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return (
    <div className={styles.waiter} role="status">
      <span className={styles.line} aria-hidden />
      <span className={styles.text}>{t("session.firstToken")}</span>
    </div>
  );
}
