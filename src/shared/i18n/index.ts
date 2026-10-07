/**
 * 界面多语言（零新依赖）。
 * 文案按域放在 `locales/*`，各语言并排声明；React 侧用 `useT`，非组件代码用模块级 `t`。
 */
export { buildCatalog } from "./locales";
export { getI18nLocale, setI18nLocale, t } from "./runtime";
export { createTranslate, interpolate } from "./translate";
export {
  type Catalog,
  defineMessages,
  LOCALE_IDS,
  type LocaleId,
  type LocalePreference,
  type MessageDefs,
  type MessageEntry,
  type MessageParams,
  normalizeLocalePreference,
  resolveLocale,
  type TranslateFn,
} from "./types";
