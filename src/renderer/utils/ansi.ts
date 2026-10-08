/**
 * 终端输出的基础 ANSI SGR 解析（仅 16 色 + 粗体/重置）。
 * 不支持 256 色/真彩：遇到未知序列时丢弃控制符，保留纯文本。
 */

export type AnsiSpan = { text: string; className?: string };

/** ESC 控制符（用码点生成，源码不出现不可见字符）。 */
const ESC = String.fromCharCode(27);

const FG: Record<number, string> = {
  30: "ansiBlack",
  31: "ansiRed",
  32: "ansiGreen",
  33: "ansiYellow",
  34: "ansiBlue",
  35: "ansiMagenta",
  36: "ansiCyan",
  37: "ansiWhite",
  90: "ansiBrightBlack",
  91: "ansiBrightRed",
  92: "ansiBrightGreen",
  93: "ansiBrightYellow",
  94: "ansiBrightBlue",
  95: "ansiBrightMagenta",
  96: "ansiBrightCyan",
  97: "ansiBrightWhite",
};

/** 把含 ANSI 的文本切成带 class 的 span 列表；无转义时返回单段。 */
export function tokenizeAnsi(input: string): AnsiSpan[] {
  const marker = `${ESC}[`;
  if (!input.includes(marker)) {
    return input.length > 0 ? [{ text: input }] : [];
  }

  const spans: AnsiSpan[] = [];
  let bold = false;
  let fg: string | undefined;

  const push = (text: string): void => {
    if (!text) return;
    const classes = [bold ? "ansiBold" : null, fg ?? null].filter(Boolean).join(" ");
    spans.push(classes.length > 0 ? { text, className: classes } : { text });
  };

  let i = 0;
  while (i < input.length) {
    const start = input.indexOf(marker, i);
    if (start === -1) {
      push(input.slice(i));
      break;
    }
    if (start > i) push(input.slice(i, start));

    let j = start + marker.length;
    let params = "";
    let isSgr = false;
    while (j < input.length) {
      const ch = input[j];
      if (ch === "m") {
        isSgr = true;
        break;
      }
      if ((ch >= "0" && ch <= "9") || ch === ";") {
        params += ch;
        j += 1;
        continue;
      }
      break;
    }

    if (!isSgr) {
      const next = input.indexOf(ESC, start + 1);
      i = next === -1 ? input.length : next;
      continue;
    }

    const codes = params
      .split(";")
      .filter((p) => p.length > 0)
      .map(Number);
    const list = codes.length > 0 ? codes : [0];
    for (const code of list) {
      if (code === 0) {
        bold = false;
        fg = undefined;
      } else if (code === 1) {
        bold = true;
      } else if (code === 22) {
        bold = false;
      } else if (code === 39) {
        fg = undefined;
      } else if (FG[code]) {
        fg = FG[code];
      }
    }
    i = j + 1;
  }

  return spans;
}

/** 复制时用的纯文本（去掉 ANSI SGR）。 */
export function stripAnsi(input: string): string {
  const marker = `${ESC}[`;
  let out = "";
  let i = 0;
  while (i < input.length) {
    const start = input.indexOf(marker, i);
    if (start === -1) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, start);
    let j = start + marker.length;
    while (j < input.length && input[j] !== "m") {
      const ch = input[j];
      if (!((ch >= "0" && ch <= "9") || ch === ";")) break;
      j += 1;
    }
    i = input[j] === "m" ? j + 1 : j;
  }
  return out;
}
