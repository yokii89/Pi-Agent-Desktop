# @yoki/pi-bash-jobs

Bash for pi, with a third state: **background job**.

Pi's bash has two outcomes — *block until exit* or *killed by timeout*. A dev server, a 15-hour
download, or `ffmpeg` is neither. This extension replaces the `bash` tool so a call can **yield**:
the process keeps running, the model gets a job id, and two extra tools follow or end it. Killing
only ever happens on two explicit paths: a `timeout` you passed, or somebody asking for it.

```
bash({command, mode?, timeout?, label?})
  ├─ mode=finish (default)  → block for the exit code
  │    ├─ exits                      → normal result
  │    ├─ explicit timeout expires   → kill the tree, fail the call  (only kill path)
  │    ├─ silent ≥ idle-policy       → yield to background (warn first; never kills)
  │    └─ ran past soft budget       → yield to background (never kills)
  ├─ mode=detach  → return immediately      (dev servers, watchers; never auto-killed)
  └─ mode=long    → block through the grace window, then wake the model on exit
                       ├─ exits inside the window → ordinary result, no job, no wake
                       └─ still running after it  → background job, woken on exit
```

## Tools

| Tool | What it does |
|---|---|
| `bash` | pi's bash with `mode` / `label`. Blocking calls move to the background instead of being killed; nothing is ever killed implicitly. |
| `tool_execution_inspect_output` | Read-only: list jobs, read a job's tail, `cursor` for only new lines, `grep` to find progress/ERROR, `waitMs` to wait inside one call (up to 2 min) instead of burning a turn per look. |
| `bash_job_stop` | Stop a job: kills the whole **process tree** (not just the shell). `signal: "graceful"` asks first on Unix; Windows always tree-kills. |

`bash_job_stop` exists because a bare `taskkill /PID` from bash cannot tell a reused pid from the
real process — a failure mode PiDesk already paid for once.

## Install

```bash
pi install npm:@yoki/pi-bash-jobs
# or, from this repo
pi -e ./packages/pi-bash-jobs/index.ts
```

PiDesk / any host: no host-side change is needed. Output still streams through pi's
`tool_execution_update`, and wakes arrive as a `customType: "bash-job"` message.

## Why it replaces the tool instead of adding one

A separate `bash_bg` tool is zero-conflict but depends on the model remembering to use it — and
the failure mode of forgetting is exactly the bug this fixes: one command that never returns
occupies the turn forever. Registering under the name `bash` overrides the built-in definition
(pi resolves extension tools after built-ins by name). If the override ever gets in the way, set
`"replaceBuiltinBash": false` to leave stock bash alone and keep the two job tools registered.

## Settings

`~/.pi/agent/bash-jobs.json` (optional; a missing or broken file means defaults):

| Key | Default | Meaning |
|---|---|---|
| `replaceBuiltinBash` | `true` | Escape valve: `false` leaves pi's bash untouched. |
| `finishSoftBudgetSec` | `600` | How long a blocking call may hold the turn before yielding. |
| `longGraceSec` | `180` | How long `mode:"long"` still blocks before it really becomes a background job. `0` restores “return immediately”. |
| `idleWarnSec` | `300` | Silence that triggers one notice (no interruption). |
| `idleDetachSec` | `420` | Silence that triggers a yield. This is the hung-pipe path. |
| `explicitTimeoutKills` | `true` | Whether a caller-supplied `timeout` still kills. `false` makes it yield too. |
| `wakeOnExit` | `"followUp"` | `followUp` / `steer` / `off`. `followUp` never interrupts a reply in progress. |
| `keepOnSessionEnd` | `true` | Keep job processes alive when pi exits ("don't close the project I started"). |
| `orphanTtlHours` | `24` | How long a restored orphan stays visible. |
| `wakeCoalesceMs` | `5000` | Wake coalescing window (shared with event watches). |
| `maxWakePerHour` | `24` | Hourly wake ceiling; notices are held, never dropped. |
| `inspectTailLines` / `inspectMaxTailLines` | `80` / `1000` | Default and hard cap for `tailLines`. |
| `inspectWaitMaxMs` | `120000` | Hard cap for `waitMs`. |
| `resultMaxBytes` / `resultMaxLines` | `51200` / `2000` | What the model reads from one call — the same caps pi's own bash uses. The ring keeps more; when this trims, the complete output is written to a temp file and its path is returned. |
| `extraDetachPatterns` / `extraLongPatterns` | `[]` | Extra regexes matched against the command's executable body. A pattern that does not compile is dropped rather than failing every bash call. |
| `output.maxBytes` / `output.maxLines` | `262144` / `4000` | Per-job output ring. |
| `output.tee` / `output.teeMaxBytes` | `true` / `8388608` | Tee committed lines (ANSI-stripped) to `~/.pi/agent/bash-jobs/logs/<sessionId>/<jobId>.log` so the desktop host can follow a job's stdout. Past the per-file cap the tee stops and marks the truncation; the ring is unaffected. |

## Classification

`mode` / `timeout` arguments win. Otherwise the command's **executable body** is matched after
stripping `cd x &&`, `FOO=1`, `sudo`, `env`, `npx`/`pnpm dlx` (including the launcher's own `--flags`)
and absolute Windows paths; a pinned version (`serve@14`) is the same program as `serve`.

- `detach`: `vite`, `next dev`, `npm/pnpm/yarn/bun dev`, `nodemon`, `tsc -w`, `webpack`,
  `python -m http.server`, `uvicorn`, `flask run`, `docker compose up` (not `-d`), `tail -f`,
  `watch`, `ngrok`, `serve`, `hugo server`, `astro|ng|remix|nuxt|expo|storybook dev`.
- `long`: `curl -o/-O`, `wget`, `git clone`, `docker pull|build|push`, installs
  (`npm i`, `pnpm install`, `pip install`), `ffmpeg`, `yt-dlp`, `rsync`, `robocopy`, `certbot`, `make`.
- everything else: `finish`.

A wrong guess is only ever expensive in one direction, and the design refuses that direction:
`node download.js` classifies as `finish`, so after the soft budget it **yields** — the download
keeps running and the model can keep inspecting it. Nothing is killed for being misclassified.

## Why `long` has a grace window

`long` used to return immediately. That is right for a 15-hour download and wrong for everything
the classifier or the model guesses long: `pnpm install` on a warm cache, a `pnpm build` that takes
40 seconds, a `git clone` of a small repo. Each of those filed a job, and every finished job wakes
the model with a `bash-job` notice — so a normal working session accumulated a stack of
“Bash job J-7 finished after 20s” cards for commands that had already returned their output.

So `long` now blocks through `longGraceSec` (default 180s) first. A command that exits inside the
window is an ordinary blocking call: same result, no job receipt, no wake, no background badge in
the UI. Only the part that outlives the window becomes a background job. `detach` deliberately
skips the window — a dev server is *expected* to keep running, and blocking on it is the exact
failure this extension removes.

## Behaviour worth knowing

- **`timeout` is the only implicit kill.** It applies to blocking calls only; passing it together
  with `mode:"detach"` is ignored and the receipt says so.
- **A `long` call that ends quickly is not a job.** Inside `longGraceSec` it behaves exactly like
  `finish`; only the part that outlives the window becomes a background job and wakes the model.
- **What the model reads is capped separately from what the job keeps.** The ring holds
  `output.maxBytes`/`maxLines` per job; the text handed back is capped at
  `resultMaxBytes`/`resultMaxLines` (pi's own bash caps) and the complete output is written to a temp
  file whose path comes back in the result — so a chatty command cannot spend the context window, and
  the trimmed part is still reachable. A partial line with no newline is bounded by the same cap and
  stays visible (`Password:`); a `\r\n` split across two pipe reads is still one break, not a blank line.
  Silence is measured in bytes rather than committed lines, so a progress line without a newline is
  activity, not a hung pipe.
- **A stop is reported as a stop.** If `bash_job_stop` (or a session shutdown) ends a call that was
  still blocking, the result says `Command stopped (killed by …)`, not the shell's incidental exit
  code — the structured `status` and the text agree.
- **Wakes are coalesced** into one message per window, deduplicated, and rate-limited. A blocking
  call that already returned its result never wakes the model — that would be the same news twice.
  The rate-limit retry timer is unref'd, so a held notice cannot keep a host process alive.
- **Orphans are read-only.** After a restart (or a pi crash) a job appears as `orphaned`: output is
  there, the exit code is not. We will not pretend to be waiting for it. With
  `keepOnSessionEnd: false` the kill happens *before* the snapshot, so the next run sees `killed`
  instead of an orphan it can never observe.
- **Windows graceful stop is a tree kill.** Windows has no SIGTERM for a process tree; the receipt
  says what actually happened instead of claiming a graceful shutdown.

## Coexistence

| Package | Relationship |
|---|---|
| `@piotr-oles/pi-bash-timeout`, `pi-bash-timeout` | Superseded: a fixed default timeout kills dev servers and 15-hour downloads. |
| `@spinejit/pi-timeout-policy` | Conflict: it also rewrites bash's schema and injects its own timeout. Pick one. |
| `pi-hang-guard` | Coexists (read-only), but its `setStatus` is dropped by PiDesk; this extension removes the need for it. |
| `pi-background`, `pi-bg-tasks` | Same idea, opposite default: they wait for the model to opt in; this one also covers the case where it forgets. |

## Tests

```bash
npx vitest run packages/pi-bash-jobs
```

The state machine, classification, ring buffer, persistence, wake queue and tool wiring are all
tested without spawning a model. `test/platform.test.ts` exercises the real spawn/exit/kill path.
