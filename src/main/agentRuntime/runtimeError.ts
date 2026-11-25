import type { DurableExtensionErrorCode } from "../../shared/durableExtension";
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

/** Localize structured extension failures at main, using the current desktop locale. */
export function localizeRuntimeError(message: string): string {
  const match = /^PIDESK_EXTENSION:([A-Za-z]+):(.+)$/.exec(message);
  if (!match || !Object.hasOwn(messages, match[1])) return message;
  return t(messages[match[1] as DurableExtensionErrorCode], { name: match[2] });
}
