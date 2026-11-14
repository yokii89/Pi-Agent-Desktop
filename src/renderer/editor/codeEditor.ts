import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Text } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type {
  CodeEditorMountHandle,
  CodeEditorMountOptions,
  CodeScrollAnchor,
} from "./codeEditorTypes";
import { editorLanguageFor, loadEditorLanguage } from "./editorLanguages";

/** 脏状态重算的合帧延迟：连打时一直顺延，停手后算一次全文比较。 */
const DIRTY_DEBOUNCE_MS = 180;

/**
 * 语法色：一律吃 `tokens.css` 的 `--syn-*`（两套主题各一份），
 * 与预览态 shiki 的 github 主题同一套观感，编辑/预览切换不闪色。
 */
const highlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.moduleKeyword],
    color: "var(--syn-keyword)",
  },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--syn-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--syn-number)" },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "var(--syn-comment)",
    fontStyle: "italic",
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--syn-function)",
  },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: "var(--syn-type)" },
  {
    tag: [tags.propertyName, tags.attributeName, tags.definition(tags.variableName)],
    color: "var(--syn-property)",
  },
  {
    tag: [tags.operator, tags.logicOperator, tags.compareOperator, tags.arithmeticOperator],
    color: "var(--syn-operator)",
  },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: "var(--syn-punctuation)" },
  { tag: [tags.variableName, tags.self, tags.labelName], color: "var(--syn-variable)" },
  { tag: [tags.heading, tags.strong], color: "var(--color-text-strong)", fontWeight: "600" },
  { tag: [tags.link, tags.url], color: "var(--color-accent-link)", textDecoration: "underline" },
  { tag: tags.invalid, color: "var(--color-danger)" },
]);

/**
 * 编辑器外壳：全部走 tokens 变量（组件内禁止写死色值）。
 * 唯一按主题分岔的是 CodeMirror 的 dark 标记（影响原生选区与滚动条观感）。
 */
function buildTheme(dark: boolean): ReturnType<typeof EditorView.theme> {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        color: "var(--color-text)",
        backgroundColor: "transparent",
        fontFamily: "var(--code-font-family)",
        fontSize: "var(--code-font-size)",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": {
        fontFamily: "var(--code-font-family)",
        lineHeight: "var(--code-line-height)",
        overflow: "auto",
      },
      ".cm-content": {
        padding: "var(--code-padding) 0",
        caretColor: "var(--color-accent)",
      },
      ".cm-line": { padding: "0 var(--code-padding)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-accent)" },
      ".cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--color-selection) !important",
      },
      ".cm-gutters": {
        backgroundColor: "var(--code-gutter-bg, var(--color-bg-elevated))",
        color: "var(--color-text-muted)",
        border: "none",
        borderRight: "1px solid var(--color-border)",
        userSelect: "none",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 var(--spacing-sm) 0 var(--spacing-xs)",
        minWidth: "2ch",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: "var(--color-text-muted)",
      },
      ".cm-activeLine": { backgroundColor: "transparent" },
      ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
        backgroundColor: "var(--color-accent-soft)",
        outline: "1px solid var(--color-border-strong)",
      },
      ".cm-nonmatchingBracket": { color: "var(--color-danger)" },
      ".cm-selectionMatch": { backgroundColor: "var(--color-accent-soft)" },
      ".cm-specialChar": { color: "var(--color-warning)" },
      // 编辑态查找（Ctrl+F）：CM 自带面板，配色与图层面板对齐
      ".cm-panels": {
        backgroundColor: "var(--color-bg-surface)",
        color: "var(--color-text)",
        borderBottom: "1px solid var(--color-border)",
      },
      ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--color-border)" },
      ".cm-panel.cm-search": {
        padding: "var(--spacing-xs) var(--spacing-sm)",
        fontFamily: "var(--font-body, inherit)",
        fontSize: "var(--font-size-sm)",
      },
      ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label": {
        fontSize: "var(--font-size-sm)",
      },
      ".cm-textfield": {
        backgroundColor: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        color: "var(--color-text)",
        padding: "2px 6px",
      },
      ".cm-textfield:focus": { borderColor: "var(--color-accent)", outline: "none" },
      ".cm-button": {
        backgroundImage: "none",
        backgroundColor: "var(--color-bg-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        color: "var(--color-text)",
        padding: "2px 8px",
      },
      ".cm-button:hover": { backgroundColor: "var(--color-bg-hover)" },
      ".cm-searchMatch": {
        backgroundColor: "var(--color-accent-soft)",
        outline: "1px solid var(--color-border-strong)",
      },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--color-selection)" },
      ".cm-panel.cm-search [name=close]": { color: "var(--color-text-muted)", cursor: "pointer" },
      ".cm-tooltip": {
        backgroundColor: "var(--color-bg-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        color: "var(--color-text)",
      },
      ".cm-placeholder": { color: "var(--color-text-muted)" },
    },
    { dark },
  );
}

/**
 * 挂载编辑器（懒加载 chunk 的入口，见 `components/ui/CodeEditor.tsx`）。
 *
 * 语言包不在首帧阻塞：先用纯文本建视图（可立刻打字），随后动态 import 语言扩展
 * 经 Compartment 追加——侧栏开关一次编辑态不该等一个语法包下载完。
 */
export function mountCodeEditor(options: CodeEditorMountOptions): CodeEditorMountHandle {
  const languageCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const initialTheme = options.dark;

  let baseline = Text.of(options.doc.split("\n"));
  let dirty = false;
  let dirtyTimer: number | null = null;
  let destroyed = false;
  const callbacks = { onSave: options.onSave, onDirtyChange: options.onDirtyChange };

  const reportDirty = (next: boolean): void => {
    if (next === dirty) return;
    dirty = next;
    callbacks.onDirtyChange(next);
  };

  const computeDirty = (): boolean => {
    if (destroyed) return dirty;
    // Text.eq compares CodeMirror's persistent document structure without allocating the full text.
    return !view.state.doc.eq(baseline);
  };

  const flushDirty = (): void => {
    dirtyTimer = null;
    reportDirty(computeDirty());
  };

  const scheduleDirty = (): void => {
    if (dirtyTimer !== null) window.clearTimeout(dirtyTimer);
    dirtyTimer = window.setTimeout(flushDirty, DIRTY_DEBOUNCE_MS);
  };

  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        EditorView.lineWrapping,
        syntaxHighlighting(highlightStyle),
        languageCompartment.of([]),
        themeCompartment.of(buildTheme(initialTheme)),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              callbacks.onSave();
              return true;
            },
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.contentAttributes.of({ "aria-label": options.ariaLabel, spellcheck: "false" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) scheduleDirty();
        }),
      ],
    }),
  });

  view.focus();
  if (options.scrollAnchor) {
    restoreScrollAnchor(view, options.scrollAnchor);
  } else if (options.focusLine != null && options.focusLine >= 1) {
    revealLine(view, options.focusLine);
  }

  const languageId = editorLanguageFor(options.filePath);
  if (languageId) {
    void loadEditorLanguage(languageId).then((extension) => {
      if (destroyed || !extension) return;
      view.dispatch({ effects: languageCompartment.reconfigure(extension) });
    });
  }

  return {
    getValue: () => view.state.doc.toString(),
    getScrollAnchor: () => readScrollAnchor(view),
    isDirty: () => computeDirty(),
    recomputeDirty: () => {
      if (dirtyTimer !== null) {
        window.clearTimeout(dirtyTimer);
        dirtyTimer = null;
      }
      reportDirty(computeDirty());
    },
    setBaseline(text: string) {
      baseline = Text.of(text.split("\n"));
      if (dirtyTimer !== null) {
        window.clearTimeout(dirtyTimer);
        dirtyTimer = null;
      }
      reportDirty(computeDirty());
    },
    setTheme(dark: boolean) {
      if (destroyed) return;
      view.dispatch({ effects: themeCompartment.reconfigure(buildTheme(dark)) });
    },
    focus: () => view.focus(),
    destroy() {
      destroyed = true;
      if (dirtyTimer !== null) window.clearTimeout(dirtyTimer);
      dirtyTimer = null;
      view.destroy();
    },
  };
}

/** 读取当前视口顶部对应的源码行及其相对偏移。 */
function readScrollAnchor(view: EditorView): CodeScrollAnchor {
  const top = view.scrollDOM.getBoundingClientRect().top;
  const blocks = view.viewportLineBlocks;
  const block = blocks.find((item) => item.top + item.height + view.documentTop > top) ?? blocks[0];
  if (!block) return { line: 1, offset: 0 };
  return {
    line: view.state.doc.lineAt(block.from).number,
    offset: block.top + view.documentTop - top,
  };
}

/** 挂载后恢复到与只读预览相同的源码行位置。 */
function restoreScrollAnchor(view: EditorView, anchor: CodeScrollAnchor): void {
  const line = view.state.doc.line(Math.min(Math.max(anchor.line, 1), view.state.doc.lines));
  view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "start" }) });
  let frame = 0;
  const adjust = (): void => {
    if (frame++ >= 4) return;
    const coords = view.coordsAtPos(line.from);
    const scrollerTop = view.scrollDOM.getBoundingClientRect().top;
    if (coords) {
      view.scrollDOM.scrollTop += coords.top - scrollerTop - anchor.offset;
      return;
    }
    requestAnimationFrame(adjust);
  };
  requestAnimationFrame(adjust);
}

/** 把目标行滚到视野中部（与预览态 `focusLine` 的行为对齐）。 */
function revealLine(view: EditorView, lineNumber: number): void {
  const line = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
  view.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: "center" }),
  });
}
