# yoki-warp-notify

Native [Warp](https://www.warp.dev/) terminal notifications for [Pi Agent](https://github.com/badlogic/pi-mono). When the agent finishes a response, asks you a question, or hits an error, Warp's tab shows a **badge + toast** — so you can keep working in another tab and still come back at exactly the right moment. While the agent runs, the tab title animates an **activity spinner**.

Zero setup: install, restart Pi inside Warp, done. Nothing to configure, nothing to look at — it only speaks when the terminal can hear it.

## What you get

| Moment | What Warp shows |
| --- | --- |
| Agent starts working | Tab title animates (moving-dots spinner), badge resets |
| Agent finishes (`stop`) | Toast with the last prompt + a summary of the response; badge clears |
| Agent asks you something (`ask_user_question`) | "Blocked" badge + toast — you're needed |
| Blocking tool completes | Badge clears automatically (including after an ESC/abort) |
| Agent idles for a moment (`idle_prompt`) | Toast with a summary of the final answer |

## Install

```bash
pi install git:github.com/yokii89/MyPiExtension
```

Then restart your Pi session **from inside Warp**.

## Requirements

- **Warp** as the terminal — notifications are emitted over [OSC 777](https://github.com/warpdotdev/warp), which only Warp interprets. In any other terminal the extension stays completely inert (no escape sequences, no output).
- A **Warp build that supports CLI agents**. Warp advertises this via `WARP_CLI_AGENT_PROTOCOL_VERSION`; if your build is too old, or is a known-broken build, notifications are gated off (see [Troubleshooting](#troubleshooting)).

## The `/warp-notify` command

One command answers every "is this thing on?" question:

```text
/warp-notify          show a status report
/warp-notify on       enable notifications (live, persisted to config)
/warp-notify off      disable notifications (live, persisted to config)
```

The status report shows what the extension detected and — whenever notifications are not active — a concrete next step:

```text
yoki-warp-notify status
  notifications : OFF — known-broken Warp build v0.2026.01.01.00.00.stable_01 (stable)
  next step     : Update Warp — notifications are gated off at or below 2026.3.25.8.24.5.5.
  terminal      : Warp
  warp build    : v0.2026.01.01.00.00.stable_01 (stable)
  protocol      : WARP_CLI_AGENT_PROTOCOL_VERSION=1 → v1
  heartbeat     : 15000 ms
  blocking tools: ask_user_question
  config        : ~/.config/yoki-warp-notify/config.json
```

If Warp is detected but notifications can't run (old/broken build), the extension also surfaces a one-time notice at session start pointing here — you should never be left wondering why "nothing happened".

## Configuration

Config file: `~/.config/yoki-warp-notify/config.json` (created on demand by `/warp-notify on|off`).

```jsonc
{
	// master switch — false silences every emission without uninstalling
	// (read live, so /warp-notify on|off takes effect immediately)
	"enabled": true,

	// tools that put Warp into the "Blocked" (question) state while running.
	// Default: ["ask_user_question"]. Set to [] to disable the question badge.
	"blockingTools": ["ask_user_question"],

	// how often (ms) the running-state heartbeat re-announces the agent while
	// it works — keeps Warp's badge from going stale on long turns.
	// 0 disables the heartbeat. Default: 15000
	"heartbeatMs": 15000
}
```

## How it works

The extension maps Pi's lifecycle events to Warp's structured cli-agent protocol (OSC 777 payloads written to the controlling terminal; on Windows via `process.stdout` + ConPTY):

| Pi event | Warp event |
| --- | --- |
| `session_start` (startup) | `session_start` |
| `agent_start` | `session_start` (defensive re-announce) + `prompt_submit` |
| `tool_call` (blocking tool) | `question_asked` — Warp shows the Blocked badge |
| `tool_execution_end` (blocking tool) | `tool_complete` — badge clears |
| `agent_end` | `stop` (with last prompt + response summary), then `idle_prompt` after 300 ms |

While the agent runs, the tab title is rewritten every 160 ms (OSC 0) to animate Warp's per-tab activity dots — the same mechanism Claude Code uses. The original title (`π - <repo>`) is snapshotted with the xterm title-stack (`CSI 22;0t` / `CSI 23;0t`) and restored verbatim when the animation stops.

Response summaries are truncated to 200 chars, and `<skill name="…">` wrappers are collapsed back to the `/skill:<name> <args>` shorthand the user actually typed.

## Package layout

```
index.ts               extension entry — lifecycle wiring, /warp-notify command, startup notice
config.ts              user config (enabled / blockingTools / heartbeatMs) + live on/off
status.ts              diagnostics: readStatus() + formatStatus() for the status report
protocol.ts            Warp detection + structured-protocol version negotiation + broken-build gate
payload.ts             pure payload builders (Pi branch → OSC 777 JSON)
workflow-transport.ts  run-keyed emitter for the yoki-core workflow-question bridge
title-spinner.ts       OSC 0 tab-title spinner (title push/pop preservation)
warp-notify.ts         OSC/CSI transport (/dev/tty on Unix, stdout+ConPTY on Windows)
```

## Troubleshooting

**Nothing happens.** Run `/warp-notify`. The usual causes, in order:

1. **You're not in Warp.** The report says `not Warp (TERM_PROGRAM=…)`. Notifications only work inside Warp.
2. **Your Warp build is too old.** `WARP_CLI_AGENT_PROTOCOL_VERSION` is unset — Warp never advertised the CLI-agent protocol. Update Warp and restart Pi.
3. **Known-broken Warp build.** Some builds advertise the protocol but render notifications behind an unlaunched feature flag; the extension gates them off until you upgrade. Update Warp.
4. **Disabled by config.** `enabled: false` in the config file — run `/warp-notify on`.

**Badge stays "Blocked" after you press ESC.** Handled: any blocking tool left unanswered is drained at the end of the agent loop, which clears the stale badge.

**Toast text leaks internals.** Skill wrappers are collapsed to `/skill:<name>` shorthand automatically; if you spot raw XML in a toast, please [open an issue](https://github.com/yokii89/MyPiExtension/issues).

## License

MIT
