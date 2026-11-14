/**
 * 写系统剪贴板，返回是否成功。
 *
 * 复制点散落在会话流 / 文件面板 / 审查面板，各处只共用「写入 + 成败」这一步；
 * toast 文案与失败措辞仍归调用方（上下文不同，提示不一样）。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
