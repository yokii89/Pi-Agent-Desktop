import { useEffect } from "react";
import { useT } from "../../../../hooks/useT";
import { useBrowserStore } from "../../../../stores/browserStore";
import { useInspectorStore } from "../../../../stores/inspectorStore";
import { useStyleEditStore } from "../../../../stores/styleEditStore";
import { AdjustPanel } from "./styleEdit/AdjustPanel";
import { DesignPanel } from "./styleEdit/designPanel/DesignPanel";
import { TargetBar } from "./styleEdit/TargetBar";

/** One style workspace: visual controls and editable CSS share the same draft. */
export function StylesTab({ compact }: { compact: boolean }) {
  const t = useT();
  const inspector = useInspectorStore();
  const edit = useStyleEditStore();
  const browser = useBrowserStore();

  const setFocusNode = edit.setFocusNode;
  useEffect(() => {
    setFocusNode(inspector.nodeId);
  }, [setFocusNode, inspector.nodeId]);

  const pickedElement = browser.lastPicked?.kind === "element" ? browser.lastPicked : null;
  const currentSelector = edit.currentNodeId === inspector.nodeId ? edit.currentSelector : "";
  const targetSelector =
    currentSelector || (!inspector.isAncestorTarget ? (pickedElement?.selector ?? "") : "") || "";
  const target = inspector.label || pickedElement?.label || targetSelector;

  const copyForAi = (): void => {
    let host = t("browser.styles.localPage");
    try {
      host = new URL(browser.url || "http://localhost").host || host;
    } catch {
      host = browser.url || host;
    }
    const css = edit.exportCss(host);
    if (css) browser.copyText(css, t("browser.styles.copyCssLabel"));
  };

  return (
    <div>
      <TargetBar
        target={target}
        targetTitle={targetSelector || target}
        hasDrafts={edit.hasDrafts}
        hasApplied={edit.appliedByNode.size > 0}
        canCopy={edit.exportDeclarationCount > 0}
        applying={edit.applying}
        previewEnabled={edit.previewEnabled}
        onPreviewChange={edit.setPreviewEnabled}
        onApply={() => void edit.applyDrafts()}
        onCopyForAi={copyForAi}
        onDiscard={edit.discardDrafts}
        onClearAll={edit.clearAll}
      />
      <DesignPanel
        disabled={
          Boolean(inspector.stale) ||
          inspector.nodeId === null ||
          edit.currentNodeId !== inspector.nodeId
        }
      />
      {(inspector.nodeId !== null || edit.currentDeclarations.length > 0) && (
        <AdjustPanel compact={compact} />
      )}
    </div>
  );
}
