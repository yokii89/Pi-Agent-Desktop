import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { ModalMount } from "./ModalMount";
import { WidgetMount } from "./WidgetMount";

/**
 * 扩展 View 宿主（modal 栈）：挂在 App 根，覆盖在中央区之上。
 * 只渲染 **active 会话** 的 modal（多会话隔离）。
 * widget 由 SessionArea 的 WidgetMountAbove/Below 承载（同样按 active 过滤）。
 */
export function ExtensionViewHost() {
  const { visibleModals } = useExtensionViewStore();
  return (
    <>
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
