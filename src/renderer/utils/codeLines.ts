/** Displayed source lines, excluding the empty line after a final newline. */
export function countCodeLines(code: string): number {
  if (code.length === 0) return 1;
  const parts = code.split("\n");
  if (parts.length > 1 && parts.at(-1) === "") return parts.length - 1;
  return parts.length;
}
