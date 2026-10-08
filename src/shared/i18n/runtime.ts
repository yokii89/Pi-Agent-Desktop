import { buildCatalog } from "./locales";
import { createTranslate } from "./translate";
import type { LocaleId, MessageParams, TranslateFn } from "./types";

/**
 * 进程内当前语言的模块级运行时。
 * React 侧由 uiStore 在水合/切换时同步；主进程在读设置后同步。
 * 非组件代码（store 构造文案、主进程错误信封）用这里的 `t`。
 */
let currentLocale: LocaleId = "zh-CN";
let translator: TranslateFn = createTranslate(buildCatalog(), currentLocale);

export function setI18nLocale(locale: LocaleId): void {
  if (currentLocale === locale) return;
  currentLocale = locale;
  translator = createTranslate(buildCatalog(), locale);
}

export function getI18nLocale(): LocaleId {
  return currentLocale;
}

/** 模块级翻译；组件内优先用 `useT` 以便随语言切换重渲染。 */
export function t(key: string, params?: MessageParams): string {
  return translator(key, params);
}
