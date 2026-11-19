import { ControlClient, type ControlFetch } from "./client";
import { exact, fail, origin } from "./contract";
import { type AccountAccess, accountId, type DesktopSummary, parseDesktopSummary } from "./v2";

export interface AccountSnapshot {
  relayOrigin: string;
  accountId: string;
}
/** Keeps account-token acquisition behind a provider callback so bearer tokens never cross the UI bridge. */
export class RelayAccountSession {
  private current: {
    snapshot: AccountSnapshot;
    token: () => Promise<string>;
    generation: number;
  } | null = null;
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(
    private readonly newId: () => string,
    private readonly fetcher?: ControlFetch,
  ) {}
  getSnapshot = (): AccountSnapshot | null => this.current?.snapshot ?? null;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
  disconnect(): void {
    this.generation++;
    this.current = null;
    this.emit();
  }
  async connect(relayOrigin: string, accessToken: string): Promise<void> {
    return this.connectWithTokenProvider(relayOrigin, async () => accessToken);
  }
  async connectWithTokenProvider(relayOrigin: string, token: () => Promise<string>): Promise<void> {
    origin(relayOrigin);
    this.disconnect();
    const generation = this.generation;
    const bootstrap = new ControlClient(relayOrigin, this.newId, this.fetcher, Date.now, {
      account: { accountId: "", token },
    });
    const snapshot = await bootstrap.request("GET", "/v2/account/me", null, null, (value) => {
      const r = exact(value, ["accountId", "accountStatus"]);
      if (r.accountStatus !== "active") fail("ACCOUNT_CLOSED");
      return { relayOrigin, accountId: accountId(r.accountId) };
    });
    if (generation !== this.generation) fail("ACCOUNT_CHANGED");
    this.current = { snapshot, token, generation };
    this.emit();
  }
  access(relayOrigin: string, expectedAccount?: string): AccountAccess {
    const current = this.current;
    if (
      !current ||
      current.snapshot.relayOrigin !== relayOrigin ||
      (expectedAccount && current.snapshot.accountId !== expectedAccount)
    )
      return fail("ACCOUNT_AUTH_REQUIRED");
    return {
      accountId: current.snapshot.accountId,
      token: async () => {
        if (this.current !== current) fail("ACCOUNT_CHANGED");
        return current.token();
      },
    };
  }
  client(desktopId?: string, expectedAccount?: string): ControlClient {
    const snapshot = this.getSnapshot();
    if (!snapshot) return fail("ACCOUNT_AUTH_REQUIRED");
    return new ControlClient(snapshot.relayOrigin, this.newId, this.fetcher, Date.now, {
      account: this.access(snapshot.relayOrigin, expectedAccount),
      desktopId,
    });
  }
  async desktops(): Promise<DesktopSummary[]> {
    const client = this.client();
    const items: DesktopSummary[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page = await client.request(
        "GET",
        `/v2/account/me/desktops${cursor ? `?cursor=${cursor}` : ""}`,
        null,
        null,
        (value) => exact(value, ["items", "revision", "cursor", "accountStatus"]),
      );
      if (page.accountStatus !== "active") fail("ACCOUNT_CLOSED");
      if (
        !Array.isArray(page.items) ||
        page.items.length > 20 ||
        (page.cursor !== null &&
          (typeof page.cursor !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/.test(page.cursor)))
      )
        fail("INVALID_FRAME");
      items.push(...(page.items as unknown[]).map(parseDesktopSummary));
      cursor = page.cursor as string | null;
      if (cursor && seen.has(cursor)) fail("INVALID_CURSOR");
      if (cursor) seen.add(cursor);
      if (items.length > 500) fail("FRAME_TOO_LARGE");
    } while (cursor);
    return items;
  }
}
