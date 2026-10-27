import fsp from "node:fs/promises";
import {
  getSettings,
  settleLegacySessionTitles,
  takeLegacySessionTitles,
  updateSettings,
} from "../settings/settings";
import { invalidateSessionMeta, resolveSessionFile } from "./sessionHistory";
import { scanSessionFile } from "./sessionMeta";
import { appendSessionName } from "./sessionName";

/**
 * 旧版 settings.sessionTitles → pi session_info 的一次性迁移。
 *
 * - pi 已有 session_info（含显式清空）时以 pi 为准，旧标题直接丢弃；
 * - 文件已不存在 / 不在会话目录内的登记视为僵尸，不重试；
 * - 写入失败的条目留在 settings 里，下次启动重试（迁移期间任何设置写盘都会带上它们）。
 */
export async function migrateLegacySessionTitles(): Promise<void> {
  // 先确保设置读盘（旧键在 getSettings 首次读取时被捕获并从缓存剥掉）
  getSettings();
  const { titles, hadKey } = takeLegacySessionTitles();
  if (!hadKey) return;

  const remaining: Record<string, string> = {};
  for (const [rawFile, title] of Object.entries(titles)) {
    let file: string;
    try {
      file = resolveSessionFile(rawFile);
    } catch {
      // 路径非法（旧数据脏了）没有落点，丢弃
      continue;
    }
    try {
      await fsp.stat(file);
    } catch {
      // 会话文件已删除：旧标题没有落点，丢弃
      continue;
    }
    try {
      const scan = await scanSessionFile(file, 0);
      if (scan.sessionName.found) continue;
      await appendSessionName(file, title);
      invalidateSessionMeta(file);
    } catch (err) {
      remaining[rawFile] = title;
      console.warn(`[session-name] 迁移旧标题失败: ${rawFile}`, err);
    }
  }

  settleLegacySessionTitles(Object.keys(remaining).length > 0 ? remaining : null);
  // 写回一次设置：全部迁完 → 移除废弃键；有失败 → 只保留待重试条目
  updateSettings({});
}
