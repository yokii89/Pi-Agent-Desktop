---
name: skill-creator
description: Create and maintain declarative skills for PiDesk's bundled Durable loader, with valid frontmatter, scoped discovery, relative resources and focused validation.
---

# PiDesk Durable skill creator

1. Inspect the target workspace and its resource conventions. Prefer `.pi/skills/<name>/SKILL.md` for a project skill; `.agents/skills/<name>/SKILL.md` is also supported. Use a user-level directory only when explicitly requested. Do not run an external agent CLI or edit its authentication files.
2. Require YAML frontmatter with a lowercase hyphenated `name` and a concise `description` explaining when the skill applies. The Durable loader also supports `disable-model-invocation: true` for explicit-only use. It does not provide general YAML execution or arbitrary tool-permission metadata.
3. Keep the body procedural. Refer to actual tools exposed by the target PiDesk runtime or extension; do not assume terminal UI, RPC, subagents or unimplemented APIs exist. Use `references/`, `scripts/` and `assets/` only for resources that directly serve the workflow, and keep references relative to the skill directory.
4. Validate frontmatter, nonempty body, names, relative resources and file budgets with the checkout's native loader and tests. A skill document is at most 64 KiB; command descriptions are at most 1,024 characters and completion text is capped at 400. Use the stricter lowercase hyphenated naming convention even though the loader accepts additional forms.
5. Verify discovery in an isolated agent/project directory and assert `/skill:<name>` appears in the native command list. Explicit invocation expands the skill body with its base directory and user arguments. Automatic model discovery supplies metadata and paths, then the model reads the body when needed.
6. Check duplicate names within the same scope; these fail discovery. Project skills override matching user skills. Settings filters control enabled paths. Close and reopen a session to refresh its startup resource snapshot; no `/reload` command is promised.
7. For application-owned bundled skills, use PiDesk's `/skills` manager for preview, installation, update, repair and removal. Keep ownership hashes intact and preserve modified user files. Do not bypass its confirmation or write into global directories as part of generating a workspace skill.

Deliver the skill and validate only its relevant resources. No marketplace metadata, hidden deployment directories or coding-agent extension entrypoint is required for a declarative skill.
