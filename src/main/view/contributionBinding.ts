import type { ExtensionContribution } from "../../shared/contribution";
import type { ViewPlacement, ViewPlacementHint } from "../../shared/view";

/** 将运行时声明绑定到当前上下文；旧客户端不带 key 时仅允许唯一模式匹配。 */
export function resolveContributionBinding(input: {
  entries: ExtensionContribution[];
  contributionKey?: string;
  placement: ViewPlacement;
  hint?: ViewPlacementHint;
  worker: boolean;
}): string | undefined {
  const { entries, contributionKey, placement, hint, worker } = input;
  if (worker && placement !== "settings")
    throw new Error("Extension Worker 仅允许注册全局设置 View");
  if (!contributionKey) {
    if (placement !== "access-mode" || !hint?.mode?.id) return undefined;
    const hits = entries.filter(
      (entry) => entry.placement === placement && entry.id === hint.mode?.id,
    );
    return hits.length === 1 ? hits[0]?.key : undefined;
  }
  const entry = entries.find((candidate) => candidate.key === contributionKey);
  if (!entry || entry.placement !== placement || (worker && !entry.workerSafe)) {
    throw new Error("扩展能力与当前会话目录或运行角色不匹配");
  }
  const id = placement === "access-mode" ? hint?.mode?.id : hint?.panelId;
  if (id !== entry.id) throw new Error("扩展能力 id 与静态声明不匹配");
  return entry.key;
}
