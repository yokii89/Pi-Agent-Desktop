import { open } from "node:fs/promises";
import path from "node:path";
import { record } from "../../shared/durableProtocol";

/** Token-bearing URLs never escape into an exception or diagnostic. */
export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async call(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    try {
      const response = await this.fetcher(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(40000)])
          : AbortSignal.timeout(40000),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !record(payload) || payload.ok !== true)
        throw new Error(`Telegram ${method} failed (${response.status}).`);
      return payload.result;
    } catch (error) {
      if (signal?.aborted) throw new Error("Telegram operation cancelled.");
      if (error instanceof Error && /^Telegram [A-Za-z]+ failed \(\d+\)\.$/.test(error.message))
        throw error;
      throw new Error(`Telegram ${method} could not complete.`);
    }
  }
  async document(chatId: number, file: string, signal?: AbortSignal): Promise<void> {
    const handle = await open(file, "r");
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 50 * 1024 * 1024)
        throw new Error("Telegram attachments must be files up to 50 MiB.");
      const bytes = await handle.readFile();
      const form = new FormData();
      form.set("chat_id", String(chatId));
      form.set("document", new Blob([new Uint8Array(bytes)]), path.basename(file));
      try {
        const response = await this.fetcher(
          `https://api.telegram.org/bot${this.token}/sendDocument`,
          {
            method: "POST",
            body: form,
            redirect: "error",
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
              : AbortSignal.timeout(60000),
          },
        );
        const payload: unknown = await response.json();
        if (!response.ok || !record(payload) || payload.ok !== true) throw new Error();
      } catch {
        throw new Error("Telegram attachment delivery could not complete.");
      }
    } finally {
      await handle.close();
    }
  }
}
