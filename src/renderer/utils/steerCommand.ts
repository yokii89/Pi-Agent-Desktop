/**
 * PiDesk 输入栏命令（docs/design/73）：`/steer <内容>` = 运行中插话。
 * 只在文本最前面生效；返回去掉命令后的正文供 prompt 使用。
 * 命令本身不会发给 pi，避免被当成未知斜杠命令塞进模型上下文。
 */
export interface SteerCommandParse {
  steer: boolean;
  text: string;
}

const STEER_PREFIX = /^\s*\/steer(?=\s|$)/i;

export function parseSteerCommand(text: string): SteerCommandParse {
  if (!STEER_PREFIX.test(text)) return { steer: false, text };
  return { steer: true, text: text.replace(STEER_PREFIX, "").replace(/^\s+/, "") };
}
