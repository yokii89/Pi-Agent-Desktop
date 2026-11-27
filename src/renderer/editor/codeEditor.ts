import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  selectAll,
} from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { getSearchQuery, highlightSelectionMatches, setSearchQuery } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, Text } from "@codemirror/state";
import {
  Decoration,
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
import { createCodeEditorSearch } from "./codeEditorSearch";
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
 * 源码读写共用高亮规则，主题变化不需要替换文档。
 */
const highlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.moduleKeyword],
    color: "var(--syn-keyword)",
  },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--syn-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--syn-number)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--syn-comment)" },
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
  { tag: [tags.heading, tags.strong], color: "var(--color-text-strong)" },
  { tag: [tags.link, tags.url], color: "var(--color-accent-link)" },
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
        fontWeight: "400",
        fontStyle: "normal",
        caretColor: "var(--color-accent-border)",
      },
      ".cm-line": { padding: "0" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-accent-border)" },
      ".cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--color-selection) !important",
      },
      ".cm-gutters": {
        backgroundColor: "var(--code-gutter-bg, var(--color-bg-elevated))",
        color: "var(--color-text-muted)",
        border: "none",
        borderRight: "1px solid var(--color-border)",
        margin: "0 var(--spacing-sm) 0 var(--code-padding)",
        padding: "var(--code-padding) 0",
        userSelect: "none",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        boxSizing: "content-box",
        padding: "0 var(--spacing-sm) 0 0",
        minWidth: "2ch",
        textAlign: "right",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: "var(--color-text-muted)",
      },
      ".cm-activeLine": { backgroundColor: "transparent" },
      ".cm-sourceFocusLine": { backgroundColor: "var(--color-accent-soft)" },
      ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
        backgroundColor: "var(--color-accent-soft)",
        outline: "1px solid var(--color-border-strong)",
      },
      ".cm-nonmatchingBracket": { color: "var(--color-danger)" },
      ".cm-selectionMatch": { backgroundColor: "var(--color-accent-soft)" },
      ".cm-specialChar": { color: "var(--color-warning)" },

      // Go-to-line and other native editor dialogs still share these controls.
      ".cm-panels": {
        backgroundColor: "var(--color-bg-surface)",
        color: "var(--color-text)",
        borderBottom: "1px solid var(--color-border)",
      },
      ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--color-border)" },
      ".cm-textfield": {
        backgroundColor: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        color: "var(--color-text)",
        padding: "2px 6px",
      },
      ".cm-textfield:focus": { borderColor: "var(--color-accent-border)", outline: "none" },
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
  const modeCompartment = new Compartment();
  const focusLineCompartment = new Compartment();
  const initialTheme = options.dark;
  let readOnly = options.readOnly;
  const searchListeners = new Set<() => void>();
  const editorSearch = createCodeEditorSearch(() => {
    options.onSearchChange();
    for (const listener of searchListeners) listener();
  }, options.onFind);
  const selectionListeners = new Set<() => void>();
  const notifySelection = (): void => {
    options.onSelectionChange();
    for (const listener of selectionListeners) listener();
  };

  const modeExtensions = () => [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({ tabindex: "0" }),
    ...(readOnly
      ? []
      : [
          dropCursor(),
          indentOnInput(),
          closeBrackets(),
          keymap.of([...closeBracketsKeymap, ...historyKeymap, indentWithTab]),
        ]),
  ];

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

  const createState = (doc: string, selection?: EditorState["selection"]) =>
    EditorState.create({
      doc,
      selection,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        editorSearch.extension,
        EditorView.lineWrapping,
        syntaxHighlighting(highlightStyle),
        languageCompartment.of([]),
        themeCompartment.of(buildTheme(initialTheme)),
        modeCompartment.of(modeExtensions()),
        focusLineCompartment.of([]),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              if (!view.state.readOnly) callbacks.onSave();
              return true;
            },
          },
          ...defaultKeymap,
        ]),
        EditorView.contentAttributes.of({ "aria-label": options.ariaLabel, spellcheck: "false" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) scheduleDirty();
          if (update.selectionSet || update.viewportChanged || update.focusChanged)
            notifySelection();
        }),
      ],
    });

  const view = new EditorView({
    parent: options.parent,
    state: createState(options.doc),
  });

  if (!readOnly) view.focus();
  if (options.scrollAnchor) {
    restoreScrollAnchor(view, options.scrollAnchor);
  } else if (options.focusLine != null && options.focusLine >= 1) {
    revealLine(view, options.focusLine);
    const line = view.state.doc.line(Math.min(options.focusLine, view.state.doc.lines));
    view.dispatch({
      effects: focusLineCompartment.reconfigure(
        EditorView.decorations.of(
          Decoration.set([Decoration.line({ class: "cm-sourceFocusLine" }).range(line.from)]),
        ),
      ),
    });
  }

  let languageExtension: Awaited<ReturnType<typeof loadEditorLanguage>> = null;
  let dark = initialTheme;
  const languageId = editorLanguageFor(options.filePath);
  if (languageId) {
    void loadEditorLanguage(languageId).then((extension) => {
      if (destroyed || !extension) return;
      languageExtension = extension;
      view.dispatch({ effects: languageCompartment.reconfigure(extension) });
    });
  }

  return {
    getValue: () => view.state.doc.toString(),
    isReady: () => !destroyed,
    getSelectedText: () => selectedText(view),
    getSelection: () => {
      const selection = view.state.selection.main;
      if (!view.hasFocus || selection.empty) return null;
      const from = Math.max(selection.from, view.viewport.from);
      const to = Math.min(selection.to, view.viewport.to);
      if (from > to) return null;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      if (!start || !end) return null;
      return {
        rect: {
          left: Math.min(start.left, end.left),
          top: start.top,
          bottom: end.bottom,
          width: Math.abs(end.right - start.left),
        },
        getText: () => selectedText(view),
      };
    },
    subscribeSelection(listener) {
      selectionListeners.add(listener);
      return () => {
        selectionListeners.delete(listener);
      };
    },
    selectAll() {
      view.focus();
      selectAll(view);
    },
    clearSelection() {
      view.dispatch({ selection: { anchor: view.state.selection.main.head } });
    },
    openFind: options.onFind,
    getSearchResult: editorSearch.getResult,
    subscribeSearch(listener) {
      searchListeners.add(listener);
      return () => {
        searchListeners.delete(listener);
      };
    },
    setSearchQuery: (query) => editorSearch.setQuery(view, query),
    stepSearch: (delta) => editorSearch.step(view, delta),
    replaceSearch: (all) => editorSearch.replace(view, all),
    selectSearchMatches: () => editorSearch.selectMatches(view),
    closeFind: () => editorSearch.clear(view),
    resetDocument(text) {
      if (destroyed) return;
      const anchor = readScrollAnchor(view);
      const selection = view.state.selection;
      const query = getSearchQuery(view.state);
      baseline = Text.of(text.split("\n"));
      if (view.state.doc.eq(baseline)) {
        reportDirty(false);
        return;
      }
      // A discarded draft must not return through Undo on the next edit session.
      view.setState(
        createState(
          text,
          EditorSelection.create(
            selection.ranges.map((range) =>
              EditorSelection.range(
                Math.min(range.anchor, text.length),
                Math.min(range.head, text.length),
              ),
            ),
            selection.mainIndex,
          ),
        ),
      );
      view.dispatch({
        effects: [
          languageCompartment.reconfigure(languageExtension ?? []),
          themeCompartment.reconfigure(buildTheme(dark)),
        ],
      });
      view.dispatch({ effects: setSearchQuery.of(query) });
      restoreScrollAnchor(view, anchor);
      reportDirty(false);
      notifySelection();
    },
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
    setTheme(nextDark: boolean) {
      if (destroyed) return;
      dark = nextDark;
      view.dispatch({ effects: themeCompartment.reconfigure(buildTheme(dark)) });
    },
    setReadOnly(nextReadOnly: boolean) {
      if (destroyed || nextReadOnly === readOnly) return;
      readOnly = nextReadOnly;
      view.dispatch({
        effects: [
          modeCompartment.reconfigure(modeExtensions()),
          focusLineCompartment.reconfigure([]),
        ],
      });
      if (!readOnly) view.focus();
      notifySelection();
    },
    focus: () => view.focus(),
    destroy() {
      destroyed = true;
      if (dirtyTimer !== null) window.clearTimeout(dirtyTimer);
      dirtyTimer = null;
      selectionListeners.clear();
      searchListeners.clear();
      view.destroy();
    },
  };
}

function selectedText(view: EditorView): string {
  return view.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => view.state.sliceDoc(range.from, range.to))
    .join("\n");
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

/** 重载后恢复阅读位置。模式切换直接复用视图，无需同步滚动。 */
function restoreScrollAnchor(view: EditorView, anchor: CodeScrollAnchor): void {
  const line = view.state.doc.line(Math.min(Math.max(anchor.line, 1), view.state.doc.lines));
  view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "start" }) });
  let frame = 0;
  const adjust = (): void => {
    if (!view.dom.isConnected || frame++ >= 4) return;
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
