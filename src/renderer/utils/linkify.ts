/**
 * 用户消息正文 linkify（渲染层纯函数）：
 * 把 http(s) URL 从纯文本里切出来渲染成外链，其余文本原样保留。
 * 只认带 scheme 的 URL——裸域名（www.foo.com）误判面太大（文件名、版本号）。
 */

export interface MessageUrlPart {
  kind: "text" | "url";
  value: string;
}

/**
 * URL 正文字符：排除空白、引号尖括号，以及中文全角标点——URL 不会裸含这些字符，
 * 出现即说明 URL 已结束（中文输入常在 URL 后直接跟标点、不加空格）。
 * 不做 ASCII 白名单：中文路径（如维基 IRI）照样能识别。
 */
const URL_RE =
  /https?:\/\/[^\s<>"'。，、；：！？…·～—－（）「」『』【】《》〈〉〔〕［］｛｝”“‘’]+/gi;

/** 尾部会跟着句读的标点：修剪到 URL 真正结束的位置。 */
const TRAILING_STRIP = new Set([
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  "…",
  "、",
  "，",
  "；",
  "：",
  "！",
  "？",
  "》",
  "〉",
  "」",
  "』",
  "】",
  "”",
  "’",
  '"',
  "'",
]);

/** 不配对的右括号按标点修剪（用户包一层括号写 URL 很常见），配对的保留。 */
function trimUnbalancedBracket(url: string, end: number, close: string, open: string): number {
  let opens = 0;
  let closes = 0;
  for (let i = 0; i < end; i += 1) {
    const ch = url[i];
    if (ch === open) opens += 1;
    else if (ch === close) closes += 1;
  }
  return closes > opens ? end - 1 : -1;
}

function trimTrailingNoise(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1] ?? "";
    if (ch === ")" || ch === "]") {
      const next = trimUnbalancedBracket(url, end, ch, ch === ")" ? "(" : "[");
      if (next >= 0) {
        end = next;
        continue;
      }
      break;
    }
    if (TRAILING_STRIP.has(ch)) {
      end -= 1;
      continue;
    }
    break;
  }
  return url.slice(0, end);
}

/**
 * 「是不是一条 web 外链」的唯一判据：图标槽与「点击交系统浏览器」都只认 http(s)。
 * 与 URL_RE 是两件事——那条管从正文里切出 URL（含尾部标点修剪），这条管一个
 * 已经拿到手的地址串该按外链渲染还是退回纯文本 / 死链。
 */
export function isExternalHttpUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

/**
 * 把文本切成 text / url 片段（顺序即原文顺序）。
 * 被修剪掉的尾部标点归入其后的 text 片段，正文一个字符都不丢。
 */
export function splitMessageUrls(text: string): MessageUrlPart[] {
  const parts: MessageUrlPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index;
    // scheme 字符不在修剪集合里，结果不可能为空
    const url = trimTrailingNoise(match[0]);
    if (start > last) parts.push({ kind: "text", value: text.slice(last, start) });
    parts.push({ kind: "url", value: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}
