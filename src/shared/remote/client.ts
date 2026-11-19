import {
  byteLength,
  CONTROL_VERSION,
  ControlError,
  exact,
  fail,
  id,
  LIMITS,
  origin,
  parseJson,
  record,
  timestamp,
} from "./contract";
export interface ControlResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type ControlFetch = (
  url: string,
  init: {
    method: string;
    redirect: "error";
    cache: "no-store";
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<ControlResponse>;
/** No bearer credentials in URLs; no redirects, body/error logging, or automatic mutation retry. */
export class ControlClient {
  serverOffsetMs = 0;
  constructor(
    readonly relayOrigin: string,
    private readonly newId: () => string,
    private readonly fetcher: ControlFetch = fetch,
    private readonly clock = Date.now,
  ) {
    origin(relayOrigin);
  }
  now(): number {
    return this.clock() + this.serverOffsetMs;
  }
  async request<T>(
    method: "GET" | "POST",
    path: string,
    token: string | null,
    body: Record<string, unknown> | null,
    decode: (v: unknown) => T,
  ): Promise<T> {
    if (!/^\/v1\/[a-zA-Z0-9_/-]+$/.test(path)) fail("INVALID_PATH");
    const requestId = id(this.newId());
    const payload =
      body === null
        ? undefined
        : JSON.stringify({ controlVersion: CONTROL_VERSION, requestId, ...body });
    if (payload && byteLength(payload) > LIMITS.controlBytes) fail("FRAME_TOO_LARGE");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-PiDesk-Control-Version": "1",
      "X-Request-Id": requestId,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    let response: ControlResponse;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      response = await this.fetcher(this.relayOrigin + path, {
        method,
        redirect: "error",
        cache: "no-store",
        headers,
        ...(payload ? { body: payload } : {}),
        signal: controller.signal,
      });
    } catch {
      throw new ControlError("NETWORK_UNCERTAIN", true);
    } finally {
      clearTimeout(timeout);
    }
    let r: Record<string, unknown>;
    try {
      r = record(parseJson(await response.text()));
    } catch {
      throw new ControlError("NETWORK_UNCERTAIN", true);
    }
    if (r.controlVersion !== 1 || r.requestId !== requestId) fail("VERSION_MISMATCH");
    timestamp(r.serverTime);
    this.serverOffsetMs = Date.parse(r.serverTime as string) - this.clock();
    if (r.error) {
      const error = exact(r.error, ["code", "message", "retryable"]);
      const code =
        typeof error.code === "string" && /^[A-Z_]{1,64}$/.test(error.code)
          ? error.code
          : "CONTROL_FAILED";
      const retry = Number(response.headers.get("Retry-After"));
      throw new ControlError(
        code,
        error.retryable === true,
        Number.isFinite(retry) ? Math.max(0, retry * 1_000) : 0,
      );
    }
    if (response.status < 200 || response.status > 299) fail("CONTROL_FAILED");
    return decode(r.data);
  }
}
