import type { InspectorDomNode } from "../../../../../shared/ipc";
import { useT } from "../../../../hooks/useT";
import { useInspectorStore } from "../../../../stores/inspectorStore";
import styles from "./BrowserInspector.module.css";

/**
 * 「结构」tab（docs/design/06 §3.2）：祖先链（根 → 当前）+ 当前节点 + 直接子元素一层。
 * 点击祖先 / 子元素可把检查目标切过去（`selectNode`）；
 * 祖先链走页面侧索引路径解析，阴影 DOM 内的祖先是不可点击的（nodeId 为 null）。
 */

/** 单行节点展示（祖先链与子元素共用）。 */
function NodeRow({
  node,
  depth,
  current,
  onSelect,
}: {
  node: InspectorDomNode;
  depth: number;
  current?: boolean;
  onSelect?: () => void;
}) {
  const t = useT();
  const label = `${node.nodeName.toLowerCase()}${node.id ? `#${node.id}` : ""}${
    node.classes.length > 0 ? `.${node.classes.join(".")}` : ""
  }`;
  return (
    <button
      type="button"
      className={[styles.treeRow, current ? styles.treeRowCurrent : ""].join(" ")}
      style={{ paddingLeft: 4 + depth * 10 }}
      title={onSelect ? t("browser.dom.switchTo", { label }) : label}
      disabled={!onSelect}
      onClick={onSelect}
    >
      <span className={styles.treeLabel}>
        <span className={styles.treeTag}>{node.nodeName.toLowerCase()}</span>
        {node.id && <span className={styles.treeId}>#{node.id}</span>}
        {node.classes.length > 0 && (
          <span className={styles.treeClass}>.{node.classes.join(".")}</span>
        )}
      </span>
      {!current && node.childCount > 0 && (
        <span className={styles.treeCount}>{node.childCount}</span>
      )}
    </button>
  );
}

/**
 * 生成稳定且互不重复的 React key：同名同类的兄弟节点靠出现序号区分，
 * 既避开数组下标 key，也不会因内容重排而复用错行。
 */
function keyed(nodes: InspectorDomNode[]): Array<{ key: string; node: InspectorDomNode }> {
  const seen = new Map<string, number>();
  return nodes.map((node) => {
    const signature = `${node.nodeName}${node.id ? `#${node.id}` : ""}.${node.classes.join(".")}`;
    const nth = (seen.get(signature) ?? 0) + 1;
    seen.set(signature, nth);
    return { key: `${signature}:${nth}`, node };
  });
}

/** 祖先链/子元素的展示名（与托盘条目同格式：tag.class）。 */
function targetLabel(node: InspectorDomNode): string {
  return `${node.nodeName.toLowerCase()}${
    node.classes.length > 0 ? `.${node.classes.join(".")}` : ""
  }`;
}

/** 可点击的节点才有切换回调；阴影 DOM 内的祖先拿不到 nodeId，保持只读。 */
function selectHandler(
  node: InspectorDomNode,
  selectNode: (nodeId: number, label: string) => void,
): (() => void) | undefined {
  const nodeId = node.nodeId;
  if (nodeId === null) return undefined;
  return () => selectNode(nodeId, targetLabel(node));
}

export function DomTreeTab({ compact }: { compact: boolean }) {
  const t = useT();
  const { domTree, loading, stale, selectNode } = useInspectorStore();

  if (loading && !domTree) return <p className={styles.empty}>{t("browser.dom.loading")}</p>;
  if (!domTree) {
    return (
      <p className={styles.empty}>
        {stale ? t("browser.dom.stale") : t("browser.dom.noSelection")}
      </p>
    );
  }

  const selfDepth = domTree.ancestors.length;

  return (
    <div>
      {keyed(domTree.ancestors).map(({ key, node }, depth) => (
        <NodeRow key={key} node={node} depth={depth} onSelect={selectHandler(node, selectNode)} />
      ))}
      <NodeRow node={domTree.self} depth={selfDepth} current />

      {compact ? (
        <p className={styles.sectionTitle}>{t("browser.dom.compactChildren")}</p>
      ) : (
        keyed(domTree.self.children ?? []).map(({ key, node }) => (
          <NodeRow
            key={key}
            node={node}
            depth={selfDepth + 1}
            onSelect={selectHandler(node, selectNode)}
          />
        ))
      )}
    </div>
  );
}
