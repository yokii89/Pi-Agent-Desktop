import path from "node:path";

interface ShortcutIconAccess {
  exists(shortcutPath: string): boolean;
  read(shortcutPath: string): { target?: string; icon?: string; iconIndex?: number };
  update(shortcutPath: string, iconPath: string): boolean;
}

function sameWindowsPath(left: string, right: string): boolean {
  return path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
}

/** NSIS 按 productName 生成快捷方式文件名，用户可能改名，但默认就是这个。 */
const SHORTCUT_NAME = "PiDesk.lnk";

/** 图标需要跟随的快捷方式落点：桌面（用户 / 公共）与开始菜单（用户 / 所有用户）。 */
export interface ShortcutLocations {
  desktop: string;
  publicDesktop: string | null;
  startMenuPrograms: string | null;
  allUsersStartMenuPrograms: string | null;
}

/** 列出全部候选 .lnk；不判断是否存在（存在性与归属由 updateAppIconShortcuts 逐个核对）。 */
export function collectAppIconShortcuts(locations: ShortcutLocations): string[] {
  const roots = [
    locations.desktop,
    locations.publicDesktop,
    locations.startMenuPrograms,
    locations.allUsersStartMenuPrograms,
  ];
  return roots
    .filter((root): root is string => typeof root === "string" && root.length > 0)
    .map((root) => path.win32.join(root, SHORTCUT_NAME));
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
