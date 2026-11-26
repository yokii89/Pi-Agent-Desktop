import { randomUUID } from "node:crypto";
import type { ExtensionWorkerStatus, WorkerAcquireResult } from "../../shared/contribution";
import { WORKER_GRACE_EXIT_MS } from "../../shared/contribution";
import type { DurableExtensionSpec } from "../../shared/durableExtension";
import type { DurableCommand } from "../../shared/durableProtocol";

interface HostSlot {
  id?: string;
  paths: string[];
  ready: boolean;
  error?: string;
}
interface NativeHostServices {
  request(command: DurableCommand): Promise<unknown>;
  discover(scope: "app" | "settings"): DurableExtensionSpec[];
  bind(
    specs: DurableExtensionSpec[],
    ownerId: string,
    scope: "app" | "settings",
  ): Promise<DurableExtensionSpec[]>;
  revoke(ownerId: string): void;
  cwd: string;
}

/** App lifetime and leased settings lifetime share the built-in runtime, without opening a conversation. */
export class NativeExtensionHosts {
  private readonly slots = {
    app: { paths: [], ready: false } as HostSlot,
    settings: { paths: [], ready: false } as HostSlot,
  };
  private leases = 0;
  private appEnabled = false;
  private disposed = false;
  private grace?: ReturnType<typeof setTimeout>;
  private recovery?: ReturnType<typeof setTimeout>;
  private recoveryAttempts = 0;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly services: NativeHostServices) {}

  status(): ExtensionWorkerStatus {
    const slot = this.slots.settings;
    return {
      running: !!slot.id,
      ready: slot.ready,
      leases: this.leases,
      graceExitScheduled: !!this.grace,
      workerSafeExtensionCount: slot.paths.length,
      selectiveLoadSupported: true,
      extensionPaths: [...slot.paths],
      errorMessage: slot.error,
    };
  }

  async startApp(): Promise<void> {
    this.appEnabled = true;
    await this.serialize(() => this.start("app"));
  }

  async acquire(): Promise<WorkerAcquireResult> {
    if (this.disposed) throw new Error("Extension hosts are closing.");
    this.clearGrace();
    this.leases++;
    this.recoveryAttempts = 0;
    await this.serialize(() => this.start("settings")).catch(() => {});
    return { status: this.status() };
  }

  release(): ExtensionWorkerStatus {
    this.leases = Math.max(0, this.leases - 1);
    if (!this.leases && !this.disposed) {
      this.clearGrace();
      this.grace = setTimeout(() => {
        this.grace = undefined;
        void this.serialize(async () => {
          if (!this.leases) await this.stop("settings");
        }).catch(() => {});
      }, WORKER_GRACE_EXIT_MS);
      this.grace.unref?.();
    }
    return this.status();
  }

  async reload(): Promise<ExtensionWorkerStatus> {
    this.clearGrace();
    clearTimeout(this.recovery);
    this.recovery = undefined;
    this.recoveryAttempts = 0;
    await this.serialize(async () => {
      await this.stop("settings");
      await this.stop("app");
      if (this.appEnabled && !this.disposed) await this.start("app");
      if (this.leases && !this.disposed) await this.start("settings");
    }).catch(() => {});
    return this.status();
  }

  fault(): void {
    this.generation++;
    for (const slot of Object.values(this.slots)) {
      if (slot.id) this.services.revoke(slot.id);
      slot.id = undefined;
      slot.ready = false;
      slot.error = "Extension runtime stopped.";
    }
    this.scheduleRecovery();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.generation++;
    this.appEnabled = false;
    this.leases = 0;
    this.clearGrace();
    clearTimeout(this.recovery);
    this.recovery = undefined;
    await this.serialize(async () => {
      const results = await Promise.allSettled([this.stop("settings"), this.stop("app")]);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    });
  }

  private scheduleRecovery(): void {
    if (
      this.disposed ||
      this.recovery ||
      this.recoveryAttempts >= 3 ||
      (!this.appEnabled && !this.leases)
    )
      return;
    this.recoveryAttempts++;
    this.recovery = setTimeout(() => {
      this.recovery = undefined;
      void this.serialize(async () => {
        const results = await Promise.allSettled([
          ...(this.appEnabled ? [this.start("app")] : []),
          ...(this.leases ? [this.start("settings")] : []),
        ]);
        if (results.some((result) => result.status === "rejected")) this.scheduleRecovery();
        else this.recoveryAttempts = 0;
      });
    }, this.recoveryAttempts * 1000);
    this.recovery.unref?.();
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }
  private clearGrace(): void {
    clearTimeout(this.grace);
    this.grace = undefined;
  }

  private async start(scope: "app" | "settings"): Promise<void> {
    const slot = this.slots[scope];
    if (this.disposed || slot.ready || (scope === "settings" && !this.leases)) return;
    // A failed disposal retains ownership; release it before creating a replacement.
    if (slot.id) await this.stop(scope);
    const id = `desktop-${scope}-${randomUUID()}`;
    const generation = this.generation;
    try {
      const specs = this.services.discover(scope);
      slot.paths = specs.map((spec) => spec.entry);
      slot.error = undefined;
      if (!specs.length) return;
      const extensions = await this.services.bind(specs, id, scope);
      if (
        this.disposed ||
        generation !== this.generation ||
        (scope === "settings" && !this.leases)
      ) {
        this.services.revoke(id);
        return;
      }
      slot.id = id;
      await this.services.request({
        op: "openExtensionHost",
        hostId: id,
        hostScope: scope,
        cwd: this.services.cwd,
        extensions,
      });
      if (slot.id === id) slot.ready = true;
    } catch {
      this.services.revoke(id);
      if (slot.id === id) {
        try {
          await this.services.request({ op: "closeExtensionHost", hostId: id });
          if (slot.id === id) slot.id = undefined;
        } catch {
          // Keep the id so a failed factory disposal can be retried without orphaning it.
        }
      }
      slot.ready = false;
      slot.error = "Extension host failed to start.";
      throw new Error(slot.error);
    }
  }

  private async stop(scope: "app" | "settings"): Promise<void> {
    const slot = this.slots[scope];
    const id = slot.id;
    if (!id) return;
    slot.ready = false;
    this.services.revoke(id);
    await this.services.request({ op: "closeExtensionHost", hostId: id });
    if (slot.id === id) {
      slot.id = undefined;
      slot.ready = false;
    }
  }
}
