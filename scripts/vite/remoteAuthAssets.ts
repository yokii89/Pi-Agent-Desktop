import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

/** Derive a reviewable Auth0 theme patch from PiDesk tokens without contacting the tenant. */
function brandingTheme(css: string, theme: "dark" | "light") {
  const block = (name: string): string =>
    css.match(new RegExp(`:root\\[data-theme="${name}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  const values = new Map<string, string>();
  for (const match of `${block("dark")}\n${theme === "light" ? block("light") : ""}`.matchAll(
    /(--[\w-]+):\s*([^;]+);/g,
  ))
    values.set(match[1], match[2].trim());
  const token = (key: string, depth = 0): string => {
    if (depth > 8 || !values.has(key)) throw new Error(`Unresolved branding token ${key}`);
    return (values.get(key) ?? "").replace(/var\((--[\w-]+)\)/g, (_match, name: string) =>
      token(name, depth + 1),
    );
  };
  return {
    colors: {
      primary_button: token("--color-accent-default"),
      primary_button_label: token("--color-accent-text"),
      secondary_button_border: token("--color-border"),
      secondary_button_label: token("--color-text"),
      links_focused_components: token("--color-accent-fg"),
      base_focus_color: token("--color-accent-default"),
      base_hover_color: token("--color-bg-surface"),
      header: token("--color-text-strong"),
      body_text: token("--color-text"),
      widget_background: token("--color-bg-elevated"),
      widget_border: token("--color-border"),
      input_labels_placeholders: token("--color-text-muted"),
      input_filled_text: token("--color-text"),
      input_border: token("--color-border"),
      input_background: token("--color-bg"),
      icons: token("--color-text-muted"),
      error: token("--color-danger"),
      success: token("--color-success"),
    },
    borders: {
      button_border_radius: Number.parseFloat(token("--radius-md")),
      button_border_weight: 1,
      buttons_style: "rounded",
      input_border_radius: Number.parseFloat(token("--radius-md")),
      input_border_weight: 1,
      inputs_style: "rounded",
      widget_corner_radius: Number.parseFloat(token("--radius-lg")),
      widget_border_weight: 1,
      show_widget_shadow: true,
    },
    fonts: { reference_text_size: Number.parseFloat(token("--font-size-md")) },
    page_background: { background_color: token("--color-bg"), page_layout: "center" },
  };
}

/** Bundle the same tokens for the native loopback page; no CDN or independent palette. */
export function remoteAuthAssets(): Plugin {
  let root: string;
  return {
    name: "pidesk:remote-auth-assets",
    configResolved(config) {
      root = config.root;
    },
    async generateBundle() {
      const sources = await Promise.all(
        ["tokens.css", "remoteAuthCallback.css"].map((name) =>
          readFile(path.join(root, "styles", name), "utf8"),
        ),
      );
      this.emitFile({ type: "asset", fileName: "remote-auth.css", source: sources.join("\n") });
      for (const theme of ["dark", "light"] as const) {
        this.emitFile({
          type: "asset",
          fileName: `remote-auth-branding-${theme}.json`,
          source: `${JSON.stringify(brandingTheme(sources[0], theme), null, 2)}\n`,
        });
      }
    },
  };
}
