import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { ProviderStreamSimple } from "../retryStream.ts";
import { installBusyRetryWrapping } from "../wrapProviders.ts";
import { collect, QUEUED_ERROR, rejectedStream, streamArgs, textStream } from "./support.ts";

interface FakeProvider {
	api?: string;
	streamSimple?: ProviderStreamSimple;
}

interface Registration {
	providerId: string;
	api?: string;
	streamSimple?: ProviderStreamSimple;
}

function makeRegistry(providers: Record<string, FakeProvider>) {
	const registrations: Registration[] = [];
	const deps = {
		registry: {
			getRegisteredProviderIds: () => Object.keys(providers),
			getRegisteredProviderConfig: (providerId: string) => providers[providerId],
		},
		register: (providerId: string, config: Omit<Registration, "providerId">) => {
			registrations.push({ providerId, ...config });
			// Pi merges a re-registration over the previous one.
			providers[providerId] = { ...providers[providerId], ...config };
		},
		plan: (_attempt: number) => 1000,
		onWait: undefined,
	} as unknown as Parameters<typeof installBusyRetryWrapping>[0];
	return { deps, registrations };
}

function qoderProviders(): Record<string, FakeProvider> {
	return {
		qoder: { api: "qoder-api", streamSimple: (() => textStream()) as ProviderStreamSimple },
		"qoder-cn": { api: "qoder-api", streamSimple: (() => textStream()) as ProviderStreamSimple },
		newapi: { api: "openai-completions", streamSimple: (() => textStream()) as ProviderStreamSimple },
		modelsWithoutStream: { api: "qoder-api" },
		streamWithoutApi: { streamSimple: (() => textStream()) as ProviderStreamSimple },
	};
}

describe("installBusyRetryWrapping", () => {
	it("wraps every provider that reports a queued model, and only those", () => {
		const { deps, registrations } = makeRegistry(qoderProviders());

		expect(installBusyRetryWrapping(deps)).toEqual(["qoder", "qoder-cn"]);
		expect(registrations.map((entry) => entry.providerId)).toEqual(["qoder", "qoder-cn"]);
	});

	it("re-registers with the provider's own api, which Pi requires beside streamSimple", () => {
		const { deps, registrations } = makeRegistry(qoderProviders());
		installBusyRetryWrapping(deps);

		expect(registrations.map((entry) => entry.api)).toEqual(["qoder-api", "qoder-api"]);
		expect(registrations.every((entry) => typeof entry.streamSimple === "function")).toBe(true);
	});

	it("is a no-op once its wrapper is the registered implementation", () => {
		const { deps, registrations } = makeRegistry(qoderProviders());
		installBusyRetryWrapping(deps);

		expect(installBusyRetryWrapping(deps)).toEqual([]);
		expect(registrations).toHaveLength(2);
	});

	it("re-wraps when the provider hands back its original implementation", () => {
		const providers = qoderProviders();
		const { deps } = makeRegistry(providers);
		installBusyRetryWrapping(deps);

		const refreshed = (() => textStream()) as ProviderStreamSimple;
		providers["qoder-cn"] = { api: "qoder-api", streamSimple: refreshed };
		expect(installBusyRetryWrapping(deps)).toEqual(["qoder-cn"]);
	});

	it("delegates to the provider implementation it replaced", async () => {
		const responses: AssistantMessageEventStream[] = [rejectedStream(QUEUED_ERROR), textStream("served")];
		let delegateCalls = 0;
		const providers: Record<string, FakeProvider> = {
			"qoder-cn": {
				api: "qoder-api",
				streamSimple: (() => {
					delegateCalls += 1;
					return responses[delegateCalls - 1];
				}) as ProviderStreamSimple,
			},
		};
		const { deps, registrations } = makeRegistry(providers);
		installBusyRetryWrapping(deps);

		const wrapped = registrations[0]?.streamSimple;
		if (!wrapped) throw new Error("expected qoder-cn to be registered");
		const { message } = await collect(wrapped(streamArgs[0], streamArgs[1], undefined));

		expect(delegateCalls).toBe(2);
		expect(message.stopReason).toBe("stop");
	});
});
