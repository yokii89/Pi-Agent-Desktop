import type { Theme } from "../stores/uiStore";
import { EXTRA_FILE_EXTENSIONS } from "./extraMapping";
import { DEFAULT_FILE_ICON, FILE_EXTENSIONS, FILE_NAMES } from "./mapping";

const lightModules = {
  ...import.meta.glob("./assets/light/*.svg", {
    query: "?url",
    import: "default",
    eager: true,
  }),
  ...import.meta.glob("./icons-extra/light/*.svg", {
    query: "?url",
    import: "default",
    eager: true,
  }),
} as Record<string, string>;

const darkModules = {
  ...import.meta.glob("./assets/dark/*.svg", {
    query: "?url",
    import: "default",
    eager: true,
  }),
  ...import.meta.glob("./icons-extra/dark/*.svg", {
    query: "?url",
    import: "default",
    eager: true,
  }),
} as Record<string, string>;

function toIconMap(modules: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [file, url] of Object.entries(modules)) {
    const name = file.replaceAll("\\", "/").split("/").pop();
    if (name) {
      map[name.replace(/\.svg$/, "")] = url;
    }
  }
  return map;
}

const lightIcons = toIconMap(lightModules);
const darkIcons = toIconMap(darkModules);

/**
 * 图标名解析：FILE_NAMES 按完整文件名（小写）精确命中优先，其次按后缀从长到短尝试
 * （如 ".d.ts" 优先于 ".ts"）；生成映射与 EXTRA_FILE_EXTENSIONS 叠加，后者优先
 * （Office/媒体等上游缺失类型）。最后落到默认文档图标。
 */
export function resolveIconName(fileName: string): string {
  const lower = fileName.toLowerCase();
  const byName = FILE_NAMES[lower];
  if (byName) return byName;
  let dot = lower.indexOf(".");
  while (dot !== -1) {
    const ext = lower.slice(dot + 1);
    const byExt = EXTRA_FILE_EXTENSIONS[ext] ?? FILE_EXTENSIONS[ext];
    if (byExt) return byExt;
    dot = lower.indexOf(".", dot + 1);
  }
  return DEFAULT_FILE_ICON;
}

/** 文件对应的图标 URL；暗色主题优先 _dark 变体，缺失时回退浅色。 */
export function getFileIconUrl(fileName: string, theme: Theme): string {
  const name = resolveIconName(fileName);
  const dark = theme === "dark" ? darkIcons[name] : undefined;
  return dark ?? lightIcons[name] ?? lightIcons[DEFAULT_FILE_ICON];
}
