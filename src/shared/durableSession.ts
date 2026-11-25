import type { ConversationView, EntryRecord, LiveState } from "@earendil-works/pi-durable";
import type { PiAgentEvent, PiChatMessage } from "./ipc";

/** Desktop projection contract; the outer session push envelope remains unchanged. */
export type DurableProjectionAction =
  | { type: "hydrate"; view: ConversationView }
  | { type: "events"; events: PiAgentEvent[] }
  | { type: "reconcile"; identity: string; message: PiChatMessage }
  | { type: "entry"; entry: EntryRecord }
  | { type: "state"; live: LiveState }
  | { type: "error"; error: string };

/** Internal in-process observations; this is not a renderer, extension or remote wire protocol.
 * Entries are authoritative. View documents can contain deferred, unpersisted live progress.
 */
export type DurableSessionUpdate =
  | { type: "snapshot"; sessionId: string; view: ConversationView }
  | { type: "entries"; sessionId: string; entries: readonly EntryRecord[] }
  | { type: "live"; sessionId: string; view: ConversationView }
  | { type: "settled"; sessionId: string; view: ConversationView }
  | { type: "error"; sessionId: string; error: string };
