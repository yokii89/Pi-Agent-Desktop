import { useMemo } from "react";
import { createTranslate, getI18nLocale, type TranslateFn } from "../../shared/i18n";
import { buildCatalog } from "../../shared/i18n/locales";
import { useUiStore } from "../stores/uiStore";

/**
 * 组件内翻译函数；依赖 uiStore 的 locale，语言切换后自动重渲染。
 * 纯工具/主进程请用 shared/i18n 的模块级 `t`。
 */
export function useT(): TranslateFn {
  const { locale } = useUiStore();
  return useMemo(() => createTranslate(buildCatalog(), locale ?? getI18nLocale()), [locale]);
}
