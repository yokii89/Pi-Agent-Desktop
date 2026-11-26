# Changelog

All notable changes to `@yoki/yoki-plan` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Access-mode chip descriptor comes from the manifest** — `PLAN_MODE` is now `defineAccessMode(pkg.pidesk.contributes.accessModes[0])` (`@pidesk/view-sdk` 0.5.1), replacing the hand-written `PLAN_MODE_REGISTRATION` object and the duplicated `PLAN_MODE_CONTRIBUTION_ID` constant. Impact: the Catalog entry the Host scans and the live chip registration read one source and cannot drift; the descriptor is frozen with `activation` dropped, and a manifest entry that loses `id`/`title` or switches `activation` away from `onAccessMode` now throws at extension load instead of registering a mismatched chip.
- **`@pidesk/view-sdk` is now `^0.5.1`** — the additive 0.5.1 release (access-mode contribution helper + public manifest subset); no wire, Host capability, or protocol change. Impact: `defineAccessMode` / `accessModeManifestEntry` resolve at install time instead of only in a local PiDesk checkout.
- **`@pidesk/view-sdk` is now `^0.5.2`** — behavior-only release: when the Host named in the rendezvous file cannot be reached, the client falls back to the endpoint baked into its spawn environment (PiDesk `docs/design/122`). Impact: the access-mode chip and plan panel keep working while a second PiDesk instance is open; no API or wire change, so nothing here was adapted.
- **Pi 1.4.0 minimum** — Peer and engine declarations now require Pi `1.4.0` and Node `22.19`. Impact: installs match the tested runtime.

### Added
- PiDesk composer mode-dropdown registration (`registerPlanModeOnDesktop`, `access-mode` slot): input-bar chip lists 计划模式, desktop clicks activate the real tool gates, and TUI toggles (`/plan`, Shift+Tab, session resume) sync the chip back via `PlanModeControllerHooks.onModeChange`. Soft-fallback to `/plan` on old hosts / terminal.
- `createPlanModeSupervisor` — thin wrapper over `@pidesk/view-sdk` `superviseAccessMode`.

### Changed
- `@pidesk/view-sdk` is now a published registry dependency (`^0.2.0`) instead of a workspace-local `file:` link. The desktop (PiDesk) path is imported statically at extension load, so `pi install npm:@yoki/yoki-plan` now resolves it; before this change a standalone install failed to load the extension at all.
- Desktop chip lifecycle moved into the SDK: `acquireProcessViewClient` + `superviseAccessMode` own re-registration, backoff, in-process lease, and `session_shutdown` release (no force-dispose of the shared pipe).
- `/model` dual-axis selector: thinking depth shown once as a bottom control strip; list rows no longer repeat depth or provider source badges.

### Removed
- Fuzzy search / typing filter from the dual-axis `/model` selector (list is navigated with ↑↓ only).
- Desktop (PiDesk) model+thinking selector view — PiDesk's input toolbar natively provides model and thinking controls; the dual-axis picker is TUI-only now.
- Post-plan desktop **modal** view — replaced by a compact **widget** docked above the input bar with four single-row action buttons.
- Hand-written desktop supervisor state machine in `index.ts` (replaced by SDK lifecycle).

### Added
- Plan/edit agent mode with `/plan` toggle, `--plan` flag, and session resume.
- Read-only tool gates in plan mode (`edit`/`write` disabled; bash allowlist + destructive block).
- `before_agent_start` plan-context injection and `context` cleanup on edit mode.
- Dual-axis `/model` selector (↑↓ model, ←→ thinking) via `ctx.ui.custom`.
- Soft bridge (`Symbol.for("@yoki/yoki-plan:bridge")`) for yoki-ui Shift+Tab and model UI interception.
- Post-plan TUI on `agent_settled` when assistant emits `Plan:` steps + `[PLAN READY]`.
- Four next-step options: execute same session, execute new session, keep exploring, save only.
- Plan artifact writer to `.pi/yoki/artifacts/plans/` (`source: yoki-plan`) via extension `fs` (not agent write tool).
- Fingerprint dedup (`lastPlanFingerprint` / `lastPlanPath`) persisted on session custom entry.
- `/plan save` force-archive of last assistant message without ready marker.
- `/plan new` fresh-session execute (command-ctx `newSession`); post-plan option 2 prefills this command when event ctx lacks session APIs.
