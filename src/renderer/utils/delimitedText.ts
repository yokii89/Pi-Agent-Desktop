export interface DelimitedTable {
  rows: string[][];
  truncated: boolean;
}

const MAX_ROWS = 201;
const MAX_COLUMNS = 40;

/** 解析 CSV/TSV 的引号、转义引号与换行，避免用 split 破坏合法单元格。 */
export function parseDelimitedText(text: string, separator: "," | "\t"): DelimitedTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let truncated = false;

  const pushCell = (): void => {
    if (row.length < MAX_COLUMNS) row.push(cell);
    else truncated = true;
    cell = "";
  };
  const pushRow = (): boolean => {
    pushCell();
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      row = [];
      return true;
    }
    rows.push(row);
    row = [];
    return false;
  };

  let stopped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === separator) {
      pushCell();
    } else if (char === "\n") {
      stopped = pushRow();
      if (stopped) break;
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (!stopped && (cell !== "" || row.length > 0 || text.endsWith(separator))) pushRow();

  return { rows, truncated };
}

export function delimiterForPath(path: string): "," | "\t" {
  return /\.tsv$/i.test(path) ? "\t" : ",";
}
