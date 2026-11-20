import fs from "node:fs";
import path from "node:path";
import { buildCatalog, createTranslate, type LocaleId } from "../../shared/i18n";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

function callbackStyles(): string {
  const source = path.resolve(__dirname, "../../../src/renderer/styles");
  try {
    if (fs.existsSync(path.join(source, "remoteAuthCallback.css")))
      return ["tokens.css", "remoteAuthCallback.css"]
        .map((file) => fs.readFileSync(path.join(source, file), "utf8"))
        .join("\n");
    return fs.readFileSync(path.resolve(__dirname, "../../renderer/remote-auth.css"), "utf8");
  } catch {
    // Authentication remains usable if an installation's optional presentation asset is missing.
    return "";
  }
}

/** Self-contained, script-free loopback result page using the application's own design tokens. */
export function renderDesktopAuthPage(
  outcome: "success" | "error" | "cancelled",
  locale: LocaleId,
  theme: "dark" | "light",
  errorCode?: string,
): string {
  const t = createTranslate(buildCatalog(), locale);
  const title = t(`settings.remote.callback.${outcome}.title`);
  const key = errorCode ? `remote.error.${errorCode}` : "";
  const specific = key ? t(key) : "";
  const description =
    specific && specific !== key ? specific : t(`settings.remote.callback.${outcome}.body`);
  return `<!doctype html><html lang="${locale}" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="${theme}"><title>PiDesk · ${escapeHtml(title)}</title><style>${callbackStyles()}</style></head><body><main class="auth-card" data-outcome="${outcome}"><p class="auth-brand">PiDesk</p><p class="auth-label">${escapeHtml(t("settings.remote.accountTitle"))}</p><h1>${escapeHtml(title)}</h1><p class="auth-description">${escapeHtml(description)}</p><p class="auth-return">${escapeHtml(t("settings.remote.callback.return"))}</p></main></body></html>`;
}
