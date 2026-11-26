# Roadmap

Keeping an experienced driver in the loop while the work moves at LLM speed. No dates, no version targets — items move down the list as they ship.

## What's Done

- yoki-pi skill pipeline — ~20 contract-carrying skills (`discover` → `research`/`design`/`blueprint` → `plan` → `implement` → `validate` → `code-review` → `commit`)
- 15 named subagents for parallel analysis under fresh context
- 3 built-in `/wf` pipelines — `build`, `vet`, `polish`
- Per-skill / per-stage model + effort control (`/yoki-models`, `models.json`)
- yoki-workflow engine — declarative multi-stage skill pipelines with JSONL audit / predicate routing (`/wf`)
- Unified loop driver — `fanout` / `iterate` / `assess`
- True parallel fan-out — units run as simultaneous Pi child sessions (in-process, via the Pi SDK) with a live lane console: step into any lane, watch its output, answer its questions without halting the others
- First-class judges + per-stage `verify`
- `panel()` — N judges + vote fold (adversarial verification), with `match()` enum-gate disagreement routing
- Session-backed, mid-loop resume
- Skill-contract architecture (load-time + runtime schema checks)
- Sibling family shipping in this repo — `plan`, `ask-user-question`, `web-tools`, `warp-notify`, `image-gen`, `config`, `ui`, `skills`, the `newapi` provider and the `telegram` bridge

## What's Next

- First-class fan-in / synthesize affordance
- Automatic flow generation via agent
- Headless Pi / out-of-process execution
- Verification under affordable models (fresh-context isolation + frontier escalation)
- Delegation strategy optimization

## What's Possible

- Telemetry public release
- Non-Pi host embedding
- Ecosystem / extensibility (third-party skill contracts, user workflow packs)
- Tournament bracket ranking
- Worktree isolation — parallelize shared-tree stages (`implement`) safely
