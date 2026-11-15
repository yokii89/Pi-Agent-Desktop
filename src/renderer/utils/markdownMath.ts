/** Normalize TeX delimiters before CommonMark consumes their backslashes, preserving code verbatim. */
export function normalizeMathDelimiters(source: string): string {
  let result = "";
  let fence = "";
  let inline = "";
  for (const line of source.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line);
    if (fence) {
      result += line;
      if (
        marker &&
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = "";
      continue;
    }
    if (!inline && marker) {
      fence = marker[1];
      result += line;
      continue;
    }
    // Indented code blocks must retain literal delimiters too.
    if (!inline && /^(?: {4}|\t)/.test(line)) {
      result += line;
      continue;
    }
    for (let i = 0; i < line.length; ) {
      if (line[i] === "`") {
        const run = /^`+/.exec(line.slice(i))?.[0] ?? "`";
        if (!inline) inline = run;
        else if (inline === run) inline = "";
        result += run;
        i += run.length;
      } else if (!inline && line[i] === "\\" && i + 1 < line.length) {
        const next = line[i + 1];
        result +=
          next === "[" || next === "]"
            ? "\n$$\n"
            : next === "(" || next === ")"
              ? "$"
              : line.slice(i, i + 2);
        i += 2;
      } else {
        result += line[i];
        i += 1;
      }
    }
  }
  return result;
}
