import path from "node:path";
import { openNodeSqliteDatabase } from "@earendil-works/chord/sqlite/node";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { validEntries } from "../shared/durableProtocol.js";
import { DURABLE_SESSION_ID } from "../shared/sessionRef.js";

/** Read the pinned Durable 1.6 SQLite schema without Harness.open(), migrations or task resumption. */
export async function readDurableEntries(
  root: string,
  id: string,
  before?: number,
  limit = 100,
): Promise<readonly EntryRecord[]> {
  if (
    !DURABLE_SESSION_ID.test(id) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (before !== undefined && (!Number.isSafeInteger(before) || before < 1))
  )
    throw new Error("Invalid Durable history query.");
  const database = await openNodeSqliteDatabase(
    path.join(root, id.toLowerCase(), "session.sqlite"),
    { mode: "read-only" },
  );
  try {
    return await database.transaction(async (tx) => {
      const schema = await tx.get<{ version: number }>(
        "SELECT version FROM durable_schema WHERE singleton = 1",
      );
      if (schema?.version !== 2) throw new Error("Unsupported Durable history schema.");
      const conversation = await tx.get<{ id: number }>(
        "SELECT id FROM conversations WHERE owner_conversation_id IS NULL AND owner_task_id IS NULL ORDER BY id LIMIT 1",
      );
      if (!conversation) throw new Error("Durable root conversation is missing.");
      const rows = await tx.all<{ record: string }>(
        "SELECT record FROM entries WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
        conversation.id,
        before ?? Number.MAX_SAFE_INTEGER,
        limit,
      );
      const entries: unknown = rows.map((row) => JSON.parse(row.record));
      if (!validEntries(entries)) throw new Error("Invalid saved Durable entries.");
      return entries;
    });
  } finally {
    await database.close();
  }
}
