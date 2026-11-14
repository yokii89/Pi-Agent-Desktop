/**
 * 侧栏就地编辑器的对外契约（docs/design/141）。
 *
 * 类型单独放一个文件：`components/ui/CodeEditor` 只需要这句 `import type`，
 * 而真正的 CodeMirror 实现（`editor/codeEditor`）是动态 import 的懒加载 chunk——
 * 类型若写在实现文件里，很容易被人顺手写成值导入，把整个编辑器拖进主 bundle。
 */

/** 两种代码视图之间的阅读锚点。 */
export interface CodeScrollAnchor {
  /** 1-based 源码行号。 */
  line: number;
  /** 该行顶部相对滚动视口顶部的像素偏移，可为负值（行已部分滚出）。 */
  offset: number;
}

/** 父组件持有的编辑器句柄。 */
export interface CodeEditorHandle {
  /** 当前文档内容（保存时以此为准，父组件不维护受控文本）。 */
  getValue(): string;
  /** 当前内容是否与基线不同。 */
  isDirty(): boolean;
  /** 立即重算脏状态（离开 / 保存这类关键节点别等去抖）。 */
  recomputeDirty(): void;
  /** 保存成功后由父组件推进基线（同一内容不再算脏）。 */
  setBaseline(text: string): void;
  /** 当前编辑器阅读锚点，供切回只读预览时恢复。 */
  getScrollAnchor(): CodeScrollAnchor;
  focus(): void;
}

/** 挂载参数（懒加载完成后一次性传入）。 */
export interface CodeEditorMountOptions {
  parent: HTMLElement;
  /** 初始文档。 */
  doc: string;
  /** 用于推断语法高亮语言（绝对或相对路径皆可）。 */
  filePath: string;
  /** 当前是否暗色主题：决定 CodeMirror 的 dark 标记与原生选区取色。 */
  dark: boolean;
  /** `path:line` 打开时滚到该行（1-based）。 */
  focusLine?: number | null;
  /** 挂载后恢复的阅读锚点。 */
  scrollAnchor?: CodeScrollAnchor;
  /** 无障碍名称。 */
  ariaLabel: string;
  /** 内容变化（去抖）后回报「是否脏」；值未变不重复回报。 */
  onDirtyChange: (dirty: boolean) => void;
  /** Ctrl+S / Cmd+S。 */
  onSave: () => void;
}

/** 实现侧句柄：比对外契约多出主题与销毁。 */
export interface CodeEditorMountHandle extends CodeEditorHandle {
  setTheme(dark: boolean): void;
  destroy(): void;
}
