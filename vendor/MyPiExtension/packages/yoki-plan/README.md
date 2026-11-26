# @yoki/yoki-plan

Plan / edit agent mode for Pi (Codex-style read-only exploration).

| Mode | Purpose | File mutation |
|------|---------|---------------|
| **plan** | Explore codebase, ask questions, produce a plan | **Forbidden** |
| **edit** | Normal agent work | Allowed |

## Features

- **`/plan`** — toggle plan ↔ edit (`/plan on`, `/plan off`, `/plan save` also work)
- **`--plan`** — start the session in plan mode
- **Tool gates** — `edit` / `write` disabled; bash limited to a read-only allowlist
- **Session resume** — last mode restored from a custom session entry
- **Post-plan TUI** — when the agent emits `Plan:` steps + `[PLAN READY]`, a four-option select runs on `agent_settled`
- **Desktop post-plan UI** — under PiDesk (`PIDESK_VIEW_*` / `PI_VIEW_*`), the post-plan picker opens as a **widget above the input bar** via `@pidesk/view-sdk` (single row of four action buttons). Falls back to TUI select when no desktop host.
- **Desktop mode chip** — registers plan mode into PiDesk's composer access-mode dropdown: the input-bar chip lists「计划模式」, clicking it activates the real tool gates, and TUI toggles (Shift+Tab / `/plan`) sync the chip back. Resident lifecycle (re-register on pipe drop / host restart, bounded backoff, shutdown stop) is **built into `@pidesk/view-sdk`** (`superviseAccessMode` + `getProcessViewClient`). Soft-fallback to `/plan` on old PiDesk hosts or plain terminal. The chip's `title` / `description` / `icon` / `accent` are declared once — in `package.json` `pidesk.contributes.accessModes[]`, which the code reads back through `defineAccessMode()`, so to rename the chip edit only the manifest.
- **Dual-axis `/model` (TUI only)** — ↑↓ select model (id only), ←→ cycle thinking once in a bottom strip, Enter applies both. On desktop, use PiDesk's native model/thinking controls in the input toolbar instead.
- **yoki-ui bridge** — when both packages are loaded:
  - **Shift+Tab** toggles plan/edit (replaces thinking-level cycle)
  - **`/model`** and **Ctrl+L** open the dual-axis selector

Without yoki-ui, `/plan` and tool gates still work; Shift+Tab keeps Pi’s default thinking cycle.

## Ready marker contract

In plan mode the agent must finish with:

```text
Plan:
1. First step
2. Second step
…

[PLAN READY]
```

Both **parseable steps** and the **explicit ready marker** are required before the post-plan TUI appears. Identical step fingerprints do not re-prompt until the plan changes.

## Post-plan next steps

| # | Option | Writes artifact | Mode after |
|---|--------|-----------------|------------|
| 1 | Execute now (same session) | yes → `.pi/yoki/artifacts/plans/` | **edit** + execute turn |
| 2 | Execute in a new session | yes | writes plan, prefills `/plan new` (Pi only exposes `newSession` on command ctx). Press Enter → real fresh session + kickoff |
| 3 | Keep exploring in plan mode | no | **plan** (fingerprint remembered) |
| 4 | Save plan only (no execute) | yes | **plan** |
| Esc | same as 3 | no | **plan** |

Artifacts use frontmatter `source: yoki-plan` so they coexist with `/skill:plan` implement-ready plans in the same directory.

| Source | Role |
|--------|------|
| `source: yoki-plan` | Exploration plan from plan mode |
| `/skill:plan` / blueprint | Implement-ready phased contract |

Options 1–2 use built-in execute injection, not `/skill:implement` by default.

### `/plan` subcommands

| Command | Effect |
|---------|--------|
| `/plan` / `/plan on` / `/plan off` | Toggle or set mode |
| `/plan save` | Force-archive last assistant message (no ready marker required) |
| `/plan new` | Open a **new session** and execute the last saved / pending plan (uses command-ctx `newSession`) |

Post-plan option 2 cannot call `newSession` from `agent_settled` (Pi would deadlock). It writes the plan, stashes kickoff data, and prefills `/plan new` so Enter runs the real handoff.

## Keybindings (with yoki-ui)

| Key | Action |
|-----|--------|
| Shift+Tab | Toggle plan / edit |
| `/model` or Ctrl+L | Model (↑↓) + thinking (←→) — TUI only; use PiDesk toolbar on desktop |
| Thinking level | Use ←→ inside `/model` (no longer Shift+Tab) |

## Status chip

While in **plan** mode, the statusline shows a warning-colored `plan` chip (via `setStatus`). Cleared in edit mode.

## Install

Bundled with the Yoki mono package. For local workspace development:

```bash
npm ci --ignore-scripts
pi -e .
```

Root `package.json` registers:

```json
"./packages/yoki-plan/index.ts"
```

## Acceptance

1. Shift+Tab toggles plan ↔ edit and updates the status chip (yoki-ui loaded).
2. In plan, `edit`/`write` inactive; non-allowlisted bash blocked with a clear reason.
3. In edit, full tools restore.
4. Assistant ends with `Plan:` steps + `[PLAN READY]` → four-option TUI once.
5. Missing ready or steps → no TUI.
6. Option 1: plan file exists; mode is edit; write tools active; agent starts execute turn.
7. Option 3: no new file; still plan mode; same plan does not re-popup.
8. Option 4: file under `.pi/yoki/artifacts/plans/` with `source: yoki-plan`; still plan mode.
9. Option 2: when `newSession` is available, new session kickoff references the saved plan path.
10. `/model` (and Ctrl+L) open dual-axis picker.
11. Session resume restores last mode (+ last plan fingerprint/path).

## Optional later

- `[DONE:n]` progress widget + `/todos` (Slice C)
- Hand-off to `/skill:implement` when frontmatter is rich enough (Slice D)

## Development

```bash
npm test -- packages/yoki-plan
npm run check
```
