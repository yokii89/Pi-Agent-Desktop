import chipStyles from "./FileMentionChip.module.css";

/** 用户消息里的 / 斜杠命令只读标记：与 @ 文件引用同一芯片视觉（含背景色）。 */
export function SlashCommandChip({ name }: { name: string }) {
  return (
    <span className={chipStyles.chip} title={`/${name}`}>
      {`/${name}`}
    </span>
  );
}
