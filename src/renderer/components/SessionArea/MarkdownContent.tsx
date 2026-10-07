import { memo, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownDoc } from "../markdown/MarkdownDoc";
import styles from "./MarkdownContent.module.css";
import { splitStableBlocks } from "./markdownBlocks";

/** 流式尾块解析合并窗口（ms）：中间 chunk 只更新原始字符串。 */
const STREAM_PARSE_MS = 60;

/** 回退开关：切分渲染若与完成态出现差异，置 false 即回到整段节流解析（docs/design/10 §3.1）。 */
const STREAM_SPLIT_ENABLED = true;

interface MarkdownContentProps {
  text: string;
  /** 覆盖默认正文色/字号（如思考流的 muted）。 */
  className?: string;
  /** 流式态：走「定型前缀 + 活动尾块」切分，只有尾块节流重解析（docs/design/13 P1-4）。 */
  streaming?: boolean;
  /** 尾块末尾追加生成光标；思考块自带光标时显式关掉。默认随 streaming。 */
  caret?: boolean;
  /** 软换行渲染为 <br>（docs/design/29 缺陷 E）。会话正文与思考流开，ExtensionView 保持 false。 */
  breaks?: boolean;
}

/**
 * 会话文档流的 Markdown 渲染（GFM）——流式与完成态唯一入口。
 * 组件类型不随 streaming 切换（B2）：React 始终复用同一实例做原地 reconcile，
 * message_end 时只有尾块区域的 DOM 需要对账，图片 / 代码块不重建、不闪动。
 * 前缀块与完成态共用同一套渲染内核（components/markdown/MarkdownDoc）。
 */
export const MarkdownContent = memo(function MarkdownContent({
  text,
  className,
  streaming = false,
  caret = streaming,
  breaks = false,
}: MarkdownContentProps) {
  // streaming 常为 false（历史块），早退避免 split 开销
  if (!streaming || !STREAM_SPLIT_ENABLED) {
    return <StaticMarkdown text={text} className={className} breaks={breaks} />;
  }
  return <StreamingMarkdown text={text} className={className} caret={caret} breaks={breaks} />;
});

/** 完成态 / 前缀块：纯静态渲染，text 不变则 memo 跳过（切分管线的前提）。 */
const StaticMarkdown = memo(function StaticMarkdown({
  text,
  className,
  breaks,
}: {
  text: string;
  className?: string;
  breaks: boolean;
}) {
  return (
    <MarkdownDoc
      text={text}
      codeCopy
      codeHighlight
      breaks={breaks}
      className={[styles.session, className].filter(Boolean).join(" ")}
    />
  );
});

/**
 * 流式态：切出定型块 + 尾块。定型块逐字节稳定 → StaticMarkdown memo 命中不重解析；
 * 尾块经 60ms 节流。wrapper 始终渲染：流式与完成态 DOM 同构，结束零重挂载。
 */
function StreamingMarkdown({
  text,
  className,
  caret,
  breaks,
}: {
  text: string;
  className?: string;
  caret: boolean;
  breaks: boolean;
}) {
  // 切分是廉价字符串扫描（相对 markdown parse 可忽略），每次 delta 都重切也安全；
  // 前缀块靠 StaticMarkdown 的 prop 相等跳过重渲染。
  const { blocks, tail } = useMemo(() => splitStableBlocks(text), [text]);
  const visibleTail = useThrottled(tail, STREAM_PARSE_MS);
  return (
    <div className={styles.streamFlow}>
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 前缀只追加不重排，索引键保证 memo 命中
        <StaticMarkdown key={index} text={block} className={className} breaks={breaks} />
      ))}
      <StaticMarkdown
        text={visibleTail}
        className={caret ? [className, styles.caretHost].filter(Boolean).join(" ") : className}
        breaks={breaks}
      />
    </div>
  );
}

/** 尾块节流：中间 delta 只记 pending，每 STREAM_PARSE_MS 提交一次触发解析。 */
function useThrottled(value: string, ms: number): string {
  const [visible, setVisible] = useState(value);
  const pendingRef = useRef(value);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    pendingRef.current = value;
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setVisible(pendingRef.current);
    }, ms);
  }, [value, ms]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return visible;
}
