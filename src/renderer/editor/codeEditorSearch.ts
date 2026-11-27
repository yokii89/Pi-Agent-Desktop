import {
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  search,
  searchKeymap,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { CodeSearchQuery, CodeSearchResult } from "./codeEditorTypes";

interface Match {
  from: number;
  to: number;
}

/** Keep source searching in CodeMirror while the file panel owns the shared search UI. */
export function createCodeEditorSearch(onChange: () => void, onOpen: () => void) {
  let matches: Match[] = [];
  let result: CodeSearchResult = { count: 0, current: 0, valid: false };

  const lowerBound = (position: number): number => {
    let low = 0;
    let high = matches.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (matches[middle].from < position) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  const refresh = (view: EditorView, rescan: boolean): void => {
    const query = getSearchQuery(view.state);
    if (rescan) {
      matches = [];
      if (query.valid) {
        const cursor = query.getCursor(view.state);
        for (let next = cursor.next(); !next.done; next = cursor.next()) {
          matches.push(next.value);
        }
      }
    }
    const selection = view.state.selection.main;
    const index = lowerBound(selection.from);
    const match = matches[index];
    const current = match?.from === selection.from && match.to === selection.to ? index + 1 : 0;
    if (
      result.count === matches.length &&
      result.current === current &&
      result.valid === query.valid
    )
      return;
    result = { count: matches.length, current, valid: query.valid };
    onChange();
  };

  const highlight = (view: EditorView): DecorationSet => {
    const decorations = [];
    const selection = view.state.selection.main;
    let last = -1;
    for (const range of view.visibleRanges) {
      for (let index = Math.max(0, lowerBound(range.from) - 1); index < matches.length; index++) {
        const match = matches[index];
        if (match.from > range.to) break;
        if (index <= last || match.to <= range.from || match.from === match.to) continue;
        last = index;
        const selected = match.from === selection.from && match.to === selection.to;
        decorations.push(
          Decoration.mark({
            class: selected ? "cm-searchMatch cm-searchMatch-selected" : "cm-searchMatch",
          }).range(match.from, match.to),
        );
      }
    }
    return Decoration.set(decorations, true);
  };

  const highlights = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        refresh(view, true);
        this.decorations = highlight(view);
      }
      update(update: ViewUpdate): void {
        const queryChanged = !getSearchQuery(update.state).eq(getSearchQuery(update.startState));
        const rescan = queryChanged || update.docChanged;
        if (rescan || update.selectionSet) refresh(update.view, rescan);
        if (rescan || update.selectionSet || update.viewportChanged)
          this.decorations = highlight(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

  const step = (view: EditorView, delta: number): boolean => {
    if (!getSearchQuery(view.state).valid) onOpen();
    else if (delta < 0) findPrevious(view);
    else findNext(view);
    return true;
  };

  return {
    extension: [
      search({ literal: true }),
      highlights,
      keymap.of([
        {
          key: "Mod-f",
          preventDefault: true,
          run: () => {
            onOpen();
            return true;
          },
        },
        ...["F3", "Mod-g"].map((key) => ({
          key,
          preventDefault: true,
          run: (view: EditorView) => step(view, 1),
          shift: (view: EditorView) => step(view, -1),
        })),
        ...searchKeymap.filter(
          (binding) => !["Mod-f", "F3", "Mod-g", "Escape"].includes(binding.key ?? ""),
        ),
      ]),
    ],
    getResult: (): CodeSearchResult => result,
    setQuery(view: EditorView, value: CodeSearchQuery): void {
      const previous = getSearchQuery(view.state);
      const query = new SearchQuery({ ...value, literal: !value.regexp });
      if (query.eq(previous)) return;
      const selection = view.state.selection.main;
      view.dispatch({ effects: setSearchQuery.of(query) });
      if (
        !matches.length ||
        (query.search === previous.search &&
          query.regexp === previous.regexp &&
          query.wholeWord === previous.wholeWord &&
          query.caseSensitive === previous.caseSensitive)
      )
        return;
      const match = matches[lowerBound(selection.from)] ?? matches[0];
      view.dispatch({
        selection: EditorSelection.single(match.from, match.to),
        effects: EditorView.scrollIntoView(match.from, { y: "nearest" }),
      });
    },
    step,
    replace(view: EditorView, all: boolean): void {
      if (view.state.readOnly || !getSearchQuery(view.state).valid) return;
      if (all) replaceAll(view);
      else replaceNext(view);
    },
    selectMatches(view: EditorView): void {
      if (getSearchQuery(view.state).valid) selectMatches(view);
    },
    clear(view: EditorView): void {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
    },
  };
}
