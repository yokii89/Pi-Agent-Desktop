import type { ConversationView, EntryRecord } from "@earendil-works/pi-durable";

/** Internal in-process observations; this is not a renderer, extension or remote wire protocol.
 * Entries are authoritative. View documents can contain deferred, unpersisted live progress.
 */
export type DurableSessionUpdate =
  | { type: "snapshot"; sessionId: string; view: ConversationView }
  | { type: "entries"; sessionId: string; entries: readonly EntryRecord[] }
  | { type: "live"; sessionId: string; view: ConversationView }
  | { type: "settled"; sessionId: string; view: ConversationView }
  | { type: "error"; sessionId: string; error: string };
