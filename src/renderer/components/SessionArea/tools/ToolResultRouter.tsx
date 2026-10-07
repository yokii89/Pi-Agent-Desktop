import type { ToolAssistantBlock } from "../../../stores/sessionTranscript";
import { DiffResult } from "./DiffResult";
import { FileChangeResult } from "./FileChangeResult";
import { FileReadResult } from "./FileReadResult";
import { GenericToolResult } from "./GenericToolResult";
import { ImageResult } from "./ImageResult";
import { SearchResult } from "./SearchResult";
import { TerminalResult } from "./TerminalResult";

/**
 * 工具结果二次分发：按结构化载荷类型路由，
 * 未知工具一律落到 GenericToolResult，UI 不按文本猜类型。
 */
export function ToolResultRouter({ block }: { block: ToolAssistantBlock }) {
  const result = block.result;

  if (result?.kind === "terminal") {
    return (
      <TerminalResult
        payload={result}
        command={block.subject || result.command}
        running={block.status === "running"}
      />
    );
  }
  // 历史/异常路径：工具已标成 terminal 但载荷缺失时，用 args + 原文兜底成终端卡
  if (!result && block.toolKind === "terminal") {
    return (
      <TerminalResult
        payload={{
          kind: "terminal",
          command: block.subject || block.name,
          output: block.resultText ?? "",
          exitCode: block.status === "error" ? null : 0,
          truncated: false,
        }}
        command={block.subject || block.name}
        running={block.status === "running"}
      />
    );
  }
  if (result?.kind === "read") {
    return <FileReadResult payload={result} status={block.status} />;
  }
  if (result?.kind === "change") {
    return (
      <FileChangeResult
        payload={result}
        status={block.status}
        diffNode={
          <DiffResult
            path={result.path}
            diff={result.diff ?? ""}
            additions={result.additions ?? 0}
            deletions={result.deletions ?? 0}
          />
        }
      />
    );
  }
  if (result?.kind === "search") {
    return <SearchResult payload={result} />;
  }
  if (result?.kind === "diff") {
    return (
      <DiffResult
        path={result.path}
        diff={result.diff}
        additions={result.additions}
        deletions={result.deletions}
      />
    );
  }

  if (result?.kind === "generic") {
    return (
      <>
        {result.images.length > 0 && <ImageResult images={result.images} />}
        <GenericToolResult
          argsText={block.argsText}
          resultText={block.resultText}
          status={block.status}
        />
      </>
    );
  }

  return (
    <GenericToolResult
      argsText={block.argsText}
      resultText={block.resultText}
      status={block.status}
    />
  );
}
