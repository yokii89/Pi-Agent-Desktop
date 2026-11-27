/** 子任务扩展的通知正文契约；实时和历史都使用 CustomEntry 中保留的同一份正文。 */
export interface TaskNotification {
  taskId: string;
  toolUseId: string | null;
  outputFile: string | null;
  script: string | null;
  failures: string | null;
  source: "agent" | "workflow";
  title: string;
  summary: string;
  rawStatus: string;
  status: "complete" | "partial" | "failed" | "stopped" | "unknown";
  result: string;
  /** 复制保留生产者的缩进、换行和截断标记，展示文本只隐藏截断尾标。 */
  rawResult: string;
  truncated: boolean;
  usage: {
    totalTokens: number | null;
    toolUses: number | null;
    contextPercent: number | null;
    durationMs: number | null;
    compactions: number | null;
    estimatedCostUsd: number | null;
  };
}

/** 只解码一层，避免把结果中的字面量 &lt; 二次解释为标签。 */
function decodeXml(text: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, name: string) => {
    if (!name.startsWith("#")) return entities[name.toLowerCase()] ?? entity;
    const code =
      name[1].toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : entity;
  });
}

/** 生产者只写无属性的字段与 usage 容器；结构损坏时整条回退，避免静默吃掉正文。 */
function readFields(text: string, allowUsage = false): Map<string, string> | null {
  const fields = new Map<string, string>();
  let end = 0;
  for (const match of text.matchAll(/<([a-z][\w-]*)>([\s\S]*?)<\/\1>/g)) {
    const [whole, name, value] = match;
    if (text.slice(end, match.index).trim() || fields.has(name)) return null;
    if (!(allowUsage && name === "usage") && /[<>]/.test(value)) return null;
    fields.set(name, value);
    end = match.index + whole.length;
  }
  return text.slice(end).trim() ? null : fields;
}

function numberField(fields: Map<string, string>, name: string): number | null {
  const raw = fields.get(name)?.trim();
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function taskStatus(status: string): TaskNotification["status"] {
  if (/^(?:wrapped up \(turn limit\)|aborted \(max turns exceeded\))$/i.test(status))
    return "partial";
  if (/^(?:done|completed?|success|succeeded)$/i.test(status)) return "complete";
  if (/^(?:error(?:\s*:[\s\S]*)?|failed|failure)$/i.test(status)) return "failed";
  if (/^(?:stopped|aborted|interrupted|cancelled|canceled|killed)$/i.test(status)) return "stopped";
  return "unknown";
}

function parseTask(body: string): TaskNotification | null {
  const fields = readFields(body, true);
  if (!fields) return null;
  const field = (name: string): string | null => {
    const value = fields.get(name);
    return value === undefined ? null : decodeXml(value).trim();
  };
  const taskId = field("task-id");
  const rawStatus = field("status");
  const summary = field("summary");
  const encodedResult = fields.get("result");
  if (!taskId || !rawStatus || !summary || encodedResult === undefined) return null;
  const result = decodeXml(encodedResult);
  const usage = readFields(fields.get("usage") ?? "");
  if (!usage) return null;
  const name = /^(Agent|Workflow)\s+"(.+)"(?:\s|$)/i.exec(summary);
  const truncation = /(?:\r?\n)?\.{3}\(truncated(?:,[^\r\n]*)?\)\s*$/i;
  return {
    taskId,
    toolUseId: field("tool-use-id") || null,
    outputFile: field("output-file") || null,
    script: field("script") || null,
    failures: field("failures") || null,
    source: name?.[1].toLowerCase() === "workflow" ? "workflow" : "agent",
    title: name?.[2] ?? taskId,
    summary,
    rawStatus,
    status: taskStatus(rawStatus),
    result: result.replace(truncation, ""),
    rawResult: result,
    truncated: truncation.test(result),
    usage: {
      totalTokens: numberField(usage, "total_tokens"),
      toolUses: numberField(usage, "tool_uses"),
      contextPercent: numberField(usage, "context_percent"),
      durationMs: numberField(usage, "duration_ms"),
      compactions: numberField(usage, "compactions"),
      estimatedCostUsd: numberField(usage, "estimated_cost_usd"),
    },
  };
}

/**
 * 解析单条或合并的 subagent-notification；允许生产者附带分组说明与完整记录路径尾注。
 * 不使用 DOMParser，保证纯逻辑测试与浏览器拿到相同结果；结果始终交给 Markdown 内核渲染。
 * 任何一个任务结构损坏都返回 null，调用方继续显示完整的通用扩展通知。
 */
export function parseTaskNotifications(text: string): TaskNotification[] | null {
  const tasks: TaskNotification[] = [];
  const ids = new Set<string>();
  let end = 0;
  const envelopes = [...text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)];
  for (const [index, match] of envelopes.entries()) {
    if (/<\/?task-notification\b/.test(text.slice(end, match.index))) return null;
    const task = parseTask(match[1]);
    if (!task || ids.has(task.taskId)) return null;
    end = match.index + match[0].length;
    // 旧生产者把路径原样放在 XML 外；只读取当前任务之后、下个任务之前的尾注。
    const footer = /^Full transcript available at:[\t ]+([^\r\n]+)/m.exec(
      text.slice(end, envelopes[index + 1]?.index ?? text.length),
    );
    task.outputFile ??= footer?.[1].trim() || null;
    tasks.push(task);
    ids.add(task.taskId);
  }
  if (/<\/?task-notification\b/.test(text.slice(end))) return null;
  return tasks.length > 0 ? tasks : null;
}
