/**
 * 流式 Markdown 的「定型前缀 + 活动尾块」切分（docs/design/10 §3.1 / docs/design/13 P1-4）。
 *
 * 只有块边界之前的文本才可能被再次改写；边界之后是"活的"尾块。把流式文本切成
 * `已定型块[] + 尾块` 后，前缀块按字符串 memo（引用/值相等 → react-markdown 不再重解析），
 * 每个解析窗口只对尾块付出 parse 代价，同时消除未闭合语法在前缀里的闪烁（B3）。
 *
 * 切分规则（写死，便于测试）：
 * 1. 只在围栏外的空行处切——围栏/表格/紧凑列表内部没有空行，天然不会被劈开；
 * 2. 空行后第一条非空行必须从第 0 列起笔且不是列表项：
 *   - 缩进行（`^\s`）是未闭合容器（列表项/嵌套块）的续写，切出去会掉回顶层、
 *     丢失缩进（docs/design/29 缺陷 C）；
 *   - 列表项标记（LIST_ITEM_RE）：CommonMark 把「空行 + 同类标记」续作松散列表，
 *     劈开会让有序列表重新编号、松散项降级为紧密项；
 *   两条是并列关系，缺一不可（docs/design/29 §3.2 对照表）；
 * 3. 返回值保证前缀单调不缩短（同一轮流式内只追加）——这是"前缀 memo 不失效"的前提，
 *   文本只增不改，已定边界位置随之固定。
 */

/** 围栏开启行：至多 3 空格缩进 + ≥3 个 ` 或 ~（可带 info string）。 */
const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})/;

/** 围栏关闭行：仅同字符围栏标记（长度 ≥ 开启时），无 info string。 */
const FENCE_CLOSE_RE = /^\s{0,3}(`{3,}|~{3,})\s*$/;

/** 列表项行（有序 / 无序）：松散列表续行判定用。 */
const LIST_ITEM_RE = /^\s*(?:\d{1,9}[.)]\s|[-*+]\s)/;

export interface StableSplit {
  blocks: string[];
  tail: string;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/**
 * 扫出"已定型前缀"的切分点。
 * 为什么不直接按 \n\n 切：围栏内的空行不是块边界，切了会把围栏劈成两半，
 * 一个代码块会被当两个 Markdown 片段解析，语言标签和缩进都错。
 */
export function splitStableBlocks(md: string): StableSplit {
  const lines = md.split("\n");

  // 围栏态：记录字符与长度（关闭必须同字符且不短于开启，``` 可包住 `` 内容行）
  let fenceChar = "";
  let fenceLength = 0;
  const candidates: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (fenceChar !== "") {
      const close = FENCE_CLOSE_RE.exec(line);
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLength) {
        fenceChar = "";
        fenceLength = 0;
      }
      continue;
    }
    const open = FENCE_OPEN_RE.exec(line);
    if (open) {
      fenceChar = open[1][0];
      fenceLength = open[1].length;
      continue;
    }
    if (isBlank(line) && i + 1 < lines.length) candidates.push(i + 1);
  }

  // 空行后第一条非空行：缩进行（未闭合容器续写）或列表项（松散续项）→ 该边界作废
  const boundaries = candidates.filter((start) => {
    for (let j = start; j < lines.length; j += 1) {
      if (isBlank(lines[j])) continue;
      const firstNonBlank = lines[j];
      return !/^\s/.test(firstNonBlank) && !LIST_ITEM_RE.test(firstNonBlank);
    }
    return false;
  });

  const blocks: string[] = [];
  let prev = 0;
  for (const start of boundaries) {
    blocks.push(lines.slice(prev, start).join("\n"));
    prev = start;
  }
  return { blocks, tail: lines.slice(prev).join("\n") };
}
