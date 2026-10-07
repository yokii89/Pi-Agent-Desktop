# @pidesk/view-sdk

Client SDK for the **PiDesk extension View protocol** (`view/v1`).

Maintainers: changes to public APIs, protocols, placements, and extension
lifecycle must follow the SDK development standards (Chinese), including the
design template and delivery checklist.

Pi extensions stay as ordinary Node modules inside the pi process. When PiDesk
spawns pi it injects `PIDESK_VIEW_*` / `PI_VIEW_*` env vars. This SDK connects
to that local pipe/socket and lets the extension present a **serializable**
desktop UI — without changing pi, and without shipping executable front-end code.

Terminal pi (no env) → `connectDesktopView()` returns `null` → fall back to
`ctx.ui.custom()` TUI or a dialog walker.

### Notification sounds & desktop toasts (host service)

When a long-running tool finishes, fails, or needs a human, ask PiDesk to play
a configured system sound. Requires Host capability `notification` (PiDesk
docs/design/18). Optionally pass `toast` to also pop a Windows corner toast
(docs/design/24) — that path needs capability `system-toast`. Older hosts
soft-fail — never throws for unsupported.

```ts
import { connectDesktopView, playNotification, supportsCapability } from "@pidesk/view-sdk";

const desktop = connectDesktopView();
if (desktop) {
  const outcome = await playNotification(desktop, {
    scenario: "needsAttention", // completed | failed | needsAttention | interrupted | custom
    // sound: "2",             // optional override of the scenario default (built-in 1–5)
    reason: "deploy needs confirmation",
    // Optional desktop toast (only shown while the PiDesk window is unfocused):
    toast: supportsCapability(desktop, "system-toast")
      ? { title: "PiDesk · deploy", body: "Needs attention" }
      : undefined,
  });
  if (!outcome.ok && outcome.reason === "unsupported") {
    // terminal pi / old host — ignore or fall back
  }
}
```

Requesting `toast` on a Host without `system-toast` returns
`{ ok: false, reason: "unsupported" }` **without** sending (no silent
sound-only downgrade). Focused-window toast suppression is not a failure.

User preferences (enable/volume/focus policy/per-scenario sound / system toast)
live in PiDesk **Settings → 通知**. Extensions may only pick a scenario or
built-in sound id — never an arbitrary file path.

## Install

```bash
# from a pi extension package
npm install @pidesk/view-sdk
# or file: / git while developing against a local PiDesk checkout
```

## Quick start

```ts
import { connectDesktopView, viewOnDesktop } from "@pidesk/view-sdk";

const desktop = connectDesktopView(); // sync env probe; socket is lazy

if (desktop) {
  const result = await viewOnDesktop(desktop, {
    title: "选择模型",
    root: {
      type: "list",
      id: "model",
      items: [
        { value: "a", label: "A", description: "fast" },
        { value: "b", label: "B", description: "cheap" },
      ],
    },
    actions: [
      { id: "cancel", label: "取消", kind: "submit", variant: "ghost" },
      { id: "ok", label: "确认", kind: "submit", variant: "primary" },
    ],
  });

  if (!result) {
    // user dismissed
  } else {
    console.log(result.action, result.values.model);
  }
}
```

### Realtime UI

```ts
await desktop.open(spec, {
  signal: toolAbortSignal,
  onEvent: (event, session) => {
    if (event.type === "change") {
      state = reduce(state, event);
      // IMPORTANT: include current field values in the tree, or Host may
      // reset the form (see "Host update semantics" below).
      session.update(render(state));
    }
    if (event.type === "action" && event.actionId === "submit") {
      session.close({ action: "submit", values: collect(state) });
    }
  },
});
```

## API

| Export | Purpose |
|--------|---------|
| `connectDesktopView(options?)` | Read env, return `DesktopViewClient` or `null` |
| `acquireProcessViewClient` / `releaseProcessViewClient` | Refcounted process client (one pipe per pi process) |
| `getProcessViewClient` | Alias of acquire (back-compat) |
| `disposeProcessViewClient()` | Force-dispose on process teardown only |
| `client.refreshEnv()` | Re-read rendezvous/env after Host restart |
| `client.setSessionId(id)` | Rebind auth sessionId (forces reconnect) |
| `client.open(spec, { onEvent, signal })` | Open a view; resolve `ViewResult \| null` on close; throws `ViewHostError` on Host refusal |
| `client.openLive(spec, { onEvent, signal })` | Open and resolve with `LiveViewSession` immediately |
| `openHeader(client, options)` | Title-bar strip helper (`placement: "header"`) |
| `headerSpec(options)` | Build a header `ViewSpec` |
| `openWidget(client, options)` | Composer-adjacent widget helper (`placement: "widget"`) |
| `widgetSpec(options)` | Build a widget `ViewSpec` |
| `openPanel(client, options)` | **Right-hand** ContextSidebar dynamic tab (`placement: "panel"`); soft `null` on old hosts |
| `openSettingsView(client, options)` | Settings-page card (`placement: "settings"`); soft `null` on old hosts |
| `openSidebar(client, options)` | **Left-hand** NavSidebar embedded card (`placement: "sidebar"`); soft `null` on old hosts |
| `resolveContributionKey(id)` | Read the Host-injected `PIDESK_VIEW_CONTRIBUTION_KEYS` map; soft `undefined` |
| `readContributionKeysEnv()` / `parseContributionKeyMap(raw)` | Lower-level env read + validated parse |
| `registerAccessMode(client, options)` | One-shot composer mode registration; soft `null` on old hosts |
| `tryRegisterAccessMode(client, options)` | Same as above with explicit failure reason (for supervisors) |
| `superviseAccessMode(options)` | **Resident** access-mode slot with lifecycle + in-process lease |
| `superviseSlot(options)` | Generic registration-slot supervisor (leaseKey, rebind, reprobe) |
| `playNotification(client, options)` | System notification sound host service (`hello.capabilities` includes `notification`); optional `toast` needs `system-toast` |
| `client.notify(payload)` | Lower-level notify envelope; soft `{ ok:false }` on old hosts |
| `session.patch(payload)` | Partial update (`hello.capabilities` includes `view-patch`); soft `false` → fall back to `update()` |
| `ACCESS_MODE_ACTIONS` | `mode:activate` / `mode:deactivate` action ids the Host sends back |
| `viewOnDesktop(client, spec, options?)` | One-shot form shortcut |
| `column` / `row` / `card` | Tiny ViewNode builders |
| `ViewHostError` | Thrown when Host refuses open / fatal protocol |
| Types | `ViewNode`, `ViewSpec`, `ViewEvent`, `ViewPlacement`, `HeaderSide`, … |

### Placement

```ts
await client.open({
  title: "队列",
  placement: "panel",
  placementHint: { panelId: "my-ext-queue" },
  root,
});
```

- Default placement is `modal`.
- Implemented slots: `modal` | `stream` | `widget` | `panel` | `sidebar` | `header` | `settings` | `access-mode`.
- `placementHint.panelId` keys panel/sidebar/settings slots (per connection, per
  placement namespace). `placementHint.headerSide` picks the header
  left/center/right slot (aligned with the workspace's three columns).
- Set `placementRequired: true` only if the interaction **needs** that slot;
  Host then errors instead of falling back to modal. That covers both ways a
  slot can be unavailable: a name the Host has never heard of, and a known slot
  whose UI the Host has not shipped. An *omitted* `placement` is a normal modal
  request and is never rejected by this flag.
- After Host `opened` ack, `session.placement` is the final slot. Older hosts
  without the ack leave it `null` — treat requested placement as best-effort
  unless you set `placementRequired`.

### Widget (above / below the composer)

Interactive UIs that belong next to the task input (questionnaires, pickers)
should use `openWidget` rather than a modal:

```ts
import { connectDesktopView, openWidget } from "@pidesk/view-sdk";

const desktop = connectDesktopView();
if (desktop) {
  const session = await openWidget(desktop, {
    side: "aboveEditor", // default
    floating: true,      // @-menu style overlay; required for form content
    title: "回答问题",
    root: { type: "list", id: "q0", items },
    actions: [
      { id: "cancel", label: "取消", variant: "ghost" },
      { id: "submit", label: "提交", variant: "primary" },
    ],
    onEvent: (e, s) => {
      if (e.type === "action" && e.actionId === "submit") {
        s.close({ action: "submit", values: e.values ?? {} });
      }
    },
  });
  await session.closed;
}
```

| Mode | `placementHint.floating` | Presentation |
|------|--------------------------|--------------|
| Docked strip | `false` / omit | In-flow block above/below the input, ≤96px |
| Floating overlay | `true` | Absolute overlay like the `@` menu; forms get `min(48vh, 420px)` scroll area |

`openWidget` sets `placementRequired: true` so a host without the widget slot
errors instead of silently opening a modal. One widget per connection — a new
open replaces the previous (`closed` + `reason: "replaced"`). Floating widgets
also block composer send while open (same as modal).

### Header (title bar)

Long-lived compact strip in the title bar — status text, progress, one or two
actions. Prefer `openHeader` over raw `open`:

```ts
import { connectDesktopView, openHeader } from "@pidesk/view-sdk";

const desktop = connectDesktopView();
if (desktop) {
  const session = await openHeader(desktop, {
    side: "right", // "left" (default) | "center" | "right"
    title: "索引",
    root: { type: "text", content: "索引中… 42%", variant: "caption" },
    actions: [{ id: "stop", label: "停止", variant: "ghost", kind: "event" }],
    onEvent: (event, s) => {
      if (event.type === "action" && event.actionId === "stop") {
        s.close({ action: "stop", values: {} });
      }
    },
  });

  // Live update while the tool runs
  session.update({ type: "text", content: "索引完成", variant: "caption" });
  session.close(); // or await session.closed after Host/user dismiss
}
```

Rules (Host-enforced):

| Rule | Detail |
|------|--------|
| Slots | `left` / `center` / `right` — one strip per side per connection |
| Replace | New `open` on the same side closes the previous (`reason: "replaced"`) |
| Compact UI | caption / progress / ≤2 buttons; wide forms → `modal` / `settings` |
| Drag | Slot is `no-drag`; does not steal focus |
| Opened ack | `session.headerSide` is the final side after Host ack |

`headerSpec(options)` builds the `ViewSpec` if you need to pass it to `client.open` yourself.

### Slotted placements (panel / sidebar / settings)

These three are **resident slots** keyed by `placementHint.panelId` within one
connection. All three helpers are soft: they resolve `null` — never throw — when
there is no Host, the Host is too old to advertise the slot, or the connection
fails, so a resident caller can fall back to its TUI path.

| Helper | Lands in | `panelId` |
|--------|----------|-----------|
| `openPanel` | **right-hand** `ContextSidebar` dynamic Tab | **required** |
| `openSettingsView` | settings page, stacked cards | **required** |
| `openSidebar` | **left-hand** `NavSidebar` embedded card | optional |

⚠️ The naming is the opposite of the intuition: **`panel` is the right sidebar**,
`sidebar` is the left navigation card. "Put it in the right-hand sidebar" ⇒
`openPanel`.

```ts
const session = await openPanel(desktop, {
  panelId: "telegram-bridge", // stable semantic id, NOT the viewId
  title: "Telegram",
  root: project(state),
  actions: [{ id: "tg:refresh", label: "刷新", variant: "ghost", kind: "event" }],
  onEvent: (event) => {
    if (event.type === "action") void handleAction(event.actionId);
  },
});
if (!session) return; // no Host / too old → keep the command-line path
session.update({ root: project(nextState) });
```

- **`panelId` must be stable across reconnects.** Omit it and the Host falls back
  to `ext-<viewId>`; a live `viewId` only names one run, so after a reconnect the
  tab becomes a *new*, identity-drifted Tab instead of replacing in place.
- Same connection + same `panelId`: the new `open` **replaces** the previous view
  and the stale one gets `closed(replaced)` — do not reconnect on that reason or
  two owners will fight forever.
- All three set `placementRequired: true`: a Host without the slot errors
  (`code: "placement"`) instead of silently degrading to a modal.
- `panel` does **not** block the composer's send path (only `modal` and floating
  `widget` do), so a resident panel never gates the user's own messages.
- Do not route credentials through `settings`: payloads cross IPC and the renderer.

### Table nodes

`table` renders multi-row / multi-column read-only state (queues, follower lists,
thread records) with real column alignment, header, empty state and truncation —
without the `row × N` node blow-up of hand-composed grids.

```ts
{
  type: "table",
  id: "tg-queue",
  columns: [
    { key: "lane", label: "车道", width: 1 },
    { key: "summary", label: "摘要", width: 4, align: "right" },
  ],
  rows: [{ id: "q1", cells: { lane: "控制", summary: "继续当前计划" } }],
  emptyText: "队列为空",
  maxRows: 50,
}
```

- **Presentation only.** No sorting, filtering or paging — recompute on the
  extension side and `update()` the tree. Rows emit no event and never enter
  `values`.
- `width` is a relative weight (rendered as a percentage column width);
  missing/invalid weights split evenly.
- `maxRows` truncates the rendered rows and the Host appends a
  "显示 N / 共 M" footer. The separate protocol ceiling is `maxTableRows` (200).
- **Check the capability first.** An older Host has no `table` renderer and shows
  an `unknown` placeholder, which is not an acceptable fallback for real state:

```ts
const hello = await client.ensureConnected();
const tableCapable = hello?.capabilities?.includes("view-table") === true;
// tableCapable === false → compose the same rows from `row` / `text` instead
```

### Partial update (`patch`)

When the Host advertises `view-patch`, replace only the subtrees that changed
instead of re-sending the whole tree (`docs/design/19` §10.3):

```ts
if (session.patch({
  ops: [{ path: [1], node: queueCard }], // path [] = replace root
})) {
  // accepted — Host merged and pushed a full update to the renderer
} else {
  session.update({ root: fullTree }); // older Host / closed view / empty ops
}
```

- Paths index into `column` / `row` / `card` `children`. A `tabs` node consumes
  one path segment as the tab index, then continues into that tab's `children`.
- The Host sanitizes the **merged** tree; any failure rejects the whole patch
  (no partial apply) and keeps the previous tree.
- The renderer always receives a full-tree `update` push — bandwidth savings
  are on the Client→Host uplink only.

### Access mode (composer mode dropdown)

Register a mode into PiDesk's composer access-mode dropdown (PiDesk
`docs/design/14`). The Host renders one row per registration; the user's click
flows back as `mode:activate` / `mode:deactivate` action events. The extension
stays the source of truth — apply the real behavior (e.g. `setActiveTools`
gates) and report state with `setActive`, which also keeps the chip in sync
when the mode changes from the TUI side (shortcuts, commands, session resume).

**Resident chips must use the supervisor** — do not hand-roll re-registration:

```ts
import {
  acquireProcessViewClient,
  releaseProcessViewClient,
  superviseAccessMode,
} from "@pidesk/view-sdk";

const desktopMode = superviseAccessMode({
  connect: () => acquireProcessViewClient(),
  registration: {
    id: "yoki-plan",
    title: "计划模式",
    description: "只读探索，产出计划后再执行。",
    icon: "clipboard",
    accent: "warning",
  },
  onActivate: () => enterPlan(),
  onDeactivate: () => enterEdit(),
  onRegistered: (handle) => {
    handle.setActive(mode === "plan", mode === "plan" ? detail : undefined);
  },
});

// pi session_start
void desktopMode.ensure();

// pi session_shutdown — stop supervisor, release shared pipe ref
desktopMode.stop();
releaseProcessViewClient();

// in-process session switch (Host closed reason=session)
await desktopMode.rebindSession(newPideskSessionId);
```

One-shot path (forms / probes that do not need lifecycle):

```ts
import { ACCESS_MODE_ACTIONS, connectDesktopView, registerAccessMode } from "@pidesk/view-sdk";

const desktop = connectDesktopView();
if (desktop) {
  const mode = await registerAccessMode(desktop, {
    id: "yoki-plan",
    title: "计划模式",
    onEvent: (event) => {
      if (event.type !== "action") return;
      if (event.actionId === ACCESS_MODE_ACTIONS.activate) enterPlan();
      if (event.actionId === ACCESS_MODE_ACTIONS.deactivate) enterEdit();
    },
  });
  if (mode) mode.setActive(true, "只读：edit/write 已禁用");
  // mode === null: no host / old host / slot refused → keep the /plan command path
}
```

### Registration slots & multi-process lifecycle

Resident placements are first-class: the SDK owns the **process-level**
lifecycle so every extension reuses the same contract (previously hand-written
in each package).

```ts
const supervisor = superviseSlot<Handle>({
  client: getProcessViewClient(), // one pipe per pi process
  register: (client) => tryRegisterAccessMode(client, descriptor), // soft outcomes
  getSession: (handle) => handle.session, // loss signal
  onRegistered: (handle) => syncTruth(handle),
});
await supervisor.ensure();
supervisor.stop();
```

State machine:

```
ensure() → connecting → registered
              ↘ retrying (default 500ms / 2s / 8s) → exhausted → reprobe (30s)
              ↘ unsupported (no host / no slot / lease held)
registered --closed-->
  dispose / empty → connecting (refreshEnv if Host restarted)
  session         → displaced → rebindSession(id)
  replaced        → displaced (in-process lease; no thrash)
stop() → stopped
```

| Event | Status | Retry? |
|-------|--------|--------|
| No `PIDESK_VIEW_*` env / connect returns null | `unsupported` | slow re-probe |
| `hello` present but slot not advertised (old host) | `unsupported` | slow re-probe |
| Lease held by another supervisor in-process | `unsupported` | no |
| Connect/hello timeout, pipe drop, host refuse | `retrying` → … | yes, bounded |
| After last backoff still failing | `exhausted` | `reprobeMs` default 30s |
| Live registration `closed(dispose)` | reconnect | **immediate** + refreshEnv |
| `closed(session)` | `displaced` | `rebindSession(newId)` |
| `closed(replaced)` | `displaced` | only if `retryOnReplaced` |
| `stop()` (session_shutdown) | `stopped` | never |

**Multi-process (multi-pi) model**

| Layer | Owner | Responsibility |
|-------|-------|----------------|
| Pipe + auth + sessionId | This SDK (`acquireProcessViewClient`) | One connection per pi process; rendezvous refresh after Host restart |
| Registration lifetime | This SDK (`superviseSlot`) | Re-register, backoff, lease, rebind, shutdown |
| Per-session isolation / mutual exclusion | PiDesk Host renderer | Never part of the extension |

Do not share a supervisor across processes; each pi session process creates
its own on `session_start` and `release`s on `session_shutdown`.

### Protocol types lockstep

`src/types.ts` is **generated** from PiDesk `src/shared/view.ts`
(`#begin/#end view-sdk-protocol`). Do not hand-edit it.

```bash
# from the pidesk repo root
pnpm sync:view-types    # regenerate packages/view-sdk/src/types.ts
pnpm check:view-types   # fail on drift (also runs in `pnpm test:view`)
```

### Access mode rules

| Rule | Detail |
|------|--------|
| One per connection | A new registration replaces the previous (`reason: "replaced"`), even at the open-views cap |
| Truth lives in the extension | Host only renders `placementHint.mode` and routes activation |
| Never throws | Resolves `null` / `{ok:false}` on no host, old host, refused slot, connection failure, or empty `id`/`title` |
| Session scoped | The registration dies with its pi session |
| Recoverable | `superviseAccessMode` re-registers on `session.closed`; client reconnects automatically |

`icon` accepts Host built-in names — current set: `"shield"`, `"shield-check"`,
`"clipboard"`; unknown names fall back silently.

### Contribution keys (Catalog binding)

When a view is a static Contribution Catalog entry (PiDesk `docs/design/16`), the
Host spawns the extension with its allowed id→key bindings encoded in
`PIDESK_VIEW_CONTRIBUTION_KEYS` (falling back to `PI_VIEW_CONTRIBUTION_KEYS`),
and the registration must carry the matching `contributionKey` so a cold-state
Catalog entry binds to the live view instead of opening a second one:

```ts
import { registerAccessMode, resolveContributionKey } from "@pidesk/view-sdk";

await registerAccessMode(desktop, {
  id: "plan",
  title: "Plan 模式",
  contributionKey: resolveContributionKey("plan"), // undefined outside PiDesk
  onEvent: handle,
});
```

`resolveContributionKey(id, env?)` is soft: no Host, missing env, malformed JSON,
a non-object map, or a missing / empty / non-string value all yield `undefined`
rather than throwing. Pass `env` explicitly in tests. For several lookups, read
the payload once with `readContributionKeysEnv()` + `parseContributionKeyMap()`.

Keys look like `ck:<ctx>:<scope>:<pkg>:<placement>:<id>` and are generated by the
Host — never hand-write them. The id you look up must match
`pidesk.contributes.*[].id` in `package.json`.

### Host update semantics

`update()` is a **full tree replace**. Prefer embedding the user's current
input (`input.value`, `list.value`, `checkbox.checked`) in the next tree so
extension-side state stays aligned with what the user sees. Host form stores
now also preserve live values for ids that still exist when the tree omits
them, so a preview-only update no longer wipes typing.

## Protocol sketch

```
Client                          Host (PiDesk main)
  |-- { token } --------------->|
  |<-------- hello -------------|  placements capability
  |-- open(spec) -------------->|
  |<-------- opened ------------|  final placement (optional on old hosts)
  |<-------- event -------------|  change / action / dismiss
  |-- update(tree) ------------>|
  |-- close(result) ----------->|  (Host does not reply)
  |<-------- closed ------------|  user / session / replaced / timeout / …
```

Transport: JSONL over named pipe (Windows) / Unix socket / `127.0.0.1` TCP
fallback. One connection multiplexes many views by `id`.

## Limits (Host-enforced)

Tree depth ≤ 32 · nodes ≤ 512 · strings ≤ 64 KiB · options ≤ 1000 ·
open views ≤ 8 · message ≤ 1 MiB · table rows ≤ 200 · table columns ≤ 12 ·
patch ops ≤ 32. Unknown `type` becomes a diagnostic placeholder — never a disconnect.

A `table` row counts as **one** node against `maxNodes` (cells are not nodes), so
a full 200-row table costs ~201 nodes. Each `tabs` entry also costs one.

**These numbers are exported, not prose.** `VIEW_LIMITS` is the compile-time
default; `client.limits` returns the Host's live budget from `hello.limits` and
falls back to `VIEW_LIMITS` for older Hosts. Do not re-declare them in an
extension — `measureViewTree(root, client.limits)` mirrors the Host's exact
accounting (including what it truncates), and a Host-side regression test asserts
the two never disagree.

`open()` / `session.update()` fail locally with `ViewHostError(code: "limit")`,
naming the key and the measured value, for frames the Host is **guaranteed** to
reject or disconnect over (`maxDepth`, `maxNodes`, `maxMessageBytes`).
Truncation-class limits are never thrown — the Host clips those and keeps
rendering, which is not the SDK's call to make. `frameBudgetViolations()` returns
both classes if you want to warn in your own UI.

## Choosing a capability-gated shape

```ts
import { supportsPatch, supportsTable, tableView } from "@pidesk/view-sdk";

// `table` renders as an `unknown` placeholder on hosts without `view-table`,
// so the degraded tree is built for you instead of forked per extension.
const root = column([
  text("Telegram bridge"),
  tableView(desktop, { id: "queue", columns, rows }),
]);

if (supportsPatch(desktop)) session.patch({ ops });   // else: full update
```

## Throttling a live panel

```ts
const writer = session.coalesced({ intervalMs: 250 }); // ≤4 frames/second
for (const tick of ticks) {
  writer.set(project(tick), patchOpsFor(tick), {
    actions: actionBarFor(tick),   // rides the same frame as the tree
  });
}
await writer.flush();               // action boundary: converge before sending
await writer.flushNow();            // right after open(), when nothing is dirty
writer.stop();                      // also stopped automatically when closed
```

`set()` takes the whole tree **and** the patch expressing the same change; the
writer picks `patch` or `update` from the advertised capability. The optional
third argument carries the non-tree fields of an `update` / `patch` frame
(`actions` / `title` / `placementHint`) so action-bar state such as `disabled`
coalesces with content instead of needing a side-channel timer. Omitted fields
are left off the frame (the Host keeps its current value); pass `actions: []`
to clear the bar. A change that arrives while a frame is on the wire is never
dropped — one more frame is owed.
For a bare scheduler (not bound to a session) use `createViewFrameScheduler()`.
Reconnection stays with `superviseSlot`: the scheduler owns *when*, the session
owns *whether the wire exists*.

## Telling "user cancelled" from "host refused"

```ts
const result = await openPanelResult(desktop, { panelId: "telegram-bridge", root });
if (!result.ok) {
  // code: "no-host" | "handshake-timeout" | "transport" | "aborted" | "invalid"
  //     | "placement" | "limit" | "protocol" | "internal"  (the Host's own codes)
  if (result.retryable) scheduleRetry();
  else fallBackToTui();
}
```

`openPanel()` / `openSidebar()` / `openSettingsView()` stay soft (`null`, never
throw) — they are projections of the same implementation. `session.onError()` and
`viewOnDesktop(..., { onError })` reach the Host's `error` frames on paths that
used to swallow them, and `update()` / `patch()` returning normally means
**sent**, not accepted.

## Testing an extension against a real protocol

`createTestViewHost()` (repo-internal at `src/testing.ts`, not published — see
`docs/design/20` §6.3) starts a loopback Host that imports the real
`resolvePlacement` / `sanitizeTree` decisions instead of restating them, with a
`legacy` mode for old-Host coverage.

## Security

ViewNode is **data**. Host never `eval`s or injects HTML. Endpoint is
localhost-only; token is per-session and not logged.

## Gaps found while integrating yoki-ask-user-question

These are real friction points the first consumer hit. Several are already fixed
in Host / this SDK; the rest are open protocol or Host items.

| Gap | Status | Notes |
|-----|--------|-------|
| No open ack — Client could not learn final placement after fallback | **Fixed** | Host now sends `opened` with `{ placement, panelId }`. Old clients ignore it. |
| Full-tree `update` wiped live form input | **Fixed** | Host store now keeps previous values for ids still present; tree `value`/`checked` still win when the Client echoes them. |
| `connectDesktopView()` documented as sync, but socket connect is async | **SDK design** | Env probe is sync; socket is lazy on first `open()` / `ensureConnected()`. |
| `tabs` ViewNode | **Implemented** | `tabs` + `ViewTab` exist in `src/types.ts`; Host renders via `components/ExtensionView/tabs-node.ts`. (This row previously claimed "compose" — it was stale.) |
| `checkbox` has no `description` | Workaround | Questionnaire uses `list` items (label + description) instead of checkboxes. |
| `ViewOption` has no `preview` | Workaround | Client pairs `list` + sibling `markdown` and re-renders on `change`. |
| Notes / free-text per option | Workaround | Extra `input` nodes; protocol has no first-class annotation. |
| Per-connection open-view limit was a **global** counter | **Fixed** | Host now counts open views per connection id. |
| `select` ignored option `description` | **Fixed** | Host renders `label — description` in the native `<option>`. |
| Dependent controls (e.g. thinking levels follow model) need full-tree update | Works | `session.update(buildSpec())` after `change`; keep control `id`s stable. |
| Extension modules can form static import cycles when both use the SDK | Packaging | Put shared constants in a leaf module; lazy-`import()` the desktop path from the TUI module if needed. |
| SDK not published to npm | Packaging | Publishes as built JS now (`pnpm build` → `dist/`, `exports["."]` → JS, verified by `pnpm check:sdk-consumer`), but it is still **not on a registry**: consumers resolve it via `file:../../../pidesk/packages/view-sdk`, which requires `dist/` to exist (`pnpm install` runs it via `prepare`). Publish or vendor before a public `pi install`. |
| `placementRequired` did not reject an unknown placement | **Fixed** | `resolvePlacement` used to fold any unknown string to `modal` **before** consulting `required`, so the rejection branch was unreachable while all eight slots exist — the flag only caught "known but unimplemented". It now asks "is this a known slot?" first: an explicit non-enum name (a typo, or a slot a newer SDK invented) + `placementRequired: true` is rejected with `code: "placement"`, exactly as `ViewSpec`'s JSDoc and `docs/design/08` §5.3.3 promised. An **omitted** `placement` is still the documented `modal` default and is never rejected. Pre-checking `hello.placements` stays the cheap path (`openPanelResult`'s `code: "placement"`), but it is no longer the only one. Decision recorded in `docs/design/20` §6.2. |
| No JSON Patch / partial update | **Fixed (P2)** | Envelope type `patch` + Host capability `view-patch`. `session.patch({ ops })` replaces subtrees by child-index path (`[]` = whole root); soft `false` on older Hosts → fall back to full `update()`. Renderer still receives a merged full tree. See `docs/design/19` §10.3. |
| No focus / scroll / keyboard events | v2 | Desktop relies on visible controls only (by design for v1). |
| `widget` was docked-only (≤96px in-flow), not `@`-menu overlay | **Fixed** | `placementHint.floating` + `openWidget()` render an absolute overlay above/below the composer; forms get a taller scroll area. |
| `widget` max-height 96px too small for multi-question forms | **Fixed** | Floating variant uses `min(48vh, 420px)`. Docked strip keeps 96px. |
| No first-class “blocking composer while a tool form is open” flag | **Fixed** | Floating widget now blocks send the same way modal does. |
| `open()` treated Host placement rejection as user cancel (`null`) | **Fixed** | `open()` now throws `ViewHostError` (`code: "placement" \| "limit" \| "closed"`); callers fall back to TUI. User dismiss still returns `null`. |
| Invalid control nodes (missing `id`) truncated siblings and reported “depth overflow” | **Fixed** | Host degrades them to `unknown` placeholders; siblings continue. |
| `ViewSpec` in shared contract lacked `timeoutMs` (SDK already had it) | **Fixed** | `src/shared/view.ts` `ViewSpec.timeoutMs` now matches open payload. |
| `ViewClosedReason` union missed Host `limit` | **Fixed** | Added `"limit"` to shared + SDK unions. |
| `openHeader` / `openWidget` always sent `placementRequired` without reading `hello` | **Fixed** | Both helpers fail fast with `ViewHostError` when `hello` is present and the slot is missing. |
| 50ms change debounce could race an immediate action | **Fixed** | Renderer flushes pending `change`s for that view before sending `action`. |
| Host injects `PIDESK_VIEW_CONTRIBUTION_KEYS` but the SDK never reads it | **Fixed** | `resolveContributionKey(id)` reads and validates the map (soft `undefined`); `yoki-plan` dropped its hand-rolled parser. See `docs/design/19` §3.1.1. |
| Placement helpers are asymmetric: `openWidget` / `openHeader` exist, `panel` / `settings` / `sidebar` do not | **Fixed** | `openPanel` / `openSettingsView` / `openSidebar`. The first two require a stable `panelId` — omitting it lets tab identity drift across reconnects. See `docs/design/19` §3.1.2. |
| No `table` node — tabular state must be composed from `row`/`column` | **Fixed** | `table` node + Host rendering, gated behind the `view-table` hello capability. Rows count one node each, capped at `maxTableRows` (200). See `docs/design/19` §3.2.1. |
| `sidebar` (left `SideNav` card) vs `panel` (right `ContextSidebar` tab) is not documented | **Fixed** | Documented under Placement below and in `docs/design/08` §5.3.2 — the naming is counter-intuitive; `panel` is the right-hand slot. |

### Integration checklist for new extensions

1. `connectDesktopView()` — null means terminal / non-PiDesk.
2. Prefer modal unless the interaction truly needs stream/widget/panel.
   Composer-adjacent forms (questionnaires) → `openWidget({ floating: true })`.
3. Realtime UIs: `client.open(spec, { onEvent })`; keep control `id`s stable.
4. Always close explicitly on submit; Host dismiss resolves `null` (cancelled).
5. Catch `ViewHostError` from `open()` — that is Host refusal (placement/limit),
   **not** a user decline. Fall back to TUI / dialog walker.
6. Abort the tool `signal` — SDK maps it to `close` + `reason: "abort"`.

## Relationship to pi

| Path | When |
|------|------|
| `desktop.view` / `client.open` | Running under PiDesk (env present) |
| `ctx.ui.custom()` | Terminal pi TUI |
| `ctx.ui.select/input` walker | RPC hosts without custom UI |

pi core is unchanged. Protocol types are generated from PiDesk
`src/shared/view.ts` (`pnpm sync:view-types`).
