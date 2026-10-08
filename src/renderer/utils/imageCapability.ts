/**
 * 模型图片能力三态（docs/design/21 §软门禁）。
 * 目录 `Model.input` 只作信号：任何状态都允许发送，仅 `declared-no` 轻提示。
 */

import { t } from "../../shared/i18n";
import type { PiModelInputModality } from "../../shared/ipc";

export type ImageCapability = "supported" | "unknown" | "declared-no";

/** 从 pi `Model.input` 映射能力；缺失/非法 = unknown（乐观放行）。 */
export function imageCapabilityFromInput(input?: PiModelInputModality[] | null): ImageCapability {
  if (!Array.isArray(input) || input.length === 0) return "unknown";
  if (input.includes("image")) return "supported";
  if (input.includes("text")) return "declared-no";
  return "unknown";
}

/** 附件条角标文案；null 表示不提示。 */
export function imageCapabilityHint(capability: ImageCapability): string | null {
  if (capability !== "declared-no") return null;
  return t("session.image.hint");
}

/** 同模型首次附图发送时的一次性 toast。 */
export function imageCapabilityToast(capability: ImageCapability): string | null {
  if (capability !== "declared-no") return null;
  return t("session.image.toast");
}
