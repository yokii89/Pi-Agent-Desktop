/** 界面语言 id；新增语言时在此扩展并补齐各域文案。 */
export type LocaleId = "zh-CN" | "en-US";

/** 设置里的语言偏好：system 跟随系统，否则固定到具体语言。 */
export type LocalePreference = "system" | LocaleId;

export const LOCALE_IDS = ["zh-CN", "en-US"] as const satisfies readonly LocaleId[];

/** 单条文案：各语言并排，便于对照与审阅。 */
export type MessageEntry = Readonly<Record<LocaleId, string>>;

/** 某一域的文案表：键为 `domain.key` 风格的扁平 key。 */
export type MessageDefs = Readonly<Record<string, MessageEntry>>;

/** 插值参数；`{name}` 占位符替换为字符串化值。 */
export type MessageParams = Readonly<Record<string, string | number>>;

export type TranslateFn = (key: string, params?: MessageParams) => string;

/** 各语言完整文案表（扁平 key → 译文）。 */
export type Catalog = Readonly<Record<LocaleId, Readonly<Record<string, string>>>>;

/** 校验 LocalePreference；非法值回退 system。 */
export function normalizeLocalePreference(value: unknown): LocalePreference {
  return value === "zh-CN" || value === "en-US" ? value : "system";
}

/** 把偏好解析为实际生效语言；system 时按浏览器/系统语言猜，默认中文。 */
export function resolveLocale(
  preference: LocalePreference,
  systemLanguage?: string | null,
): LocaleId {
  if (preference !== "system") return preference;
  const lang = (systemLanguage ?? "").toLowerCase();
  if (lang.startsWith("zh")) return "zh-CN";
  if (lang.startsWith("en")) return "en-US";
  return "zh-CN";
}

/** 声明一域文案；保持各语言 key 对齐，缺译会在构建期由 satisfies 暴露。 */
export function defineMessages<T extends MessageDefs>(defs: T): T {
  return defs;
}
