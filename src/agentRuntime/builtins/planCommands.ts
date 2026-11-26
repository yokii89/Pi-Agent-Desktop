const READ_COMMANDS = new Set([
  "pwd",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "stat",
  "du",
  "df",
  "which",
  "whoami",
  "uname",
  "rg",
  "grep",
  "diff",
]);
/** Deliberately small shell grammar: every pipeline/AND segment is checked, with no evaluation or redirection. */
export function isSafePlanCommand(command: string): boolean {
  if (!command.trim() || /[\n\r;<>`$\\{}()]/.test(command) || /(^|[^&])&([^&]|$)/.test(command))
    return false;
  const bodies = command.split(/&&|\|/);
  if (command.includes("||")) return false;
  return bodies.every((body) => {
    const words = body.trim().match(/"[^"\n]*"|'[^'\n]*'|[^\s"']+/g);
    if (!words?.length || words.join(" ").replace(/\s+/g, " ") !== body.trim().replace(/\s+/g, " "))
      return false;
    const tokens = words.map((word) => word.replace(/^(["'])(.*)\1$/, "$2"));
    const name = tokens[0];
    if (!READ_COMMANDS.has(name)) return false;
    // Utilities with output operands, compilation or subprocess options require their own grammar.
    if (
      tokens.some((token) =>
        /^(?:--(?:pre|hostname-bin|output|files0-from|compress-program)(?:=|$)|-[oO])/.test(token),
      )
    )
      return false;
    if (name === "tail" && tokens.some((token) => /^-(?:[^-]*f|[^-]*F)|^--follow/.test(token)))
      return false;
    return true;
  });
}
