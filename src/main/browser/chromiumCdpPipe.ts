/**
 * CDP over pipe 的帧协议（纯逻辑，无 Electron / 子进程依赖，便于单测）。
 *
 * 为什么要用 pipe 而不是 WebSocket：Chromium 的 `--remote-debugging-pipe` 把 CDP 消息
 * 通过 fd3（写）/ fd4（读）交换，消息之间用 NUL 分隔，不需要引入 `ws` 依赖，也不需要
 * 占一个 TCP 端口（WebSocket 形态在 Windows 上还要处理 /json/version 的握手与端口竞争）。
 * 连通性实测见 docs/design/42 §6.6。
 */

export interface CdpPipeMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  result?: unknown;
  error?: { code: number; message: string };
}

/** 编码一条 CDP 消息：JSON + NUL 分隔。 */
export function encodeCdpMessage(message: Record<string, unknown>): string {
  return `${JSON.stringify(message)}\0`;
}

/**
 * 增量解码 fd4 上读到的字节流。
 *
 * 一次 `data` 事件可能只到半个消息（也可能一次带多条），所以必须按 NUL 累积切分，
 * 不能假设「一个 chunk = 一条消息」。
 */
export class CdpPipeDecoder {
  private buffer = "";

  push(chunk: string): CdpPipeMessage[] {
    this.buffer += chunk;
    const messages: CdpPipeMessage[] = [];
    let index = this.buffer.indexOf("\0");
    while (index >= 0) {
      const raw = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      const parsed = parseCdpMessage(raw);
      if (parsed) messages.push(parsed);
      index = this.buffer.indexOf("\0");
    }
    return messages;
  }
}

/** 容忍半条消息与空帧；解析失败返回 null（由调用方决定是否视为协议错误）。 */
function parseCdpMessage(raw: string): CdpPipeMessage | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as CdpPipeMessage;
  } catch {
    return null;
  }
}
