---
name: plugin-creator
description: Design and scaffold Pi coding-agent extensions and package-local skills when a user asks to extend Pi with commands, tools, autocomplete, panels, or managed assets. Use for Pi extension package structure, manifests, and validation; do not use it to create Codex plugins.
---

# Pi extension creator

Create Pi-native extension packages rather than Codex plugins.

1. Start from a package with `package.json`, a `pi.extensions` entry, and an extension TypeScript entrypoint. Keep skills under `skills/<name>/SKILL.md`.
2. Use Pi's `ExtensionAPI`, Pi commands, and Pi TUI contracts. Do not create `.codex-plugin`, Codex marketplace metadata, Codex deep links, or Codex cachebuster files.
3. Keep all package writes within the user-selected workspace. Ask before replacing existing files or modifying a global Pi configuration.
4. Validate the package with its TypeScript and focused test commands. Confirm installed resources through Pi's actual command list after reload.
5. Treat the retained `scripts/` and `references/` as Codex-plugin source material only. Do not run their Codex marketplace or plugin scaffolding workflows for Pi work.

Prefer a small, auditable package and document its Pi version requirement and resource boundaries.
