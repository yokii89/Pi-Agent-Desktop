import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { type EditorLanguageId, sourceLanguageForPath } from "../utils/sourceLanguages";

const EDITOR_LANGUAGES: Record<EditorLanguageId, () => Promise<Extension>> = {
  javascript: async () => (await import("@codemirror/lang-javascript")).javascript(),
  typescript: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  "javascript-jsx": async () =>
    (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  "typescript-jsx": async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true }),
  json: async () => (await import("@codemirror/lang-json")).json(),
  css: async () => (await import("@codemirror/lang-css")).css(),
  html: async () => (await import("@codemirror/lang-html")).html(),
  markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
  python: async () => (await import("@codemirror/lang-python")).python(),
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  xml: async () => (await import("@codemirror/lang-xml")).xml(),
  sql: async () => (await import("@codemirror/lang-sql")).sql(),
  rust: async () => (await import("@codemirror/lang-rust")).rust(),
  java: async () => (await import("@codemirror/lang-java")).java(),
  cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
  php: async () => (await import("@codemirror/lang-php")).php(),
  toml: async () =>
    StreamLanguage.define((await import("@codemirror/legacy-modes/mode/toml")).toml),
  properties: async () =>
    StreamLanguage.define((await import("@codemirror/legacy-modes/mode/properties")).properties),
  ruby: async () =>
    StreamLanguage.define((await import("@codemirror/legacy-modes/mode/ruby")).ruby),
  shell: async () =>
    StreamLanguage.define((await import("@codemirror/legacy-modes/mode/shell")).shell),
  powershell: async () =>
    StreamLanguage.define((await import("@codemirror/legacy-modes/mode/powershell")).powerShell),
  go: async () => StreamLanguage.define((await import("@codemirror/legacy-modes/mode/go")).go),
  dockerfile: async () =>
    StreamLanguage.define((await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile),
  csharp: async () =>
    StreamLanguage.define((await import("@codemirror/legacy-modes/mode/clike")).csharp),
  kotlin: async () =>
    StreamLanguage.define((await import("@codemirror/legacy-modes/mode/clike")).kotlin),
  swift: async () =>
    StreamLanguage.define((await import("@codemirror/legacy-modes/mode/swift")).swift),
  nginx: async () =>
    StreamLanguage.define((await import("@codemirror/legacy-modes/mode/nginx")).nginx),
  cmake: async () =>
    StreamLanguage.define((await import("@codemirror/legacy-modes/mode/cmake")).cmake),
  diff: async () =>
    StreamLanguage.define((await import("@codemirror/legacy-modes/mode/diff")).diff),
};

/** Resolves the editor language for a source file. Unknown text files remain editable as plain text. */
export function editorLanguageFor(filePath: string): EditorLanguageId | null {
  return sourceLanguageForPath(filePath)?.editorLanguage ?? null;
}

/** Loads a language extension on demand; failures leave the editor in plain text mode. */
export async function loadEditorLanguage(id: EditorLanguageId): Promise<Extension | null> {
  try {
    return await EDITOR_LANGUAGES[id]();
  } catch {
    return null;
  }
}
