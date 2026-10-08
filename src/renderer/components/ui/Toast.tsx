import { useEffect } from "react";
import { useUiStore } from "../../stores/uiStore";
import styles from "./Toast.module.css";

/** 全局提示条；可附带一个快捷动作（如保存后的「重载会话」）。 */
export function Toast() {
  const { toast, dispatch } = useUiStore();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      dispatch({ type: "dismissToast", id: toast.id });
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [toast, dispatch]);

  if (!toast) return null;

  return (
    <div key={toast.id} className={styles.toast} role="status">
      <span className={styles.message}>{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            toast.action?.run();
            dispatch({ type: "dismissToast", id: toast.id });
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
    </div>
  );
}
