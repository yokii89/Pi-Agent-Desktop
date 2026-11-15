import { accentTextTone, normalizeAccentColor } from "../../shared/accentColor";
import { createAccentPalette } from "../../shared/accentPalette";

const FILL_TOKENS = [
  "--color-accent",
  "--color-accent-hover",
  "--color-accent-text",
  "--color-accent-soft",
] as const;

/** 应用强调色填充与可读派生色；null 恢复主题默认，所有背景基准均读取 tokens.css。 */
export function applyAccentColor(color: string | null, theme: "dark" | "light"): void {
  const root = document.documentElement;
  const dark = theme === "dark";
  if (color) {
    root.style.setProperty("--color-accent", color);
    root.style.setProperty(
      "--color-accent-hover",
      dark
        ? `color-mix(in oklab, ${color} 88%, white)`
        : `color-mix(in oklab, ${color} 84%, black)`,
    );
    root.style.setProperty(
      "--color-accent-text",
      `var(--color-accent-ink-${accentTextTone(color)})`,
    );
    root.style.setProperty(
      "--color-accent-soft",
      `color-mix(in oklab, ${color} ${dark ? 16 : 12}%, transparent)`,
    );
  } else {
    for (const token of FILL_TOKENS) root.style.removeProperty(token);
  }
  const computed = getComputedStyle(root);
  const accent = normalizeAccentColor(computed.getPropertyValue("--color-accent"));
  const surfaces = [
    "--color-bg",
    "--color-bg-elevated-solid",
    "--color-bg-surface-solid",
    "--terminal-bg-solid",
  ]
    .map((token) => normalizeAccentColor(computed.getPropertyValue(token)))
    .filter((value): value is `#${string}` => value !== null && value !== "system");
  if (!accent || accent === "system" || surfaces.length === 0) {
    for (const token of ["--color-accent-fg", "--color-accent-fg-hover", "--color-accent-border"]) {
      root.style.removeProperty(token);
    }
    return;
  }
  const palette = createAccentPalette(accent, surfaces);
  root.style.setProperty("--color-accent-fg", palette.foreground);
  root.style.setProperty("--color-accent-fg-hover", palette.foregroundHover);
  root.style.setProperty("--color-accent-border", palette.border);
}
