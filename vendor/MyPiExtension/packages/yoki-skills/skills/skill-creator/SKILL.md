---
name: skill-creator
description: Create or update concise Pi agent skills with valid YAML frontmatter, safe resource paths, and focused validation. Use when a user asks to add or adapt a Pi skill, its bundled scripts, references, or assets.
---

# Pi skill creator

Create skills for Pi's loader, not Codex's skill system.

1. Put project skills in `.pi/skills/<name>/` unless the user explicitly requests a global install. A global skill belongs under `~/.pi/agent/skills/<name>/`; never use a hidden `.system` deployment directory.
2. Require `SKILL.md` with a lowercase hyphenated `name` and a clear `description`. Keep the body procedural and concise; use `references/`, `scripts/`, and `assets/` only when they directly support the workflow.
3. Refer only to Pi tools or tools the package explicitly provides. State capability requirements instead of assuming Codex helpers, subagents, plugins, or `$CODEX_HOME`.
4. Do not copy a skill into Pi's global directory unless the user explicitly requests that write. For managed package assets, use this package's `/skills install` flow.
5. Validate frontmatter and relative resources before installation. `scripts/quick_validate.py` is retained source material; inspect it before using it and do not rely on its Codex metadata generation behavior.
6. Test a new skill in a clean Pi agent directory and verify Pi exposes `/skill:<name>` after reload.

Keep frontmatter descriptions specific enough for Pi's implicit skill metadata, and use `disable-model-invocation: true` only when explicit `/skill:` invocation is required.
