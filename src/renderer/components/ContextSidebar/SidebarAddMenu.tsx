import { Plus } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef } from "react";
import { useT } from "../../hooks/useT";
import { browserService } from "../../services/browserService";
import { useBrowserStore } from "../../stores/browserStore";
import { prepareOverlayFreeze, releaseOverlayFreeze } from "../../utils/overlayFreeze";
import { IconButton } from "../ui/IconButton";
import { Menu, type MenuItem } from "../ui/Menu";
import type { SidebarFeature } from "./sidebarFeatures";

/** 原生浏览器视图的抑制来源（与 BrowserMoreMenu 的 reason 各自独立）。 */
const SUPPRESS_REASON = "sidebarAddMenu";

/**
 * 右侧栏「加号」菜单：列出当前还没打开的启动页功能。
 *
 * 浏览器页签激活时，下拉面板会盖在 WebContentsView 上；原生视图永远在渲染层之上，
 * 所以打开前先冻帧 + 摘除视图，收起动画结束后再恢复（与 BrowserMoreMenu 同一时序）。
 */
export function SidebarAddMenu({
  features,
  onSelect,
  nativeOverlayActive,
}: {
  features: readonly SidebarFeature[];
  onSelect: (feature: SidebarFeature) => void;
  /** 当前页签是否正由原生 WebContentsView 渲染。 */
  nativeOverlayActive: boolean;
}) {
  const t = useT();
  const { setOverlayFreeze } = useBrowserStore();
  const suppressed = useRef(false);

  const beforeOpen = useCallback(async (): Promise<void> => {
    if (!nativeOverlayActive) return;
    suppressed.current = true;
    try {
      await prepareOverlayFreeze(SUPPRESS_REASON, setOverlayFreeze);
    } catch {
      // 截帧失败也要先摘掉视图，否则菜单会直接被页面盖住
      await browserService.setOverlaySuppressed(true, SUPPRESS_REASON);
    }
  }, [nativeOverlayActive, setOverlayFreeze]);

  const onOpenChange = useCallback(
    (open: boolean): void => {
      if (open || !suppressed.current) return;
      suppressed.current = false;
      void releaseOverlayFreeze(SUPPRESS_REASON, setOverlayFreeze);
    },
    [setOverlayFreeze],
  );

  // 侧栏被快捷键收起时菜单会随组件卸载：不能让抑制原因留在主进程里
  useEffect(
    () => () => {
      if (!suppressed.current) return;
      suppressed.current = false;
      void releaseOverlayFreeze(SUPPRESS_REASON, setOverlayFreeze);
    },
    [setOverlayFreeze],
  );

  const items: MenuItem[] = [];
  let previousSource: SidebarFeature["source"] | null = null;
  for (const feature of features) {
    const IconComponent = feature.icon;
    items.push({
      key: feature.id,
      label: feature.title,
      icon: <IconComponent size={16} weight="regular" />,
      hint: feature.shortcut,
      dividerBefore: previousSource === "builtin" && feature.source === "extension",
      onSelect: () => onSelect(feature),
    });
    previousSource = feature.source;
  }
  if (items.length === 0) {
    items.push({
      key: "empty",
      label: t("panels.context.noAddableFeatures"),
      disabled: true,
    });
  }

  return (
    <Menu
      align="right"
      direction="bottom"
      hideScrollbar
      beforeOpen={beforeOpen}
      onOpenChange={onOpenChange}
      items={items}
      trigger={({ open, onClick }) => (
        <IconButton
          title={t("panels.context.addFeature")}
          data-sidebar-add=""
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={onClick}
        >
          <Plus size={16} weight="regular" />
        </IconButton>
      )}
    />
  );
}
