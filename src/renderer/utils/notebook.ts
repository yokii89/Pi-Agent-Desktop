export interface NotebookOutput {
  text: string | null;
  imageDataUrl: string | null;
  truncated: boolean;
}

export interface NotebookCell {
  type: "code" | "markdown" | "raw";
  source: string;
  language: string;
  executionCount: number | null;
  outputs: NotebookOutput[];
}

export interface ParsedNotebook {
  cells: NotebookCell[];
  truncated: boolean;
}

const MAX_CELLS = 50;
const MAX_OUTPUTS_PER_CELL = 5;
const MAX_OUTPUT_TEXT_CHARS = 20_000;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sourceText(value: unknown): string {
  if (typeof value === "string") return value;
  return Array.isArray(value)
    ? value.filter((part): part is string => typeof part === "string").join("")
    : "";
}

function outputText(value: unknown): string | null {
  const text = sourceText(value);
  return text.length > 0 ? text : null;
}

function parseOutput(value: unknown): NotebookOutput | null {
  const output = record(value);
  if (!output) return null;
  const data = record(output.data);
  if (data) {
    const image = sourceText(data["image/png"]).replace(/[\r\n\s]/g, "");
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(image) && image.length > 0) {
      const text = outputText(data["text/plain"]);
      return {
        text: text?.slice(0, MAX_OUTPUT_TEXT_CHARS) ?? null,
        imageDataUrl: `data:image/png;base64,${image}`,
        truncated: (text?.length ?? 0) > MAX_OUTPUT_TEXT_CHARS,
      };
    }
    const text = outputText(data["text/plain"]);
    if (text)
      return {
        text: text.slice(0, MAX_OUTPUT_TEXT_CHARS),
        imageDataUrl: null,
        truncated: text.length > MAX_OUTPUT_TEXT_CHARS,
      };
  }
  const text = outputText(output.text);
  return text
    ? {
        text: text.slice(0, MAX_OUTPUT_TEXT_CHARS),
        imageDataUrl: null,
        truncated: text.length > MAX_OUTPUT_TEXT_CHARS,
      }
    : null;
}

/** 将不可信 notebook JSON 收窄为只渲染支持的纯文本/PNG 数据。 */
export function parseNotebook(content: string): ParsedNotebook | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const notebook = record(parsed);
  if (!notebook || !Array.isArray(notebook.cells)) return null;
  const rawLanguage = record(record(notebook.metadata)?.language_info)?.name;
  const language =
    rawLanguage === "python" || rawLanguage === "javascript" || rawLanguage === "typescript"
      ? rawLanguage
      : "plaintext";
  const cells: NotebookCell[] = [];
  let truncated = false;
  for (const value of notebook.cells) {
    const cell = record(value);
    if (!cell) continue;
    if (cells.length >= MAX_CELLS) {
      truncated = true;
      break;
    }
    const rawType = cell.cell_type;
    const type = rawType === "code" || rawType === "markdown" ? rawType : "raw";
    if (Array.isArray(cell.outputs) && cell.outputs.length > MAX_OUTPUTS_PER_CELL) {
      truncated = true;
    }
    const outputs = Array.isArray(cell.outputs)
      ? cell.outputs
          .slice(0, MAX_OUTPUTS_PER_CELL)
          .map(parseOutput)
          .filter((output): output is NotebookOutput => output !== null)
      : [];
    if (outputs.some((output) => output.truncated)) truncated = true;
    cells.push({
      type,
      source: sourceText(cell.source),
      language,
      executionCount: typeof cell.execution_count === "number" ? cell.execution_count : null,
      outputs,
    });
  }
  return { cells, truncated };
}
