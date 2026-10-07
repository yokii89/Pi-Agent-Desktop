import { spawn } from "node:child_process";
import os from "node:os";
import { StringDecoder } from "node:string_decoder";
import { getSettings } from "../settings/settings";
import { resolvePiCommand } from "./piLauncher";

/**
 * 无存活会话时的一次性模型列表探测：
 * 短连 `pi --mode rpc --no-session`，发 get_available_models，拿到响应后关进程。
 * 设置页打开时常没有会话，不能因此空列表。
 */
export function fetchAvailableModelsOnce(timeoutMs = 15000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const { file, args } = resolvePiCommand(getSettings().piExecutablePath);
    const child = spawn(file, [...args, "--mode", "rpc", "--no-session"], {
      cwd: os.homedir(),
      env: process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // 进程可能已退出
      }
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("探测可用模型超时")));
    }, timeoutMs);

    const decoder = new StringDecoder("utf8");
    let buffer = "";
    let requestIdSent = false;

    const sendRequest = (): void => {
      if (requestIdSent) return;
      requestIdSent = true;
      try {
        child.stdin.write(`${JSON.stringify({ id: 1, type: "get_available_models" })}\n`);
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error("写入 pi RPC 失败")));
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        handleLine(line);
        nl = buffer.indexOf("\n");
      }
    });

    function handleLine(line: string): void {
      if (!line.trim()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== "object") return;
      const record = parsed as Record<string, unknown>;
      // 响应：type=response 且 id 匹配；事件流忽略
      if (record.type === "response" && (record.id === 1 || record.id === "1")) {
        if (record.success === true) {
          finish(() => resolve(record.data ?? { models: [] }));
        } else {
          const message = typeof record.error === "string" ? record.error : "读取模型列表失败";
          finish(() => reject(new Error(message)));
        }
      }
    }

    child.on("error", (err) => {
      finish(() => reject(err));
    });
    child.on("exit", () => {
      finish(() => reject(new Error("pi 探测进程提前退出")));
    });

    // pi 启动后即可收命令；stderr 噪声忽略，stdout 就绪后写请求
    // 若进程已能读 stdin，立即发；否则等首行 stdout 再发（多数情况 stdout 先有事件/欢迎）
    child.stdout.once("data", () => sendRequest());
    // 兜底：200ms 后无论如何发一次，避免 stdout 无输出时卡死
    setTimeout(sendRequest, 200);
  });
}
