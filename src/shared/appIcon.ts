export const APP_ICON_IDS = ["classic", "blue", "green", "pink", "yellow"] as const;

export type AppIconId = (typeof APP_ICON_IDS)[number];

export const DEFAULT_APP_ICON_ID: AppIconId = "classic";

export function isAppIconId(value: unknown): value is AppIconId {
  return typeof value === "string" && APP_ICON_IDS.includes(value as AppIconId);
}

export function normalizeAppIconId(value: unknown): AppIconId {
  return isAppIconId(value) ? value : DEFAULT_APP_ICON_ID;
}
