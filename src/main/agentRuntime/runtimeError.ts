import type { DurableExtensionErrorCode } from "../../shared/durableExtension";
import type { DurableResourceErrorCode } from "../../shared/durableResources";
import { t } from "../../shared/i18n";

const messages = {
  invalid: "session.durable.extensionInvalid",
  load: "session.durable.extensionLoad",
  capability: "session.durable.extensionCapability",
  duplicate: "session.durable.extensionDuplicate",
  closed: "session.durable.extensionClosed",
  unknownCommand: "session.durable.extensionUnknownCommand",
  commandFailed: "session.durable.extensionCommandFailed",
  disposeFailed: "session.durable.extensionDisposeFailed",
} as const satisfies Record<DurableExtensionErrorCode, string>;

const resourceMessages = {
  invalid: "session.durable.resourceInvalid",
  load: "session.durable.resourceLoad",
  duplicate: "session.durable.resourceDuplicate",
  tooLarge: "session.durable.resourceTooLarge",
} as const satisfies Record<DurableResourceErrorCode, string>;

/** Localize structured runtime failures at main, using the current desktop locale. */
export function localizeRuntimeError(message: string): string {
  const resource = /^PIDESK_RESOURCE:([A-Za-z]+):(.+)$/.exec(message);
  if (resource && Object.hasOwn(resourceMessages, resource[1]))
    return t(resourceMessages[resource[1] as DurableResourceErrorCode], { name: resource[2] });
  const match = /^PIDESK_EXTENSION:([A-Za-z]+):(.+)$/.exec(message);
  if (!match || !Object.hasOwn(messages, match[1])) return message;
  return t(messages[match[1] as DurableExtensionErrorCode], { name: match[2] });
}
