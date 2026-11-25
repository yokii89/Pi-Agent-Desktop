import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runDurableSqliteSmokeTest } from "./sqliteSmokeTest.js";

const directory = await mkdtemp(path.join(tmpdir(), "pidesk-durable-smoke-"));
try {
  const result = await runDurableSqliteSmokeTest(directory);
  console.log(`Durable SQLite round-trip passed for conversation ${result.conversationId}.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
