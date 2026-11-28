import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { AgentWorkspaceWindowMount } from "./AgentWorkspaceWindowMount";
import { BashWorkspaceWindowMount } from "./BashWorkspaceWindowMount";
import { ModalMount } from "./ModalMount";
import { WidgetMount } from "./WidgetMount";

/**
 * 扩展 View 宿主：modal 栈与工作区非模态浮窗挂在 App 根。
 * 只渲染 active 会话的视图，浮窗不依赖侧栏页签是否挂载。
 * widget 由 SessionArea 的 WidgetMountAbove/Below 承载（同样按 active 过滤）。
 */
export function ExtensionViewHost() {
  const { visibleModals, floatingWorkspaces } = useExtensionViewStore();
  return (
    <>
      {floatingWorkspaces.map((entry) =>
        entry.root.type === "bash-workspace" ? (
          <BashWorkspaceWindowMount key={entry.id} entry={entry} />
        ) : (
          <AgentWorkspaceWindowMount key={entry.id} entry={entry} />
        ),
      )}
      {visibleModals.map((entry) => (
        <ModalMount key={entry.id} entry={entry} />
      ))}
    </>
  );
}

/** 输入框上方 widget 槽：可同时挂多条（隔离失效兜底时不丢表单）。 */
export function WidgetMountAbove() {
  const { widgetAboveList } = useExtensionViewStore();
  if (widgetAboveList.length === 0) return null;
  return (
    <>
      {widgetAboveList.map((entry) => (
        <WidgetMount key={entry.id} entry={entry} side="aboveEditor" />
      ))}
    </>
  );
}

/** 输入框下方 widget 槽。 */
export function WidgetMountBelow() {
  const { widgetBelowList } = useExtensionViewStore();
  if (widgetBelowList.length === 0) return null;
  return (
    <>
      {widgetBelowList.map((entry) => (
        <WidgetMount key={entry.id} entry={entry} side="belowEditor" />
      ))}
    </>
  );
}
