import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useImperativeHandle, useRef } from "react";
import type { Theme } from "../../stores/uiStore";
import styles from "./PtyTerminal.module.css";

interface PtyTerminalProps {
  /** 订阅该 pty 的数据 chunk。 */
  subscribeData: (callback: (chunk: string) => void) => () => void;
  /** 取挂载时刻的积压输出（与订阅同帧取值，事件循环保证无竞态）。 */
  backlog: () => string;
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  ariaLabel: string;
  /** 主题标识：变化时按当前 tokens 重建 xterm 配色。 */
  theme: Theme;
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
  theme,
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
      theme: readXtermTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    term.element?.setAttribute("aria-label", ariaLabel);
    termRef.current = term;

    // 挂载时回放积压输出，再订阅实时 chunk（同一同步块内完成，无竞态窗口）
    const buffered = backlog();
    if (buffered) term.write(buffered);
    const unsubscribe = subscribeData((chunk) => term.write(chunk));

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
      unsubscribe();
      dataDisposable.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // 主题切换时跟随 tokens 重建配色（xterm 不支持 var()，只能读计算值）
  // biome-ignore lint/correctness/useExhaustiveDependencies: theme 仅作为重读 tokens 的信号
  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = readXtermTheme();
  }, [theme]);

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

/** 按当前主题读取 xterm 配色。 */
function readXtermTheme(): {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
} {
  return {
    background: readToken("--terminal-bg", "#0d0d0f"),
    foreground: readToken("--terminal-fg", "#cccccc"),
    cursor: readToken("--color-accent", "#4a8cff"),
    selectionBackground: readToken("--color-bg-active", "rgba(255, 255, 255, 0.1)"),
  };
}
