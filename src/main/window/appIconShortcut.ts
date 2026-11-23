import path from "node:path";

interface ShortcutIconAccess {
  exists(shortcutPath: string): boolean;
  read(shortcutPath: string): { target?: string; icon?: string; iconIndex?: number };
  update(shortcutPath: string, iconPath: string): boolean;
}

function sameWindowsPath(left: string, right: string): boolean {
  return path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
}

/** 仅更新指向本次安装的已有快捷方式图标；保留启动参数与其余属性，失败不阻塞启动。 */
export function updateAppIconShortcuts(
  shortcutPaths: readonly string[],
  executablePath: string,
  iconPath: string,
  access: ShortcutIconAccess,
): string[] {
  const failed: string[] = [];
  for (const shortcutPath of new Set(shortcutPaths)) {
    try {
      if (!access.exists(shortcutPath)) continue;
      const link = access.read(shortcutPath);
      if (!link.target || !sameWindowsPath(link.target, executablePath)) continue;
      if (link.icon && sameWindowsPath(link.icon, iconPath) && link.iconIndex === 0) continue;
      if (!access.update(shortcutPath, iconPath)) failed.push(shortcutPath);
    } catch {
      failed.push(shortcutPath);
    }
  }
  return failed;
}
