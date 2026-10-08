import type { Catalog, LocaleId, MessageParams, TranslateFn } from "./types";

/** `{name}` 占位符；未提供的参数原样保留，便于排查漏传。 */
const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * 按目录与当前语言构造 `t`。
 * 缺 key 时回退 zh-CN，再回退 key 本身——宁可露出 key，也不要空白 UI。
 */
export function createTranslate(catalog: Catalog, locale: LocaleId): TranslateFn {
  const primary = catalog[locale];
  const fallback = catalog["zh-CN"];
  return (key, params) => {
    const template = primary[key] ?? fallback[key] ?? key;
    return interpolate(template, params);
  };
}
