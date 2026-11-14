import { CaretRight, Folder, FolderOpen } from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { TranslateFn } from "../../../../shared/i18n";
import type { FsEntry, FsListResult } from "../../../../shared/ipc";
import { FileIcon } from "../../../fileIcons";
import { useT } from "../../../hooks/useT";
import { fsService } from "../../../services/fsService";
import { useUiStore } from "../../../stores/uiStore";
import { copyTextToClipboard } from "../../../utils/clipboard";
import { normalizePathKey, relativeToPath, toNativePath } from "../../../utils/fileOpen";
import { revealInNearestScroller } from "../../../utils/revealInScroller";
import { ContextMenu } from "../../ui/ContextMenu";
import type { MenuItem } from "../../ui/Menu";
import styles from "./FileTree.module.css";

/** 「在树中定位」请求（uiStore fileRevealRequest 的载荷）。 */
export interface FileRevealRequest {
  path: string;
  tick: number;
}

interface FileNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  /** 目录项超过单次上限时为 true（提示"已截断"）。 */
  truncated?: boolean;
}

/** children 的 parentPath 必须是绝对路径，list/read 才相对项目根而非 Electron cwd。 */
function toNodes(entries: FsEntry[], parentAbs: string): FileNode[] {
  const parent = parentAbs.replace(/\\/g, "/").replace(/\/+$/, "");
  return entries.map((entry) => ({
    name: entry.name,
    path: parent ? `${parent}/${entry.name}` : entry.name,
    kind: entry.kind,
  }));
}

/** 列目录结果 → 节点数组；截断时追加占位行（根与子目录共用）。 */
function buildNodes(result: FsListResult, parentAbs: string, t: TranslateFn): FileNode[] {
  const list = toNodes(result.entries, parentAbs);
  if (result.truncated) {
    list.push({
      name: t("panels.files.dirTruncated"),
      path: parentAbs,
      kind: "file",
      truncated: true,
    });
  }
  return list;
}

interface FileTreeProps {
  /** 根目录（当前项目目录）。 */
  rootDir: string;
  selectedPath: string | null;
  onSelectFile: (absolutePath: string) => void;
  /** 面板是否可见；隐藏时退订全部 watcher（订阅数归零关闭监听）。默认 true。 */
  active?: boolean;
  /** 非空时展开目标路径的祖先链并滚动定位（命令面板目录命中）。 */
  revealRequest?: FileRevealRequest | null;
}

/**
 * 目标绝对路径 → 从根到目标的节点 path 链（节点 path 统一 / 分隔，见 toNodes）。
 * 目标不在根下时返回空链（无从定位，不猜）。
 */
function buildRevealChain(rootDir: string, target: string): string[] {
  const root = rootDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const norm = target.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root || !norm) return [];
  if (!norm.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return [];
  const rest = norm.slice(root.length).replace(/^\/+/, "");
  if (!rest) return [];
  const chain: string[] = [];
  let acc = root;
  for (const seg of rest.split("/")) {
    acc = `${acc}/${seg}`;
    chain.push(acc);
  }
  return chain;
}

/**
 * 真实目录文件树：按需加载（展开目录时才 list），
 * 文件夹在前、字母序由主进程保证（docs/design/03 §5）。
 *
 * 自刷新（docs/design 30 §2.3）：只对「已展开且面板可见」的目录订阅 fs.watch，
 * 主进程合批推送受影响目录集合，命中目录的版本 +1 → 触发对应节点局部重列，
 * 不整树刷新、不重挂载，展开状态与选中项都保留。
 */
export function FileTree({
  rootDir,
  selectedPath,
  onSelectFile,
  active = true,
  revealRequest = null,
}: FileTreeProps) {
  const t = useT();
  const [nodes, setNodes] = useState<FileNode[] | null>(null);
  const [error, setError] = useState(false);
  /** 目录归一 path → 版本号；外部改动命中即 +1，作为重列信号。 */
  const [versions, setVersions] = useState<Record<string, number>>({});
  /** reveal：强制展开的节点 path（归一）集合 + 待滚动定位的节点 path。 */
  const [expandKeys, setExpandKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const revealTickRef = useRef<number | null>(null);

  // 订阅目录变动推送（合批）：命中目录版本 +1
  useEffect(() => {
    const unsubscribe = fsService.onChanged((message) => {
      if (!message || message.dirs.length === 0) return;
      setVersions((prev) => {
        const next = { ...prev };
        for (const dir of message.dirs) {
          const key = normalizePathKey(dir);
          next[key] = (next[key] ?? 0) + 1;
        }
        return next;
      });
    });
    return unsubscribe;
  }, []);

  // 切换项目时清空旧目录内容（旧 root 不再可达）
  // biome-ignore lint/correctness/useExhaustiveDependencies: rootDir 是重置信号，效果体内不直接引用
  useEffect(() => {
    setNodes(null);
    setError(false);
    setExpandKeys(new Set());
    setRevealKey(null);
  }, [rootDir]);

  // reveal 请求：祖先链全部展开（链上最后一个若是目录也展开，能看到子项），
  // 尾节点滚进可视区。逐层懒加载挂载后各节点自己认领，无需等待加载完成。
  useEffect(() => {
    if (!revealRequest || revealRequest.tick === revealTickRef.current) return;
    revealTickRef.current = revealRequest.tick;
    const chain = buildRevealChain(rootDir, revealRequest.path);
    setExpandKeys(new Set(chain.map((path) => normalizePathKey(path))));
    setRevealKey(chain.length > 0 ? chain[chain.length - 1] : null);
  }, [revealRequest, rootDir]);

  // 面板可见时监听根目录；隐藏/卸载即退订
  useEffect(() => {
    if (!active || !rootDir) return;
    fsService.watch(rootDir);
    return () => {
      fsService.unwatch(rootDir);
    };
  }, [active, rootDir]);

  // 加载/重载根目录子项；根版本变化（外部改动）触发重载，不重置为 loading 避免闪烁
  const rootVersion = versions[normalizePathKey(rootDir)] ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: rootVersion 是外部改动的重载信号，不在闭包内读取
  useEffect(() => {
    let cancelled = false;
    fsService
      .list(rootDir)
      .then((result) => {
        if (cancelled) return;
        setError(false);
        setNodes(buildNodes(result, rootDir, t));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rootDir, rootVersion, t]);

  if (error) {
    return <p className={styles.empty}>{t("panels.files.readDirFailed")}</p>;
  }
  if (nodes === null) {
    return <p className={styles.empty}>{t("common.loading")}</p>;
  }
  return (
    <ul className={styles.tree}>
      {nodes.map((node) => (
        <FileTreeNode
          key={`${node.kind}:${node.path}`}
          node={node}
          depth={0}
          rootDir={rootDir}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          active={active}
          versions={versions}
          expandKeys={expandKeys}
          revealKey={revealKey}
        />
      ))}
    </ul>
  );
}

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  /** 项目根：仅用于右键菜单里的「相对路径」。 */
  rootDir: string;
  selectedPath: string | null;
  onSelectFile: (absolutePath: string) => void;
  active: boolean;
  versions: Record<string, number>;
  /** reveal：命中本节点 path 时强制展开（仅目录生效）。 */
  expandKeys: ReadonlySet<string>;
  /** reveal：命中本节点 path 时滚动进可视区。 */
  revealKey: string | null;
}

function FileTreeNode({
  node,
  depth,
  rootDir,
  selectedPath,
  onSelectFile,
  active,
  versions,
  expandKeys,
  revealKey,
}: FileTreeNodeProps) {
  const t = useT();
  const { showToast } = useUiStore();
  const rowRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FileNode[] | null>(null);
  /** 右键菜单落点（光标坐标）。 */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const isDir = node.kind === "dir";
  const version = versions[normalizePathKey(node.path)] ?? 0;

  // reveal：祖先链展开（懒加载树逐层挂载后各节点认领自己那层）
  useEffect(() => {
    if (!isDir) return;
    if (expandKeys.has(normalizePathKey(node.path))) setOpen(true);
  }, [isDir, expandKeys, node.path]);

  // reveal：命中本节点 → 滚进可视区（只滚文件面板这一层，不碰祖先滚动容器）
  useEffect(() => {
    if (revealKey !== null && normalizePathKey(revealKey) === normalizePathKey(node.path)) {
      const row = rowRef.current;
      if (row) revealInNearestScroller(row);
    }
  }, [revealKey, node.path]);

  // 展开且面板可见时监听该目录；折叠/隐藏/卸载即退订（订阅数归零关 watcher）
  useEffect(() => {
    if (!isDir || !open || !active) return;
    fsService.watch(node.path);
    return () => {
      fsService.unwatch(node.path);
    };
  }, [isDir, open, active, node.path]);

  // 展开时加载子项；目录版本变化（外部改动）触发局部重载
  // biome-ignore lint/correctness/useExhaustiveDependencies: version 是目录改动的局部重载信号，不在闭包内读取
  useEffect(() => {
    if (!isDir || !open) return;
    let cancelled = false;
    fsService
      .list(node.path)
      .then((result) => {
        if (cancelled) return;
        setChildren(buildNodes(result, node.path, t));
      })
      .catch(() => {
        if (!cancelled) setChildren([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isDir, open, node.path, version, t]);

  const selected =
    selectedPath !== null && normalizePathKey(selectedPath) === normalizePathKey(node.path);
  /** 深度交给 CSS 的 --tree-indent 公式，保证与 caret 列宽同源不漂移。 */
  const depthStyle = { "--tree-depth": depth } as CSSProperties;

  if (node.truncated) {
    return (
      <li>
        <span className={[styles.row, styles.placeholder].join(" ")} style={depthStyle}>
          {node.name}
        </span>
      </li>
    );
  }

  const toggle = (): void => {
    if (!isDir) {
      onSelectFile(node.path);
      return;
    }
    setOpen((prev) => !prev);
  };

  /** 写剪贴板 + 双向反馈（与文件预览同一范式）。 */
  const copy = (text: string): void => {
    void copyTextToClipboard(text).then((ok) =>
      showToast(ok ? t("toast.copied") : t("toast.copyFailed")),
    );
  };

  const openMenu = (event: React.MouseEvent): void => {
    event.preventDefault();
    // 行菜单优先：不再冒泡给面板层的预览右键
    event.stopPropagation();
    setMenuAt({ x: event.clientX, y: event.clientY });
  };

  /** 「在资源管理器中显示」：失败（路径已被移走）把可读原因交给 toast。 */
  const reveal = (): void => {
    fsService.reveal(node.path).catch((err: unknown) => {
      showToast(err instanceof Error ? err.message : t("panels.files.systemOpenFailed"));
    });
  };

  /** 「在系统中打开」：文件用默认程序，目录进资源管理器（与预览头部同一个通道）。 */
  const openInSystem = (): void => {
    fsService.openPath(node.path).catch((err: unknown) => {
      showToast(err instanceof Error ? err.message : t("panels.files.systemOpenFailed"));
    });
  };

  const menuItems: MenuItem[] = menuAt
    ? [
        {
          key: "path",
          label: t("panels.files.copyPath"),
          onSelect: () => copy(toNativePath(node.path)),
        },
        {
          key: "relative",
          label: t("panels.files.copyRelative"),
          onSelect: () => copy(toNativePath(relativeToPath(rootDir, node.path))),
        },
        {
          key: "reveal",
          label: t("panels.files.revealInExplorer"),
          dividerBefore: true,
          onSelect: reveal,
        },
        ...(isDir
          ? [
              {
                key: "open",
                label: t("panels.files.openFolder"),
                onSelect: openInSystem,
              },
            ]
          : [{ key: "open", label: t("panels.files.openInSystem"), onSelect: openInSystem }]),
      ]
    : [];

  return (
    <li>
      <button
        ref={rowRef}
        type="button"
        className={[styles.row, selected ? styles.selected : ""].join(" ")}
        style={depthStyle}
        onClick={toggle}
        onContextMenu={openMenu}
      >
        {isDir ? (
          <>
            <span className={styles.caretSlot}>
              <CaretRight
                size={12}
                weight="regular"
                className={[styles.caret, open ? styles.caretOpen : ""].join(" ")}
              />
            </span>
            {open ? (
              <FolderOpen size={16} weight="regular" className={styles.dirIcon} />
            ) : (
              <Folder size={16} weight="regular" className={styles.dirIcon} />
            )}
          </>
        ) : (
          <>
            {/* 与目录 caret 同宽占位，文件图标才能和文件夹图标同列 */}
            <span className={styles.caretSlot} aria-hidden="true" />
            <FileIcon fileName={node.name} className={styles.fileIcon} />
          </>
        )}
        <span className={styles.name}>{node.name}</span>
      </button>
      {isDir && open && children !== null && children.length > 0 && (
        <ul className={styles.tree}>
          {children.map((child) => (
            <FileTreeNode
              key={`${child.kind}:${child.path}`}
              node={child}
              depth={depth + 1}
              rootDir={rootDir}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              active={active}
              versions={versions}
              expandKeys={expandKeys}
              revealKey={revealKey}
            />
          ))}
        </ul>
      )}
      {isDir && open && children !== null && children.length === 0 && (
        <p className={styles.emptyDir} style={depthStyle}>
          {t("panels.files.emptyDir")}
        </p>
      )}
      {menuAt && (
        <ContextMenu position={menuAt} items={menuItems} onClose={() => setMenuAt(null)} />
      )}
    </li>
  );
}
