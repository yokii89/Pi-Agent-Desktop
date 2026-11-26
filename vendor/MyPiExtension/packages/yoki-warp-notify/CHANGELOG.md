# Changelog

## Unreleased

### Changed

- **Pi 1.4.0 minimum** — Peer and engine declarations now require Pi `1.4.0` and Node `22.19`; removed the unsupported `ambientObserver` manifest field. Impact: installs match the tested runtime and no longer carry dead metadata.

### Fixed

- **Pi 1.2+ custom runs** — `before_agent_start` now reads extension-triggered custom message text instead of treating those runs as empty prompts. Impact: Warp prompt-submit notifications show the actual trigger text when another extension starts a turn.

## 1.21.0

### Added

- **`/warp-notify` diagnostic command** — a status report showing what the
  extension detected (terminal, Warp build, protocol negotiation, heartbeat,
  blocking tools, config path) with a concrete next-step hint whenever
  notifications are not active. Registers in every terminal, so it works
  even where notifications can't.
- **Live on/off switch** — `/warp-notify on|off` persists `enabled` to the
  config file and takes effect immediately, without restarting the session.
- **Startup notice** — when Warp is detected but structured notifications
  are unavailable (build too old, or a known-broken build), a one-time
  notice at session start explains why and points at `/warp-notify`.
- `enabled` config key (default `true`) as the master switch.
- `README.md` — install, requirements, event mapping, configuration,
  troubleshooting.

### Changed

- Extracted the workflow-question transport from `index.ts` into
  `workflow-transport.ts`; the extension entry is now lifecycle-only. The
  bridge in yoki-core should import `createWorkflowQuestionTransport` from
  the new module (the package root still re-exports it via `index.ts`).

## 1.20.0

Initial tracked release: OSC 777 structured notifications for Warp
(`session_start`, `prompt_submit`, `stop`, `question_asked`, `tool_complete`,
`idle_prompt`), tab-title activity spinner, workflow-question transport,
protocol-version negotiation with per-channel broken-build gating, and
`blockingTools` / `heartbeatMs` configuration.
