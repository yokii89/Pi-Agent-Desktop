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
import { RELAY_FEATURE_HEADER, RELAY_FEATURE_VALUE, RELAY_TIMING } from "./features";
import { controlPath, type V2ClientOptions } from "./v2";

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
    readonly v2: V2ClientOptions,
  ) {
    origin(relayOrigin);
  }
  readonly version = 2;
  async socketHeaders(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.v2.account.token()}`,
      "X-PiDesk-Control-Version": "2",
      "X-Request-Id": id(this.newId()),
      [RELAY_FEATURE_HEADER]: RELAY_FEATURE_VALUE,
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
    path = controlPath(path, this.v2.desktopId);
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
    if (path !== "/v2/meta") headers.Authorization = `Bearer ${await this.v2.account.token()}`;
    if (token) headers["X-PiDesk-Room-Authorization"] = `Bearer ${token}`;
    let response: ControlResponse | undefined;
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
      r = record(parseJson(await response.text(), 32_768));
    } catch {
      if (response && (response.status === 429 || response.status >= 500)) {
        const retry = Number(response.headers.get("Retry-After")) * 1000;
        throw new ControlError(
          response.status === 429 ? "RATE_LIMITED" : "STATE_UNAVAILABLE",
          true,
          Number.isFinite(retry) && retry > 0 ? retry : RELAY_TIMING.unavailableRetryMs,
        );
      }
      throw new ControlError("NETWORK_UNCERTAIN", true);
    } finally {
      clearTimeout(timeout);
    }
    if (
      r.controlVersion !== this.version ||
      (r.requestId !== requestId && !(path === "/v2/meta" && r.requestId === null))
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
