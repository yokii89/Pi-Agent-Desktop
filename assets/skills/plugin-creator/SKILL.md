---
name: plugin-creator
description: Create and adapt native PiDesk extensions for the bundled pi-durable runtime, including tools, commands, desktop Views and explicit host lifetimes. Use when extending PiDesk; read the bundled runtime contract before implementation.
---

# PiDesk Durable extension creator

1. Inspect the target PiDesk version and its extension contract. Read [the native contract](references/durable-extension.md); in a PiDesk checkout also inspect `src/shared/durableExtension.ts` and the nearest tested native extension. The current contract is preview v1 with `@earendil-works/pi-durable@1.6.0`.
2. State the extension's capabilities, user/project scope and lifetime. Session hosts may provide agents, commands and Views. App/settings hosts are user-scoped View hosts and must not provide agent definitions or commands. Project packages may only declare session hosts.
3. Create a package in the selected workspace with `pidesk.runtime` metadata and a compiled ESM `.js` or `.mjs` entry. Export a factory receiving the PiDesk host context. Do not use the retired coding-agent ExtensionAPI, CLI flags, RPC, terminal UI or environment-based session/View identity.
4. Return only `agent`, `commands` and optional `dispose`. Keep mutable state inside the factory. Name the agent after the manifest id, tools/tasks `<id>__<name>` and commands `<id>:<name>`. Keep prompt expansion pure; put recoverable side effects in Durable tools/tasks. Host `execute` commands may handle desktop UI without a model turn; do not promise persistent exactly-once side effects across restarts.
5. For Views, declare `views` and use only the instance's `context.views` client and `context.contributions` keys. Never call environment discovery, copy credentials into files or expose them to renderer code. Dispose extension-owned resources and honor `context.signal`; the host disposes its View client.
6. Bundle required output and runtime dependencies. The package manager skips install scripts, so do not depend on a postinstall build. Use pnpm, TypeScript strict and the repository's existing checks.
7. Verify manifest validation, capability rejection, independent instances, command retries, recovery and cleanup with focused tests. For View changes, verify the actual desktop and packaged ASAR path. Enabling, updating or disabling resources takes effect after sessions close and reopen; do not claim `/reload` or an unpublished SDK is available.

Put skills in `skills/<name>/SKILL.md` and prompt templates in `prompts/`; these are declarative resources. Register the package through PiDesk's Extensions page. Keep all implementation writes in the chosen workspace unless a separate location is explicitly authorized.
