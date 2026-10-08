/**
 * Wire cost benchmark for the View protocol (docs/design/20 附录 A, O4).
 *
 *固化了本轮的一次性测量脚本，因为那张表否掉了一个想当然的立项理由：序列化 CPU
 * 从来不是瓶颈（最坏情况 ~0.15 ms/帧），`patch` 买到的是**线缆字节**，以及随之
 * 少做的 Host sanitize 与渲染层整树重投影。任何"引入 patch 以省 CPU"的说法都
 * 不成立，所以这里只按字节与帧率结算。
 *
 * Honest boundary: this file measures framing cost only. Host `sanitizeTree`
 * cost is gated separately by `src/main/view/viewSanitizePerf.test.ts`, and
 * renderer re-projection is not measured here at all (no rendering test
 * framework by project rule) — do not read a speedup into these numbers that
 * they do not establish.
 *
 * Run: `node packages/view-sdk/bench/wire.bench.mjs`
 */

const FRAME_INTERVAL_MS = 250;
const MAX_TABLE_ROWS = 200;
const MAX_NODES = 512;

/** Protocol-valid leaf. (附录 A's one-off script used `text:`; `content` is the real key.) */
function txt(id, content) {
  return { type: "text", id, content };
}

function tableTree(rows) {
  const children = [txt("h", "Telegram bridge status")];
  children.push({
    type: "table",
    id: "t",
    columns: [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
      { key: "c", label: "C" },
    ],
    rows: Array.from({ length: rows }, (_, i) => ({
      id: `r${i}`,
      cells: { a: `lane-${i % 3}`, b: `source-name-${i}`, c: `summary text ${i}` },
    })),
  });
  return { type: "column", id: "root", children };
}

/** The Telegram panel's worst case: 50 queue rows + 20 threads + 20 events. */
function eventCard() {
  return {
    type: "card",
    id: "events",
    title: "Events",
    children: Array.from({ length: 20 }, (_, i) =>
      txt(`events-${i}`, `[09:12:4${i % 10}] [INFO] queued prompt summary line ${i}`),
    ),
  };
}

function telegramPanelTree() {
  const card = (id, rows) => ({
    type: "card",
    id,
    children: Array.from({ length: rows }, (_, i) =>
      txt(`${id}-${i}`, `[09:12:4${i % 10}] [INFO] queued prompt summary line ${i}`),
    ),
  });
  return {
    type: "column",
    id: "root",
    children: [
      card("queue", 50),
      card("threads", 20),
      eventCard(),
      txt("status", "leader · slot A · thread bridge"),
    ],
  };
}

/** A 500-line text tree that fills the node budget, with realistically long lines. */
function maxNodesTree() {
  const line =
    "assistant reply excerpt: the queue reconciler re-checks the exact follower generation " +
    "before forwarding, and a stale authority is rejected without replaying the turn.";
  return {
    type: "column",
    id: "root",
    children: Array.from({ length: MAX_NODES - 1 }, (_, i) => txt(`n${i}`, `${i} · ${line}`)),
  };
}

function frameBytes(tree) {
  return Buffer.byteLength(
    JSON.stringify({ v: "view/v1", type: "update", id: "view-x", payload: { root: tree } }),
    "utf8",
  );
}

function patchFrameBytes(path, node) {
  return Buffer.byteLength(
    JSON.stringify({
      v: "view/v1",
      type: "patch",
      id: "view-x",
      payload: { ops: [{ path, node }] },
    }),
    "utf8",
  );
}

function measureSerialize(tree, iterations = 2000) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) frameBytes(tree);
  return Number(process.hrtime.bigint() - start) / 1e6 / iterations;
}

function row(label, bytes, ms) {
  const kib = (bytes / 1024).toFixed(2).padStart(8);
  const cost = ms === null ? "        —" : `${ms.toFixed(4)} ms`.padStart(11);
  console.log(`${label.padEnd(44)} ${kib} KiB  ${cost}`);
  return bytes;
}

console.log("\nView wire cost — single frame, JSONL, no compression");
console.log("".padEnd(70, "-"));
console.log(`${"case".padEnd(44)} ${"bytes".padStart(8)} KiB   serialize`);
console.log("".padEnd(70, "-"));

const panel = telegramPanelTree();
const panelBytes = row(
  "telegram panel (50 queue + 20 thread + 20 event)",
  frameBytes(panel),
  measureSerialize(panel),
);

const tableFull = tableTree(MAX_TABLE_ROWS);
const tableBytes = row(
  `table at maxTableRows=${MAX_TABLE_ROWS}`,
  frameBytes(tableFull),
  measureSerialize(tableFull),
);

const maxNodes = maxNodesTree();
row(
  `tree at maxNodes=${MAX_NODES} (500 text rows)`,
  frameBytes(maxNodes),
  measureSerialize(maxNodes),
);

// The honest comparison: one event tick changes a single card. Either ship the
// whole panel tree, or patch that card with the same content.
const events = eventCard();
const patchCard = patchFrameBytes([2], events);
const patchBytes = row(
  "patch: replace the events card (1 op)",
  patchCard,
  measureSerialize(events, 2000),
);

const patchRow = patchFrameBytes(
  [2, 3],
  txt("events-3", "[09:12:43] [INFO] queued prompt summary line 3"),
);
const patchOneLine = row("patch: replace one text row (1 op)", patchRow, null);

console.log("".padEnd(70, "-"));
const pct = (a, b) => `${Math.round((1 - a / b) * 100)}%`;
console.log(
  `events card patched vs. whole panel update: ${pct(patchBytes, panelBytes)} fewer bytes`,
);
console.log(
  `one patched row vs. whole panel update:     ${pct(patchOneLine, panelBytes)} fewer bytes`,
);
console.log(
  `one patched row vs. 200-row table frame:    ${pct(patchOneLine, tableBytes)} fewer bytes`,
);
console.log(`\nFrame budget: ≤${1000 / FRAME_INTERVAL_MS}/s ⇒ worst-case steady-state bandwidth`);
console.log(
  `  200-row table, whole tree: ${((tableBytes * 1000) / FRAME_INTERVAL_MS / 1024).toFixed(1)} KiB/s`,
);
console.log(
  `  panel tree, whole tree:    ${((panelBytes * 1000) / FRAME_INTERVAL_MS / 1024).toFixed(1)} KiB/s`,
);
console.log(
  `  events card patched:       ${((patchBytes * 1000) / FRAME_INTERVAL_MS / 1024).toFixed(1)} KiB/s`,
);
console.log(
  "\nVerdict: serialize cost is noise (<0.2 ms/frame). patch buys bytes,\nnot CPU — budget any patch claim in KiB and frames, never in ms.\n",
);
