/**
 * DevTools 自身报错的 stderr 过滤器（仅开发态使用）。
 *
 * 背景：`pnpm dev` 会自动打开 detached DevTools，于是每重启一次 Electron，终端就会刷出
 * 下面这两类**与项目代码无关**的 ERROR:CONSOLE：
 *
 * 1. `Request Autofill.enable / Autofill.setAddresses failed` (code -32601)
 *    DevTools 前端在 attach 时固定请求 `Autofill` CDP 域，而 Electron 没有实现它。
 *    官方在 electron/electron#41614 中标记为 wontfix（"doesn't affect any functionality"）。
 *
 * 2. `Unknown VE context: language-mismatch`
 *    DevTools 会比对「浏览器 locale」与「DevTools 界面语言」，不一致时构造一个
 *    `language-mismatch` 的 Visual-Element 上下文；Electron 只打包了 en-US 的 DevTools 文案，
 *    于是中文（zh-CN）环境必然命中这条路径，而该版本 DevTools 的上下文注册表里又没有这个
 *    名字，直接抛错。`scripts/dev.mjs` 已默认加 `--lang=en-US` 从源头对齐；本过滤器
 *    仍保留，用于用户透传覆盖了 `--lang` 的情况。
 *
 * 为什么必须在这一层过滤：这两类日志由 Chromium 直接写 stderr，**不经过 webContents 的
 * `console-message` 事件**（实测 DevTools 的 webContents 不上报任何 console-message），
 * 因此应用侧既拦不住也没法 `preventDefault`；应用侧唯一能做的只是「不开 DevTools」。
 *
 * 设计取向：**只丢这两类明确的白名单噪音，其余 stderr 一律原样透传**——不做 `--log-level`
 * 那种全局降级（会连带吞掉 GPU 崩溃等真实诊断信息，本项目踩过 GPU 进程崩的坑）。
 * 需要看原始输出时设 `PIDESK_SHOW_DEVTOOLS_NOISE=1` 关掉过滤。
 */

/** 单行即可判定的 DevTools 噪音。 */
const NOISE_PATTERNS = [
  /ERROR:CONSOLE\(\d+\)\] "Request Autofill\.(?:enable|setAddresses) failed\./,
  /ERROR:CONSOLE\(\d+\)\] "Unknown VE context: language-mismatch/,
];

/**
 * devtools:// 内部的调用栈帧。`language-mismatch` 之后跟着多行栈，
 * 必须整块吃掉，否则会留下半截「孤儿堆栈」反而更让人困惑。
 */
const DEVTOOLS_STACK_FRAME = /^\s+at .*devtools:\/\/devtools\/bundled\//;

/**
 * 创建一个按行工作的过滤器。
 * @returns {{
 *   feed: (chunk: string) => string,
 *   flush: () => string,
 *   dropped: () => number,
 * }}
 */
export function createDevtoolsNoiseFilter() {
  /** 尚未凑成完整一行的尾部内容（跨 chunk 切分时用到）。 */
  let buffer = "";
  let droppedLines = 0;
  /** 是否正处于 `language-mismatch` 的后续堆栈中。 */
  let inStack = false;

  /** @returns {boolean} 该行是否应当输出。 */
  function shouldKeep(line) {
    if (NOISE_PATTERNS.some((pattern) => pattern.test(line))) {
      inStack = line.includes("Unknown VE context: language-mismatch");
      return false;
    }
    if (inStack) {
      if (DEVTOOLS_STACK_FRAME.test(line)) return false;
      inStack = false;
    }
    return true;
  }

  return {
    /** 送入一段原始 stderr，返回过滤后应当写出的文本（可能为空串）。 */
    feed(chunk) {
      buffer += chunk;
      const lines = buffer.split("\n");
      // 末尾元素可能是被截断的半行，留到下次拼接
      buffer = lines.pop() ?? "";

      let output = "";
      for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (shouldKeep(line)) {
          output += `${line}\n`;
        } else {
          droppedLines += 1;
        }
      }
      return output;
    },

    /** 子进程结束后把残留的不完整行吐出来，避免丢日志。 */
    flush() {
      if (!buffer) return "";
      const rest = buffer;
      buffer = "";
      if (shouldKeep(rest)) return `${rest}\n`;
      droppedLines += 1;
      return "";
    },

    /** 已丢弃的行数，用于在退出时给一句可核对的提示。 */
    dropped() {
      return droppedLines;
    },
  };
}
