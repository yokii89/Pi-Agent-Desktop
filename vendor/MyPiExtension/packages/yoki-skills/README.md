# pi-codex-skills

Pi extension that installs only Pi-adapted, bundled skills into `~/.pi/agent/skills/codex-managed/<skill>/` and lets Pi execute them through its native `/skill:<name>` command.

Minimum Pi version: `1.4.0`, which provides `pi.getCommands()` and `ctx.ui.custom()`. The extension is tested against Pi `1.4.0`; the compatibility research baseline is Codex CLI `0.144.5`.

## Boundaries

- Pi-managed is the default and only write-capable mode. Its manifest is `~/.pi/agent/codex-skills-manifest.json`.
- A Codex source bridge is read-only and disabled by default. This package never copies or updates `~/.codex/skills`, `~/.agents/skills`, or a Codex `.system` cache.
- `codex-managed` is a deployment folder, not a Pi system scope. No managed skill is installed below a hidden `.system` directory.
- Two Pi-adapted base assets are installable by default: `plugin-creator` and `skill-creator`.

The read-only audit records the Pi adaptation boundary for every bundled asset. It does not copy or execute a local Codex cache, and retained Codex-only helper scripts are not Pi runtime dependencies.

## Commands

- `/skills` opens the read-only Browse / Manage / Doctor panel.
- `/skills install`, `/skills update`, `/skills repair`, and `/skills uninstall` show a plan and require confirmation before writing files.

After any successful write the extension asks Pi to reload. The command list after reload is the final acceptance source; Pi natively expands the selected `/skill:<name>` command. If reload fails, the managed manifest records `reload-failed` and the extension tells the user to restart Pi before running `/skills doctor`.

## Migration and bridge policy

| Existing location | Pi-managed behavior | Bridge behavior |
| --- | --- | --- |
| `~/.codex/skills` | Not copied or updated. | No default bridge. Audit manually before adding an explicit Pi skill path. |
| `~/.codex/skills/.system` | Never used as a managed destination or copied at runtime. The package ships an adapted source snapshot instead. | Read-only only if the user explicitly configures it in Pi settings after audit; this extension does not write that setting. |
| `~/.agents/skills` | Left to Pi's normal loader. | Not managed or overwritten. |

Pi does not provide Codex system scope or same-name multi-candidate selection. `/skill:` remains the native executable syntax; the `/skills` panel browses loaded commands and prefills that syntax without altering the skill body or the user's input.

## Development

```bash
npm ci
npm run check:yoki-skills
npm run test:yoki-skills
npm run smoke:yoki-skills
# Pi loads this extension from the root manifest.
pi -e .
```

`test:pi-smoke` starts the installed Pi CLI in RPC mode (`--mode rpc --offline`). It installs every bundled base skill into an isolated `PI_CODING_AGENT_DIR`, then asserts `get_commands` exposes `/skills` and every `/skill:<name>` from the managed user tree. On Windows it invokes `cli.js` with `node` (not `pi.cmd`) because piped stdin hangs with the `.cmd` wrapper. Override the CLI path with `PI_CLI_PATH` if needed. It never sends a model request or reads a Codex skill directory.
