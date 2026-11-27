import { t } from "./i18n";
import type { PiImageContent } from "./ipc";

/** 输入栏与主进程共用的单条消息图片数量上限。 */
export const MAX_PROMPT_IMAGES = 8;

/** 读取合法图片载荷；超限必须拒绝整次发送，不能截断后当作全部发送成功。 */
export function readPromptImages(value: unknown): PiImageContent[] {
  if (!Array.isArray(value)) return [];
  const images = value.filter((image): image is PiImageContent => {
    if (!image || typeof image !== "object") return false;
    const item = image as Record<string, unknown>;
    return (
      item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string"
    );
  });
  if (images.length > MAX_PROMPT_IMAGES) {
    throw new Error(t("session.input.tooManyImages", { count: MAX_PROMPT_IMAGES }));
  }
  return images;
}
