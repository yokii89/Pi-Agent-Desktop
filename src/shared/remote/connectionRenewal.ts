import { fail, type Principal, sameBinding, timestamp } from "./contract";
import { RELAY_TIMING } from "./features";
import { relayPrincipal } from "./v2";

interface RenewalOptions {
  accountId: string;
  newId(): string;
  now(): number;
  credentials(): Promise<{ accessToken: string; accountToken: string }>;
  send(frame: Record<string, unknown>): void;
  close(): void;
  renewed(principal: Principal & { accountId: string }): void;
}

/** Renews one live socket without changing its subject or connection generation. */
export class ConnectionRenewal {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private pending: string | null = null;
  private deadline = 0;
  constructor(
    private readonly options: RenewalOptions,
    private principal: Principal,
  ) {}
  start(accountExpiresAt: unknown): void {
    if (this.stopped) return;
    this.deadline = Math.min(
      Date.parse(this.principal.accessExpiresAt),
      Date.parse(timestamp(accountExpiresAt)),
    );
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = setTimeout(
      () => this.options.close(),
      Math.max(1, this.deadline - this.options.now()),
    );
    this.schedule(Math.max(1, this.deadline - this.options.now() - RELAY_TIMING.renewBeforeMs));
  }
  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.renew(), delay);
  }
  private async renew(): Promise<void> {
    if (this.stopped) return;
    try {
      const credentials = await this.options.credentials();
      if (this.stopped) return;
      this.pending = this.options.newId();
      this.timer = setTimeout(() => this.options.close(), 5_000);
      this.options.send({
        controlVersion: 2,
        type: "reauthenticate",
        renewalId: this.pending,
        ...credentials,
      });
    } catch {
      if (!this.stopped && this.options.now() + 5_000 < this.deadline) this.schedule(5_000);
      else if (!this.stopped) this.options.close();
    }
  }
  accept(frame: Record<string, unknown>): void {
    if (this.stopped || !this.pending || frame.renewalId !== this.pending) fail("AUTH_REQUIRED");
    const principal = relayPrincipal(frame.principal, this.options.accountId);
    if (
      !sameBinding(this.principal, principal) ||
      principal.role !== this.principal.role ||
      principal.connectionGeneration !== this.principal.connectionGeneration
    )
      fail("AUTH_REQUIRED");
    this.pending = null;
    this.principal = principal;
    this.options.renewed(principal);
    this.start(frame.accountExpiresAt);
  }
  dispose(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.expiry) clearTimeout(this.expiry);
  }
}
