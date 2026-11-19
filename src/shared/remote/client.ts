import {
  byteLength,
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
import { type V2ClientOptions, v2Path } from "./v2";

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
    readonly v2?: V2ClientOptions,
  ) {
    origin(relayOrigin);
  }
  get version(): 1 | 2 {
    return this.v2 ? 2 : 1;
  }
  async socketHeaders(): Promise<Record<string, string>> {
    if (!this.v2) return {};
    return {
      Authorization: `Bearer ${await this.v2.account.token()}`,
      "X-PiDesk-Control-Version": "2",
      "X-Request-Id": id(this.newId()),
    };
  }
  now(): number {
    return this.clock() + this.serverOffsetMs;
  }
  async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    token: string | null,
    body: Record<string, unknown> | null,
    decode: (v: unknown) => T,
    stableRequestId?: string,
  ): Promise<T> {
    if (this.v2) path = v2Path(path, this.v2.desktopId);
    else if (!/^\/v1\/[a-zA-Z0-9_/-]+$/.test(path)) fail("INVALID_PATH");
    const requestId = id(stableRequestId ?? this.newId());
    const payload =
      body === null
        ? undefined
        : JSON.stringify({ ...body, controlVersion: this.version, requestId });
    if (payload && byteLength(payload) > LIMITS.controlBytes) fail("FRAME_TOO_LARGE");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-PiDesk-Control-Version": String(this.version),
      "X-Request-Id": requestId,
    };
    if (this.v2) {
      if (path !== "/v2/meta") headers.Authorization = `Bearer ${await this.v2.account.token()}`;
      if (token) headers["X-PiDesk-Room-Authorization"] = `Bearer ${token}`;
    } else if (token) headers.Authorization = `Bearer ${token}`;
    let response: ControlResponse;
    let r: Record<string, unknown>;
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
      // Receiving headers does not mean the response body has finished downloading.
      r = record(parseJson(await response.text(), this.v2 ? 32_768 : LIMITS.controlBytes));
    } catch {
      throw new ControlError("NETWORK_UNCERTAIN", true);
    } finally {
      clearTimeout(timeout);
    }
    if (
      r.controlVersion !== this.version ||
      (r.requestId !== requestId && !(this.v2 && path === "/v2/meta" && r.requestId === null))
    )
      fail("VERSION_MISMATCH");
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
