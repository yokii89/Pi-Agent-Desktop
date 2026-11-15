import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useImperativeHandle, useRef } from "react";
import { readTerminalTheme, subscribeTerminalTheme } from "../../utils/terminalTheme";
import styles from "./PtyTerminal.module.css";

interface PtyTerminalProps {
  /** 订阅该 pty 的数据 chunk。 */
  subscribeData: (callback: (chunk: string) => void) => () => void;
  /** 取挂载时刻的积压输出（与订阅同帧取值，事件循环保证无竞态）。 */
  backlog: () => string;
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  ariaLabel: string;
  /** 等宽 font-family 栈：变化时热更新 xterm（xterm 不支持 var()，不能直接吃 tokens）。 */
  fontFamily: string;
}

/** xterm 实例句柄：父组件用于展开面板 / 切换 Tab 时聚焦输入区。 */
export interface PtyTerminalHandle {
  focus(): void;
}

/**
 * pty 终端视图：xterm 渲染 + fit 自适应 + 输出回放。
 * 仅用于中央工作区底部终端面板（pi 会话已改走 RPC 模式 + 自研 UI，不再内嵌终端）。
 */
export function PtyTerminal({
  subscribeData,
  backlog,
  onData,
  onResize,
  ariaLabel,
  fontFamily,
  ref,
}: PtyTerminalProps & { ref?: React.Ref<PtyTerminalHandle> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useImperativeHandle(ref, () => ({ focus: () => termRef.current?.focus() }), []);

  // pty 绑定不随渲染变化：仅挂载时建立一次（父层按实例 id 用 key 强制重建）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 生命周期只与挂载相关
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily:
        fontFamily || readToken("--font-family-mono", '"Cascadia Code", Consolas, monospace'),
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: readTerminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    term.element?.setAttribute("aria-label", ariaLabel);
    termRef.current = term;
    const unsubscribeTheme = subscribeTerminalTheme((theme) => {
      term.options.theme = theme;
    });

    // 挂载时回放积压输出，再订阅实时 chunk（同一同步块内完成，无竞态窗口）
    const buffered = backlog();
    if (buffered) term.write(buffered);
    const unsubscribe = subscribeData((chunk) => term.write(chunk));

    // 剪贴板：桌面终端惯例走 Ctrl+Shift+C / Ctrl+Shift+V（Ctrl+C 归 SIGINT）。
    // 必须抢在 xterm 之前拦下：xterm 把 Ctrl 字母组合一律折成控制字符写进 pty，
    // 不拦的话这组键等于往 shell 发信号，正在跑的命令会被打断。
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey) return true;
      if (event.altKey || event.metaKey || event.isComposing) return true;
      if (event.code === "KeyC") {
        const selected = term.getSelection();
        event.preventDefault();
        event.stopPropagation();
        if (selected) void navigator.clipboard.writeText(selected).catch(() => {});
        return false;
      }
      if (event.code === "KeyV") {
        event.preventDefault();
        event.stopPropagation();
        void navigator.clipboard
          .readText()
          .then((text) => {
            // 空剪贴板不注入，避免把 shell 的提示符当成内容处理
            if (text) term.paste(text);
          })
          .catch(() => {});
        return false;
      }
      return true;
    });

    // 用户键盘输入 → 上层写入 pty
    const dataDisposable = term.onData((data) => onData(data));

    const fitNow = (): void => {
      const dimensions = fit.proposeDimensions();
      if (!dimensions || dimensions.cols < 2 || dimensions.rows < 2) return;
      fit.fit();
      onResize(term.cols, term.rows);
    };
    fitNow();

    const observer = new ResizeObserver(fitNow);
    observer.observe(container);

    return () => {
      observer.disconnect();
      unsubscribeTheme();
      unsubscribe();
      dataDisposable.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // 等宽字体预设切换时热更新（挂载时已按当时栈初始化）
  useEffect(() => {
    const term = termRef.current;
    if (term && fontFamily) term.options.fontFamily = fontFamily;
  }, [fontFamily]);

  return <div ref={containerRef} className={styles.container} />;
}

/** 读取 tokens.css 变量的计算值（xterm 的 canvas 测量不支持 var() 表达式）。 */
function readToken(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
