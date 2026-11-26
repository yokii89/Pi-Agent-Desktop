# Native managed skills

The Extensions page owns the desktop replacement for the archived `/skills` panel. It exposes installation, bundle updates, repair, removal, a read-only Doctor and the ownership manifest. The composer accepts `/skills`, `/skills browse`, `/skills manage`, `/skills doctor`, `/skills manifest`, and `/skills install|update|repair|uninstall [name]`. A write command with a name opens its file preview; without a name it opens the list for selection. Confirmation is always a separate user action. These local commands do not send a model turn.

## Contract and ownership

- `shared/managedSkills.ts` defines the IPC contract. Only the main window's top frame may call it. The renderer receives an opaque, single-use preview token, not authority to choose destination paths or submit a file list. Tokens expire after five minutes.
- `managedSkills.ts` owns the approved bundled catalog and operation plans. The only installable sources are the desktop-owned `plugin-creator` and `skill-creator` assets in `assets/skills`. They target the bundled Durable runtime and its preview v1 extension contract. It never loads the archived extension, starts the legacy Pi CLI, downloads skills, or executes bundled scripts.
- `settings/managedSkillsStore.ts` owns manifest validation and atomic persistence. Existing deployments keep `<agentDir>/skills/codex-managed/<name>` and `<agentDir>/codex-skills-manifest.json`, including `PI_CODING_AGENT_DIR` overrides. The old schema's Pi/Codex version fields are retained for compatibility; they are not native runtime requirements.
- Opening the manager, Doctor, manifest or an operation preview creates no files. Existing manifest ownership is read in place; it is never inferred from a directory's presence. Unmanaged directories are not adopted or overwritten.
- The bundle's declarative files are included explicitly by `electron-builder.yml`, so development and packaged apps use the same assets. No archived extension entrypoint is packaged through this rule.

## Operations

| Operation | Behavior |
| --- | --- |
| Install | Installs an approved bundled skill only when its target is absent and no same-scope command collision exists. |
| Update | Replaces an intact managed installation with the current bundled files, removing obsolete owned files. |
| Repair | Restores missing files or a missing installation when all remaining entries still match ownership. Modified files, extra entries and links block replacement. |
| Uninstall | Removes an intact installation and its ownership record, even when the old bundle is no longer available. A missing installation can also be removed from the manifest. Modified, extra or linked entries remain on disk and the record becomes `orphaned-user-modified`. |

Project skills may override a global managed skill. Doctor and previews report this as a warning. A same-scope collision blocks installation, update and repair. Removal remains available when an unrelated skill or bundled source is broken.

Plans include source hashes, installed hashes, ownership and the discovered command catalog. They are recomputed before execution and again after staging, so changed source files, user files, settings or name collisions invalidate the preview. Existing ancestor directories, targets and manifests are checked for links; file traversal never follows links in a managed tree. Relative paths, entry counts and file sizes are bounded.

Writes stage verified regular files beside the destination, journal the transaction in the manifest and move the previous directory to a backup. Failure before the final manifest commit restores the old directory and ownership. A failed rollback retains its backup and recovery marker. Doctor reports interrupted records and retained staging/backup directories; it never deletes them automatically.

## Runtime boundary

The native loader and Doctor share `shared/resourceDocument.ts` for metadata parsing. Native resource discovery remains authoritative for enabled paths and scope. `/skill:<name>` expansion and project instructions continue through the existing runtime loader.

Sessions intentionally keep their startup resource snapshot. A successful file operation refreshes the Extensions list and invalidates the contribution catalog; it does not interrupt tasks, dispose extension instances or claim a live reload succeeded. The UI tells users to close and reopen sessions that need the new resources. Newly installed entries keep `lastLoaderResult: pending`; discovery is displayed separately, without changing old loader-result fields during a read-only Doctor check.

## Validation

```text
pnpm exec vitest run --config src/main/vitest.config.ts src/main/extension/managedSkills.test.ts src/main/extension/managedSkillsIpc.test.ts src/main/extension/durableResources.test.ts src/main/agentRuntime/resources.test.ts src/shared/managedSkillCommand.test.ts
pnpm typecheck
pnpm run build
```

Tests use temporary agent and project directories. They cover real bundled assets and native command expansion, legacy ownership, repair, removed sources, modified files, empty extra directories, links, malformed manifests, expiring/replayed plans, edits during staging, manifest-write rollback, and IPC sender/confirmation boundaries. They never write to the user's global agent directory or send a model request.
