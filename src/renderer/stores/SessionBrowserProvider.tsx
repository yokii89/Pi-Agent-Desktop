import { type ReactNode, useCallback, useMemo, useSyncExternalStore } from "react";
import { BrowserProvider } from "./browserStore";
import { composerDraftKey } from "./composerDrafts";
import { useComposerStore } from "./composerStore";
import { useProjectStore } from "./projectStore";
import { useSessionMeta } from "./sessionStore";
import { useComposerDraftHandle } from "./useComposerDraft";

/** 仅主窗接入会话草稿；检查器浮窗继续使用独立的 BrowserProvider。 */
export function SessionBrowserProvider({ children }: { children: ReactNode }) {
  const { activeSessionId, phase } = useSessionMeta();
  const { currentProject } = useProjectStore();
  const { drafts } = useComposerStore();
  const record = useComposerDraftHandle(
    composerDraftKey(activeSessionId, currentProject?.dir ?? null, phase),
  );
  // 只订阅元素引用，正文逐字输入不广播给整个浏览器与应用子树。
  const getElements = useCallback(() => record.getSnapshot().chatElements, [record]);
  const elements = useSyncExternalStore(drafts.subscribe, getElements);
  const composerDraft = useMemo(
    () => ({
      record,
      elements,
      markStale: () => drafts.markChatElementsStale(),
    }),
    [record, elements, drafts],
  );
  return <BrowserProvider composerDraft={composerDraft}>{children}</BrowserProvider>;
}
