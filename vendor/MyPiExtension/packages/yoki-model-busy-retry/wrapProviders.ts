/**
 * Installation: put the retry loop in front of every provider that answers a saturated
 * model with the queue rejection.
 *
 * Selection is by API id (`qoder-api`), not by provider id, so both Qoder regions and any
 * future id change are covered while gateways that never emit 10605 stay untouched.
 *
 * Re-registering a provider merges over the previous registration, so passing only `api`
 * and `streamSimple` keeps the provider's models, OAuth and usage wiring intact. `api` is
 * required by Pi's validation whenever a registration carries `streamSimple`.
 */

import type { ExtensionAPI, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { BusyRetryDecision, BusyRetryPlanner } from "./policy.ts";
import { createBusyRetryStreamFn, type ProviderStreamSimple, waitWithAbort } from "./retryStream.ts";

/** Provider APIs that report a saturated model as a queued `10605` rejection. */
const BUSY_RETRY_APIS: ReadonlySet<string> = new Set(["qoder-api"]);

type RegisterProvider = Pick<ExtensionAPI, "registerProvider">["registerProvider"];
type ProviderConfigs = Pick<ModelRegistry, "getRegisteredProviderConfig" | "getRegisteredProviderIds">;

/** Identity of every wrapper this extension installed, so re-install is a no-op. */
const installed = new WeakMap<ProviderStreamSimple, true>();

export interface InstallBusyRetryDeps {
	readonly registry: ProviderConfigs;
	readonly register: RegisterProvider;
	readonly plan: BusyRetryPlanner["plan"];
	readonly onWait?: (decision: BusyRetryDecision) => void;
}

/**
 * Wrap every candidate provider that is not already wrapped.
 *
 * Called on session start, run start and model select because the provider extension
 * registers asynchronously: at our own load time its config may not exist yet, and a
 * catalog refresh can replace our wrapper with the original implementation.
 *
 * @returns the provider ids wrapped by this call.
 */
export function installBusyRetryWrapping(deps: InstallBusyRetryDeps): string[] {
	const wrapped: string[] = [];
	for (const providerId of deps.registry.getRegisteredProviderIds()) {
		const config = deps.registry.getRegisteredProviderConfig(providerId);
		const delegate = config?.streamSimple;
		if (!config?.api || !delegate) continue;
		if (!BUSY_RETRY_APIS.has(config.api)) continue;
		if (installed.has(delegate)) continue;
		const streamSimple = createBusyRetryStreamFn({
			delegate,
			plan: deps.plan,
			wait: waitWithAbort,
			onWait: deps.onWait,
		});
		installed.set(streamSimple, true);
		deps.register(providerId, { api: config.api, streamSimple });
		wrapped.push(providerId);
	}
	return wrapped;
}
