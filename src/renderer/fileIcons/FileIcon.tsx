import { useSyncExternalStore } from "react";
import { getFileIconUrl } from "./resolve";

interface FileIconProps {
  /** 文件名（含后缀），如 "index.ts"。 */
  fileName: string;
  className?: string;
}

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function getThemeSnapshot(): "light" | "dark" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** 文件类型图标（资源型 SVG，随主题切换明暗变体）；按钮/工具栏等 UI 图标仍使用 Phosphor。 */
export function FileIcon({ fileName, className }: FileIconProps) {
  // 只订阅 data-theme，避免 uiStore 任一字段变化拖动整棵文件树
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeSnapshot);
  return (
    <img src={getFileIconUrl(fileName, theme)} alt="" className={className} draggable={false} />
  );
}
