import { ArrowsIn, ArrowsOut, X } from "@phosphor-icons/react";
import { useT } from "../../hooks/useT";
import { IconButton } from "../ui/IconButton";
import { SidebarAddMenu } from "./SidebarAddMenu";
import type { SidebarFeature } from "./sidebarFeatures";

/** 启动页与页签态共用的右上角动作：添加功能 / 放大还原 / 收起侧栏。 */
export function SidebarActions({
  className,
  features,
  onSelectFeature,
  nativeOverlayActive,
  maximized,
  onToggleMaximize,
  onCollapse,
}: {
  className: string;
  features: readonly SidebarFeature[];
  onSelectFeature: (feature: SidebarFeature) => void;
  nativeOverlayActive: boolean;
  maximized: boolean;
  onToggleMaximize: () => void;
  onCollapse: () => void;
}) {
  const t = useT();
  return (
    <div className={className}>
      <SidebarAddMenu
        features={features}
        onSelect={onSelectFeature}
        nativeOverlayActive={nativeOverlayActive}
      />
      <IconButton
        title={
          maximized ? t("panels.context.restoreSidebarWidth") : t("panels.context.maximizeSidebar")
        }
        data-sidebar-maximize=""
        onClick={onToggleMaximize}
      >
        {maximized ? (
          <ArrowsIn size={16} weight="regular" />
        ) : (
          <ArrowsOut size={16} weight="regular" />
        )}
      </IconButton>
      <IconButton
        title={t("panels.context.collapseSidebar")}
        data-sidebar-collapse=""
        onClick={onCollapse}
      >
        <X size={16} weight="regular" />
      </IconButton>
    </div>
  );
}
