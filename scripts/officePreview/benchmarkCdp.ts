import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Minimal CDP transport for the manually run Electron benchmark; no renderer test framework. */
export interface CdpResult {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
  metrics?: { name: string; value: number }[];
  documents?: number;
  nodes?: number;
  jsEventListeners?: number;
}

export async function connectBenchmark(port = 9388) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = (await response.json()) as { type: string; webSocketDebuggerUrl: string }[];
  const target = targets.find((entry) => entry.type === "page");
  if (!target) throw new Error("Benchmark page is not available");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map<number, (message: { result: CdpResult; error?: unknown }) => void>();
  const errors: string[] = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      result: CdpResult;
      error?: unknown;
      params?: { exceptionDetails: { text: string; exception?: { description?: string } } };
    };
    if (message.id) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    } else if (message.method === "Runtime.exceptionThrown" && message.params) {
      errors.push(
        message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text,
      );
    }
  };
  const send = (method: string, params: object = {}): Promise<CdpResult> =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 60_000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async <T = unknown>(expression: string): Promise<T> => {
    const response = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails)
      throw new Error(
        response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
      );
    return response.result?.value as T;
  };
  const wait = async (expression: string, timeout = 30_000): Promise<unknown> => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await evaluate(
        `(() => { const value = (${expression}); return value && typeof value === 'object' ? true : value; })()`,
      );
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`Timeout: ${expression}`);
  };
  return { send, evaluate, wait, errors, close: () => socket.close() };
}

/** Reports stay alongside generated fixtures and never modify the source workspace files. */
export async function writeBenchmarkReport(name: string, value: unknown): Promise<void> {
  const root = path.resolve("temp/office-benchmark");
  await mkdir(root, { recursive: true });
  const filename = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  await writeFile(path.join(root, `${filename}.json`), `${JSON.stringify(value, null, 2)}\n`);
}
