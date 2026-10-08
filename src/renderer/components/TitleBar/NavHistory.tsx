import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { useT } from "../../hooks/useT";
import { useUiStore } from "../../stores/uiStore";
import { IconButton } from "../ui/IconButton";

/** 顶栏后退 / 前进（页面级路由历史，docs/design/03 §1）。 */
export function NavHistory() {
  const t = useT();
  const { canBack, canForward, dispatch } = useUiStore();

  return (
    <>
      <IconButton
        title={t("titleBar.back")}
        disabled={!canBack}
        onClick={() => dispatch({ type: "back" })}
      >
        <ArrowLeft size={20} weight="regular" />
      </IconButton>
      <IconButton
        title={t("titleBar.forward")}
        disabled={!canForward}
        onClick={() => dispatch({ type: "forward" })}
      >
        <ArrowRight size={20} weight="regular" />
      </IconButton>
    </>
  );
}
