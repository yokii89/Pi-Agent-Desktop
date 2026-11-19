import type { SessionUiDialogRequest } from "../../shared/ipc";
import { fail } from "../../shared/remote";
import type { SessionUiAnswer } from "../session/extensionUi";
import { sanitizeRemoteText } from "./sanitize";

/** Restore a uniquely matching local option without sending its filesystem path to the phone. */
export function remoteInteractionAnswer(
  request: SessionUiDialogRequest,
  value: string | boolean,
): SessionUiAnswer {
  if (request.method === "confirm") {
    if (typeof value !== "boolean") fail("INVALID_FRAME");
    return { confirmed: value };
  }
  if (typeof value !== "string") fail("INVALID_FRAME");
  if (request.method === "select") {
    const matches = [
      ...new Set((request.options ?? []).filter((option) => sanitizeRemoteText(option) === value)),
    ];
    if (matches.length !== 1) fail("INVALID_FRAME");
    return { value: matches[0] };
  }
  return { value };
}
