# @pidesk/view-sdk

## 0.5.1 — 2026-10-28

**Access-mode contribution helper + public manifest subset** (PiDesk
`docs/design/80`). Additive public API; no wire, Host capability or protocol
change. No breaking change for 0.5.0 consumers.

```bash
npm install @pidesk/view-sdk@0.5.1
```

- **`defineAccessMode(entry)`** — pass the same object as
  `pidesk.contributes.accessModes[]` (import your `package.json`) and use the
  frozen result as the `registration` for `superviseAccessMode()` /
  `registerAccessMode()`. `id` / `title` are trimmed; an empty identity or a
  non-`onAccessMode` activation throws `TypeError`. `activation` is dropped from
  the runtime descriptor. This replaces the hand-written id constant + descriptor
  + manifest entry with one source.
- **`accessModeManifestEntry(mode)`** — the reverse projection, for a one-line
  drift test when the manifest stays hand-written.
- **Public contribution manifest subset** — `ManifestContributionItem`,
  `ContributionPlacement`, `ContributionActivation`, `ContributionAccent`,
  `ContributionIconName`, `CONTRIBUTION_ICON_NAMES`, `CONTRIBUTION_ICONS`,
  `CONTRIBUTION_LIMITS`, plus `ACCESS_MODE_ICON_NAMES` / `AccessModeIconName`
  for the three icons the composer chip actually renders. Generated from
  `src/shared/contribution.ts` (second `view-sdk-contribution` region);
  `pnpm check:view-types` verifies both generated files.
- **Host lockstep** — `ManifestContributionItem` now lives in
  `src/shared/contribution.ts` (the manifest parser imports it), and the
  access-mode icon map is `Record<AccessModeIconName, …>`, so adding a chip icon
  to the shared list fails to compile until it is rendered.
- No new dependencies.

**Verification**: 187 SDK tests (17 files; +9 for this batch), 470 main-process
tests (54 files), 389 renderer tests (38 files), `check:view-types` (both
generated files), typecheck (SDK / main / renderer), `biome check .` (742 files),
production build, and the packed-consumer check (62 public exports). No Electron
acceptance: this is a pure SDK helper with no UI surface.

## 0.5.0 — 2026-10-28

Implements PiDesk `Docs/06-Telegram侧栏改版·View SDK 能力缺口与需求.md`
(R1–R9). All wire additions are additive inside view/v1; no existing field
changes meaning and no API is removed.

```bash
npm install @pidesk/view-sdk@0.5.0
```

**Panel-facing capabilities**

- **`list.readonly`** (+ capability `view-readonly-list`,
  `supportsReadonlyList(client)`) — a non-selectable list: no `values` write, no
  `change`, no active bar, rows are `listitem`s outside the tab order. Older Hosts
  drop the field, so probe before sending it.
- **`layout` events** (+ capability `view-layout`) — the Host reports the panel
  content-box size after mount and after debounced resizes as
  `ViewSessionEvent { type: "layout", width, height? }` on the normal `onEvent`
  stream. Old Hosts simply never emit it; keep narrow-width copy as fallback.
- **`ViewTab.status: "none"`** — draws no status dot for information streams.
  Old Hosts fall back to the hollow “unanswered” dot (accepted degradation).
- **`placementHint.panelBadge`** (+ capability `panel-tab-badge`) — tone
  (`attention` / `success` / `muted`), optional count (1–99, `99+` overflow) and
  short label on the sidebar tab, launcher card and add menu. The badge meaning
  is part of the accessible name; a badge never reopens a user-closed tab.
  `placementHint` is replaced wholesale: resend `panelId` without `panelBadge`
  to clear.
- **`placementHint.panelHeader`** (+ capability `panel-header`) — a fixed slot
  above the panel's scroll container for one status row. Only light nodes are
  accepted (`text` / `row` / `column` / `card` / `progress` / `divider`); other
  types are dropped rather than rendered as placeholders.

**SDK fix**

- **`tableViewFallback` keeps every column.** It used to emit one cell per row
  (`labelKey ?? columns[0]`) while the header still listed all columns, so data
  silently disappeared on Hosts without `view-table`. Rows now carry all cells
  (lead cell `body`, rest `caption`); `labelKey` only chooses the lead column.
  New `compact: true` restores the one-cell line for genuinely narrow rails.

**Verification**: 178 SDK tests (16 files), 470 main-process tests (54 files),
389 renderer tests (38 files), typecheck (SDK / main / renderer+shared), and the
packed-consumer check. No new dependencies.

## 0.4.0 — 2026-10-28

**Includes 0.3.0** (listed below; 0.3.0 was never published on its own, so this is
the first npm release since 0.2.0).

```bash
npm install @pidesk/view-sdk@0.4.0
```

Implements PiDesk docs/design/79. Two additive node fields; no envelope or message
change, and no breaking API change. Measured on the questionnaire workaround (one
question, two options): **9 nodes / depth 4 / 536 B → 5 nodes / depth 2 / 361 B**.

- **`ViewListOption.preview`** — a Markdown side pane for `list` options, gated by
  the new `view-option-preview` Host capability (`supportsOptionPreview(client)`).
  The Host follows hover / row focus locally (no focus events are needed), keeps
  the last active row when the pointer leaves, and falls back to selection → first
  item with a preview → first item. `preview` is **not** a form value and never
  enters `values`; `select` options are unchanged. Oversized previews are truncated
  to `VIEW_OPTION_PREVIEW_MAX_CHARS` (4000).
  - **Migration**: older Hosts drop the field during `sanitizeOptions`; extensions
    that need the pane must keep their sibling-`markdown` fallback until
    `supportsOptionPreview()` returns true.
- **`text.tone`** (`muted` | `success` | `warning` | `danger`) — semantic color for
  paragraphs. Emphasis only: the status word must remain in the copy, since older
  Hosts drop the field and color must never be the only signal.
- **`VIEW_OPTION_PREVIEW_MAX_CHARS`** is exported from the protocol types, and the
  type-sync guard now requires it to stay inside the mirrored region.

**Verification**: 174 SDK tests, 453 Host protocol tests, 382 renderer tests,
typecheck (SDK / main / renderer), `biome check`, and the production build all pass.
No new dependencies.

## 0.3.0 — 2026-10-25 (unpublished; shipped in 0.4.0)

Panel contributions become **launcher features** on Hosts that advertise the new
`panel-launcher` capability (PiDesk docs/design/66). No new message or node; the
only wire addition is the additive `hello.capabilities` entry. The same `panel`
placement and `openPanel()` helper work with both generations.

- **New export `supportsPanelLauncher(client)`.** True when the Host renders
  `pidesk.contributes.panels` on the right sidebar's start page and “+” menu,
  where a Catalog entry only occupies a tab after the user opens it. On legacy
  Hosts (no capability) Catalog panels remain resident tabs as before.
  - **Migration**: extensions that relied on a Catalog panel being visible
    without an explicit open should call `openPanel()` after the session is
    ready. The call replaces the resident slot on old Hosts and is harmless on
    new ones; probing the capability is only needed for behaviour that differs.
- **Panel tab close now means “hide” on capable Hosts.** The live View keeps its
  registration and keeps receiving `update` / action traffic; reopening from the
  add menu restores it. Ending the panel remains `session.close()` / the panel's
  own Close button (`dismiss`).
  - A user close also **suppresses automatic reopening**: later `open()` /
    reconnect attempts do not steal the tab back; the user reopens it from the
    launcher or add menu. This is Host UI behaviour and is advertised via
    `panel-launcher`; the SDK API is unchanged.
- **Manifest icon set expanded** for launcher cards: `folder`, `globe`,
  `git-pull-request`, `terminal-window`, `chat-circle`, `robot`, `database`,
  `code`, `list-checks`, `calendar`, `envelope`, `chart-line` join the existing
  generic names. Unknown names still fall back to `puzzle-piece`; the Host
  validates the list during manifest scanning. New shared source:
  `CONTRIBUTION_ICON_NAMES` (`src/shared/contribution.ts`).
- **Protocol type sync**: `ViewHostCapability` now includes `panel-launcher`
  (`src/shared/view.ts` → generated `types.ts`). Old Clients ignore the extra
  `hello.capabilities` entry.

## 0.2.0 — 2026-10-13 (first npm publish)

Implements PiDesk docs/design/20 (O1–O7). Measured before/after in that doc's §4.

- **`session.coalesced().set()` can carry frame meta** (docs/design/20 §9):
  `set(root, ops?, meta?)` where `meta` is
  `Pick<ViewUpdatePayload, "actions" | "title" | "placementHint">`. The same
  fields already ride `update` / `patch` on the wire and in the Host; coalesced
  writes were the only path that dropped them — which is why a live panel's
  action-bar `disabled` state still needed a side-channel `setInterval`.
  - Omitted fields stay off the frame (Host keeps its current value), matching
    `session.update({ root })`. Pass `actions: []` to clear the bar.
  - New export: `CoalescedFrameMeta`. Existing `set(root, ops)` callers are
    unchanged. No wire or Host change.

- **Internal: removed the unreachable `#pendingWrites` pre-ready write queue**
  (`docs/design/20` §8). Every public send path awaits `ensureConnected()`, and
  every teardown settles its views first, so the queue had no reachable producer.
  `#send` / `#guardedSend` now write straight through `#rawWrite`. No public API
  or wire change; behavioural coverage for "writes after rebind/dispose must not
  reach another connection" stays in `connection-lifecycle.test.ts`.

- **Desktop toast on `playNotification`** (docs/design/24):
  - New optional `playNotification(..., { toast: { title, body? } })` asks the Host
    to pop a Windows corner toast alongside the sound. Wire field:
    `ViewNotifyPayload.toast?: ViewNotifyToastPayload`.
  - New Host capability **`system-toast`** (advertised in `hello.capabilities` /
    `VIEW_HOST_CAPABILITIES`). Requesting `toast` without it returns
    `{ ok: false, reason: "unsupported" }` locally — no silent sound-only send.
  - Host only *displays* the toast while the main window is unfocused; focused
    suppression and `notification.systemToast: false` are not failures
    (`ok: true` still covers the sound path). Toast copy is plain text (Host
    truncates). New export: `PlayNotificationToast`, `ViewNotifyToastPayload`.
  - **Migration**: existing sound-only callers unchanged. To feature-detect,
    probe `supportsCapability(client, "system-toast")` before passing `toast`.

- **Host contract tightened: `placementRequired` now rejects an unknown slot name**
  (`docs/design/20` §6.2, decision (a)). `resolvePlacement` consulted `required` only
  *after* folding any non-enum value into `modal`, so the rejection branch was
  unreachable while all eight slots are implemented — a typo'd or not-yet-shipped slot
  name opened as a modal, which is the one outcome `ViewSpec.placementRequired` and
  `docs/design/08` §5.3.3 said would never happen. It now asks "known slot?" before
  "implemented slot?".
  - **Impact**: an `open()` that used to render as `modal` now rejects with
    `ViewHostError(code: "placement")` + `closed(reason: "placement")`. Reachable only
    for a placement value outside the `ViewPlacement` union — i.e. code that already
    needed `as never` to compile. Every SDK helper passes a literal from the union.
  - **Unchanged**: an *omitted* `placement` is still the documented `modal` default and
    is never rejected, with or without `required`; a known slot that is not implemented
    still degrades to `modal` unless `required` is set.
  - **Migration**: none for typed callers. If you deliberately sent a slot PiDesk does
    not know and relied on the modal fallback, drop `placementRequired` or pre-check
    `hello.placements`. An **older Host still degrades** — this is Host behaviour, so do
    not infer it from the package version (准则 §7.2.1); `openHeader` / `openWidget` /
    `openPanel*` already fail locally on a missing slot and behave the same on both.
  - Versioning judgement: the SDK's own code and `view/v1` wire format are unchanged, so
    no minor bump here — the change ships with the Host and is recorded in
    `docs/design/08` §5.3.3.

- **Failure semantics no longer collapse** (准则 §6, O2):
  - `openPanelResult()` / `openSidebarResult()` / `openSettingsViewResult()` return
    `{ ok: true; session } | { ok: false; code; message; retryable; error? }`.
    `code` is the Host's own `ViewErrorCode` when the Host refused, plus
    `no-host` / `handshake-timeout` / `transport` / `aborted` / `invalid` for the
    conditions only the SDK can observe. `openPanel()` and friends keep their
    soft `null` contract as a projection of these — no caller breaks.
  - `SlotRegisterFailure` gains `timeout` and `transport`. `"refused"` now means an
    explicit Host no and carries the Host `error` payload; a slow Host, a dropped
    pipe and a rejection are no longer the same value. Both stay retryable in
    `superviseSlot`.
  - `LiveViewSession.onError(handler)` observes Host `error` frames without the
    full event stream; `viewOnDesktop()` gained `options.onError`, so the one-shot
    form path can finally see `limit` / `protocol`.
  - `update()` / `patch()` JSDoc now state that success means **sent**, not
    accepted.
  - `playNotification()`: a caller contract violation (e.g. a stub missing
    `notify`) reports `reason: "internal"` instead of `"disconnected"`, and an
    unlisted Host reason is preserved in `detail` rather than vanishing.
  - Protocol: `ViewClosedReason` gains `rebind` (the SDK already emitted it), and
    `ViewClosedPayload.reason` is `ViewClosedReason | (string & {})` instead of
    `| string`, so typos and exhaustiveness checks work again. **Type-only
    narrowing** — a consumer comparing `reason` against an arbitrary string may
    now fail to compile.
- **Host limits and capabilities moved into the SDK** (准则 §7.1, O3):
  - `VIEW_LIMITS`, `IMPLEMENTED_VIEW_PLACEMENTS`, `SLOTTED_VIEW_PLACEMENTS`,
    `VIEW_HOST_CAPABILITIES` and `ViewLimits` are now inside the mirrored
    protocol region, so `check:view-types` locks them (6 protocol constants
    asserted by the sync script).
  - `hello.limits` (optional): the Host ships its live budget; older Hosts are
    served the compile-time default via `client.limits`.
  - Outbound pre-flight: `open()` / `update()` throw
    `ViewHostError(code: "limit")` with the measured count for frames the Host is
    **guaranteed** to reject or disconnect over (`maxDepth`, `maxNodes`,
    `maxMessageBytes`). Truncation-class limits are never thrown — the Host clips
    those and keeps rendering.
  - `measureViewTree()` / `frameBudgetViolations()` replace hand-copied counters.
    `src/main/view/viewBudgetLockstep.test.ts` proves the mirror agrees with Host
    `sanitizeTree` on accept/reject for 15 tree shapes.
  - `supportsCapability()` / `supportsTable()` / `supportsPatch()` / `viewLimits()`
    tolerate a `null` client; `tableView()` emits a `table` node or the
    equivalent `column`/`row` tree per capability, so the degraded rendering path
    is written once instead of per extension.
  - `panelId` is validated (`trim()` non-empty) before send instead of letting the
    Host invent `ext-<viewId>`.
  - **Removed** the dead `client.placements` getter (zero consumers); use
    `hello.placements`. `isProcessViewClient` is documented package-internal.
- **Frame scheduling is an SDK primitive** (准则 §1.4 / §9, O4):
  - `createViewFrameScheduler({ intervalMs, send })` with merge window, `flush()`,
    `flushNow()`, `stop()` and in-flight backpressure that never drops the last
    change. Ported 1:1 from `pi-telegram-main`'s scheduler, pinned by 13 tests
    that were red against the empty implementation first.
  - `session.coalesced()` returns a `CoalescedViewWriter`: `set(root, ops)` picks
    `patch` or whole-tree from the advertised capability and replays at ≤4/s. Its
    timer is cancelled when the view settles.
  - `packages/view-sdk/bench/wire.bench.mjs`固化 the single-frame cost table;
    `src/main/view/viewSanitizePerf.test.ts` gates Host `sanitizeTree` (measured
    0.097–0.254 ms/frame), so no claim of an end-to-end speedup rests on
    serialization alone.
- **Test doubles can no longer drift** (O5):
  - `@pidesk/view-sdk/testing` exports `createTestViewHost()` — a loopback Host
    built on the **real** `resolvePlacement` / `resolvePanelId` /
    `buildOpenedPayload` / `sanitizeTree` and the real capability list, with a
    `legacy` mode for old-Host coverage. This package's own integration suite now
    runs on it.
  - `pnpm check:sdk-cross` runs both repos (SDK + main + renderer tests, lockstep,
    build, consumer check, biome, three tsc configs, and the three direct
    consumers' desktop suites) and prints one table.
  - The `__*ForTests` hooks moved out of the public entry into `./testing`.
- **The package is now consumable** (O6):
  - `pnpm build` emits `dist/` (JS + `.d.ts`); `main` / `types` / `exports["."]`
    point at it instead of `src/index.ts`, which no Node process could load.
  - `pnpm check:sdk-consumer` packs the tarball, unpacks it into an independent
    directory, and asserts: native `import` works, the shipped `.d.ts`
    type-checks a consumer, deep `src/*` imports are refused, and no test hook
    leaks.
  - `ViewProcessEnv` replaces `NodeJS.ProcessEnv` in the public API so consumers
    are not forced to install `@types/node`.
  - **Migration note:** extensions resolving the package now need `dist/` to
    exist — run `pnpm build:view-sdk` (or `pnpm install`, via `prepare`).
    `@pidesk/view-sdk/testing` is intentionally **not** published: the harness
    imports Host protocol code, and shipping it requires deciding whether those
    helpers move into the SDK.
- **Lifecycle branches** (O7): 12 new tests cover `retryOnReplaced`, the
  `limit`/`placement`/`protocol` re-registration loop, `holdOnSessionClose:false`,
  reprobe from `unsupported`, `snapshot.lastFailure` / `lastClosedReason`,
  `stop()` closing a live handle with no residual timer, lease release, and
  `#connectWithRefresh` both ways.
  - **Fixed**: `#connectOnce` now attaches the socket `error` listener before the
    connect await. A socket destroyed during teardown or a failed connect
    previously emitted an uncaught `ECONNRESET` capable of taking down the host pi
    process.
  - **Fixed** `pi-telegram-main`/`yoki-plan`: `export { resolveContributionKey as
    readContributionKey } from "@pidesk/view-sdk"` creates no local binding, so
    the two in-module call sites threw `ReferenceError` and were swallowed by a
    catch-all as "no desktop host". Now imported under the alias.

## 0.1.0

Pre-0.2.0 capability补齐 (PiDesk docs/design/19). Kept here so the 0.2.0
entry stays scoped to the O1–O7 delivery; these APIs shipped together with it.

- **Capability补齐 for resident panels** (PiDesk docs/design/19):
  - `resolveContributionKey(id, env?)` + `readContributionKeysEnv()` +
    `parseContributionKeyMap()`: the Host-injected `PIDESK_VIEW_CONTRIBUTION_KEYS`
    map is now readable, so `access-mode` extensions stop hand-rolling the parse.
    Soft `undefined` on every malformed input; never throws.
  - `openPanel` / `openSettingsView` / `openSidebar` complete the placement
    factories. `panel` and `settings` **require** a stable `panelId` (an omitted
    id falls back to `ext-<viewId>`, which drifts across reconnects); all three
    are soft (`null`, never throw) so callers keep their TUI path.
  - `panel` is the **right-hand** ContextSidebar tab and `sidebar` the **left**
    NavSidebar card — the naming is counter-intuitive and is now documented.
- **Partial updates (`patch`)** (protocol `view/v1`, docs/design/19 §10.3):
  - Envelope type `patch` + `ViewPatchPayload` / `ViewPatchOp` (path-based
    subtree replace; `path: []` replaces the root).
  - Host capability `view-patch` in `hello.capabilities`.
  - `session.patch(payload): boolean` — soft `false` when the Host is older,
    the view is closed, or `ops` is empty; callers fall back to `update()`.
  - Host applies all ops, re-sanitizes the full tree, then pushes a merged
    `update` to the renderer (patch exists only on the Client↔Host wire).
- **`table` ViewNode** (protocol `view/v1`, docs/design/19 §3.2.1):
  - Columns with labels, relative `width` weights and `align`; typed rows;
    `emptyText`; `maxRows` with a visible "显示 N / 共 M" footer.
  - Presentation only — no sorting/filtering/paging, and rows never enter
    `values`. Rows count one node each against `maxNodes`.
  - New Host capability `view-table`, advertised in `hello.capabilities`. Older
    Hosts render an `unknown` placeholder, so check the capability before
    emitting a table.
- **System notification sounds** (PiDesk docs/design/18):
  - Host capability `notification`; envelope types `notify` / `notified`.
  - `playNotification(client, options)` + `client.notify(payload)`; soft failure reasons: `unsupported` | `disabled` | `rejected` | `timeout` | `aborted` | `disconnected`.
  - Scenarios: `completed` | `failed` | `needsAttention` | `interrupted` | `custom`; optional built-in sound `"1"`–`"5"`.
- **Multi-process lifecycle gaps closed** (PiDesk docs/design/15):
  - Host rendezvous file (`PIDESK_VIEW_RENDEZVOUS`): `readEnv` prefers live endpoint/token after Host restart; `DesktopViewClient.refreshEnv()` + connect-failure retry.
  - In-process slot leases (`leaseKey`): `superviseAccessMode` defaults to `"access-mode"`; `closed(replaced)` → `displaced` (no thrash).
  - `acquireProcessViewClient` / `releaseProcessViewClient` refcount; `disposeProcessViewClient` is process-teardown only.
  - `client.setSessionId` + `supervisor.rebindSession` for in-process session switches; `closed(session)` holds as `displaced`.
  - `reprobeMs` (default 30s) revives `exhausted`/`unsupported`.
- **Registration slots are first-class**: `superviseSlot` / `superviseAccessMode`; `tryRegisterAccessMode` soft failure reasons.
- **Protocol types lockstep**: `src/types.ts` generated from `src/shared/view.ts` (`pnpm sync:view-types`).
