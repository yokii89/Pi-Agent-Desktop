import { useSyncExternalStore } from "react";
import type { Theme } from "../stores/uiStore";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** 跟随根元素 `data-theme` 的解析结果；只订阅主题属性，不订阅整个 uiStore。 */
export function useResolvedTheme(): Theme {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
