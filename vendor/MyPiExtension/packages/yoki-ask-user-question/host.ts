/**
 * Pluggable host registry for ask_user_question rendering surfaces.
 *
 * External extensions (e.g. pi-telegram) register a host that can present the
 * questionnaire outside the TUI. Detection is process-local via globalThis so
 * package load order and module-instance identity do not matter.
 *
 * Contract version 1 is stable: breaking changes require a new key/version.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { QuestionnaireResult, QuestionParams } from "./tool/types.ts";

export const ASK_USER_HOST_REGISTRY_KEY = "__yokiAskUserHostRegistry__" as const;
export const ASK_USER_HOST_REGISTRY_VERSION = 1 as const;

export interface AskUserHostPresentOptions {
	/** Tool-call id from Pi, useful for correlation/logging. */
	toolCallId: string;
	/** Abort when the agent run is cancelled. */
	signal?: AbortSignal;
	/** Extension context for the current tool execution. */
	ctx: ExtensionContext;
}

/**
 * A rendering surface for questionnaires. Highest priority host whose
 * `canHandle` returns true is tried first. Returning `null` from `present`
 * means "cannot handle this turn — try the next host".
 */
export interface AskUserHost {
	readonly id: string;
	/** Higher runs first. Built-in TUI/RPC are not hosts; they are fallbacks. */
	readonly priority: number;
	canHandle(ctx: ExtensionContext): boolean | Promise<boolean>;
	present(params: QuestionParams, opts: AskUserHostPresentOptions): Promise<QuestionnaireResult | null>;
}

export interface AskUserHostRegistry {
	readonly version: typeof ASK_USER_HOST_REGISTRY_VERSION;
	register: (host: AskUserHost) => () => void;
	list: () => readonly AskUserHost[];
	hasHosts: () => boolean;
}

function isValidRegistry(candidate: unknown): candidate is AskUserHostRegistry {
	if (!candidate || typeof candidate !== "object") return false;
	const r = candidate as Partial<AskUserHostRegistry>;
	return (
		r.version === ASK_USER_HOST_REGISTRY_VERSION &&
		typeof r.register === "function" &&
		typeof r.list === "function" &&
		typeof r.hasHosts === "function"
	);
}

function createRegistry(): AskUserHostRegistry {
	const hosts = new Map<string, AskUserHost>();
	return {
		version: ASK_USER_HOST_REGISTRY_VERSION,
		register(host) {
			if (!host || typeof host.id !== "string" || host.id.length === 0) {
				throw new Error("AskUserHost.id must be a non-empty string");
			}
			if (typeof host.priority !== "number" || !Number.isFinite(host.priority)) {
				throw new Error(`AskUserHost.priority must be a finite number (${host.id})`);
			}
			if (typeof host.canHandle !== "function" || typeof host.present !== "function") {
				throw new Error(`AskUserHost.canHandle/present must be functions (${host.id})`);
			}
			hosts.set(host.id, host);
			return () => {
				if (hosts.get(host.id) === host) hosts.delete(host.id);
			};
		},
		list() {
			return [...hosts.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
		},
		hasHosts() {
			return hosts.size > 0;
		},
	};
}

/** Process-local registry shared across package instances. */
export function getAskUserHostRegistry(): AskUserHostRegistry {
	const g = globalThis as Record<string, unknown>;
	const existing = g[ASK_USER_HOST_REGISTRY_KEY];
	if (isValidRegistry(existing)) return existing;
	const registry = createRegistry();
	g[ASK_USER_HOST_REGISTRY_KEY] = registry;
	return registry;
}

/** Register a host. Returns an unregister disposer. */
export function registerAskUserHost(host: AskUserHost): () => void {
	return getAskUserHostRegistry().register(host);
}

export function listAskUserHosts(): readonly AskUserHost[] {
	return getAskUserHostRegistry().list();
}

export function hasAskUserHosts(): boolean {
	return getAskUserHostRegistry().hasHosts();
}

/**
 * Try registered hosts in priority order. Returns the first non-null result,
 * or null when no host can present (caller should fall back to TUI/RPC).
 */
export async function presentViaAskUserHosts(
	params: QuestionParams,
	opts: AskUserHostPresentOptions,
): Promise<QuestionnaireResult | null> {
	for (const host of listAskUserHosts()) {
		if (opts.signal?.aborted) {
			return { answers: [], cancelled: true };
		}
		let eligible = false;
		try {
			eligible = await host.canHandle(opts.ctx);
		} catch {
			continue;
		}
		if (!eligible) continue;
		try {
			const result = await host.present(params, opts);
			if (result !== null) return result;
		} catch {
			// Host threw — try the next surface rather than failing the tool.
		}
	}
	return null;
}
