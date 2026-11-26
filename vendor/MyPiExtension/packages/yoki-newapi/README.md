# pi-provider-newapi

New API / One API compatible proxy provider for [pi](https://github.com/earendil-works/pi-mono).

Single provider: **`newapi`**. Login supports **Manual** or **Import from Codex**.

Unlike `pi-provider-litellm`, this extension only uses OpenAI-compatible routes:

- `GET /v1/models` for discovery
- chat/completions via pi `openai-completions` or Responses via `openai-responses` against `{baseUrl}/v1`

It never calls LiteLLM-only endpoints such as `/model/info` (those often 301 to an HTML UI and break login with `Unexpected token '<'`).

## Install

This extension is bundled with the Yoki Git package. For local workspace development, run commands from the monorepo root:

```bash
npm ci
npm run check:yoki-newapi
npm run test:yoki-newapi
```

```bash
pi install git:github.com/yokii89/MyPiExtension
```

Or, when developing this extension in isolation, add its workspace path to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "./packages/yoki-newapi"
  ]
}
```

Optional: remove the LiteLLM package if you no longer need it:

```bash
pi remove npm:pi-provider-litellm
```

## Login

```
/newapi login
```

The first dialog is directly **New API login method** — **Manual** or
**Import from Codex** — with no intermediate "Select authentication method"
step (the extension drives the runtime's auth storage itself). Cancelling the
method select aborts the login.

`/login newapi` also goes straight to the same flow once a credential is
stored: the provider then registers OAuth-only, so pi has exactly one login
method and skips its "Select authentication method" step. Before the first
login (env-only setup), pi may show that selector — use `/newapi login` to
skip it.

### Manual

1. Base URL: API host only, e.g. `https://api.rtoc.cc` (not a UI host)
2. API key: `sk-...`
3. API type: `openai-completions` (default/chat) or `openai-responses` (keeps previous value on re-login if you cancel the select)

Credentials are stored in `~/.pi/agent/auth.json` under `newapi` (`access`, `baseUrl`, `api`).
Models are cached in `~/.pi/agent/newapi-models.json`.

### Import from Codex

Reads local Codex / CC Switch files:

| Source | Path | Field |
|--------|------|--------|
| API key | `~/.codex/auth.json` | `OPENAI_API_KEY` (also `tokens.access_token`, etc.) |
| Base URL | `~/.codex/config.toml` | `[model_providers.<model_provider>].base_url` |
| Wire API | same | `wire_api` |
| Model | same (top-level) | `model` |
| Thinking | same (top-level) | `model_reasoning_effort` |

`wire_api` mapping:

| Codex `wire_api` | pi `api` |
|------------------|----------|
| `responses` | `openai-responses` |
| `chat` / `completions` / absent | `openai-completions` |
| anything else | error (login fails) |

Base URL is normalized (trailing `/` and `/v1` stripped). Discovery always uses `GET {base}/v1/models`.

The import **overwrites** the `newapi` oauth credential completely. If Codex has a `model`, it is force-selected as `newapi/<model>` (session + `settings.json` defaults) on the next `session_start`, including a stub registration when the id is missing from `/v1/models`. `model_reasoning_effort` maps to pi thinking (`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) when the model supports reasoning.

After CC Switch changes accounts/providers, re-run `/newapi login` → **Import from Codex**.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `NEWAPI_BASE_URL` | Proxy root without `/v1` (when no saved login) |
| `NEWAPI_API_KEY` | API key when no saved login |

## Commands

| Command | Description |
|---------|-------------|
| `/newapi` | Open the control panel (status + actions menu) |
| `/newapi status` | Plain-text status echo (endpoint, auth, cache, current model) |
| `/newapi model` | Type-to-filter model picker scoped to `newapi` |
| `/newapi refresh` | Re-discover models, rewrite cache, re-register provider |
| `/newapi test` | Probe `/v1/models` and report latency + model count |
| `/newapi clear` | Delete the model cache file |
| `/newapi login` | Run the login flow directly (Manual / Import from Codex) |
| `/login newapi` | Same flow via pi's `/login` |
| `/clear` | Start a new session — alias for pi's `/new` |

The panel (`/newapi`) shows endpoint, auth source and key fingerprint, cache
age, current model and thinking level, plus the last discovery error if any.
Actions run in place with a spinner and a result line:

- **Switch model** opens a filter-as-you-type picker over `newapi` models only
  (current model marked with `✓`; typing filters by id or name).
- **Refresh models** re-discovers via `/v1/models`, persists the cache, and
  re-registers the provider immediately — no session restart needed.
- **Test connection** probes `/v1/models` without touching the cache.
- **Clear model cache** deletes `newapi-models.json`.
- **Login…** closes the panel and starts the login flow directly at
  "New API login method" (Manual / Import from Codex).

Manual login retries instead of starting over: if discovery fails you can
retry with the same credentials, re-enter them, or abort.

If discovery fails at session start and a cached list is used instead, the
extension notifies once instead of failing silently.

## Model capability matching

The relay's `/v1/models` does not expose capabilities. At registration every
model id is matched **exactly** (case-insensitive) against pi-ai's built-in chat
catalog, with vendor catalogs preferred over gateway catalogs:

- `reasoning` and `input` (text / image) are inherited. `input` fixes models the
  old id heuristic declared text-only (Claude, DeepSeek, …).
- `contextWindow` is inherited **only when every exact catalog candidate agrees
  and the value is lower than the current fallback** (1M by default). Conflicting
  catalogs (e.g. `gpt-5.4`: 272k in openai vs 1.05M in azure) keep the fallback
  to avoid premature compaction.
- `maxTokens` is **not** inherited: raising the output budget can trigger
  upstream 400s. `thinkingLevelMap` / `compat` / sampling params stay with this
  provider because their values are API-specific; `cost` stays 0 because relay
  pricing differs.
- No fuzzy matching: `gpt-5.2` never matches `gpt-5.2-chat`.
- Unmatched ids keep the legacy fallback (`reasoning: true`, 1M context, id-based
  vision guess), so new or renamed relay models still work.
- The cache's fields are only fallbacks. Capability is resolved at registration,
  so a pi-ai upgrade takes effect without re-discovering models.

To narrow or correct a model, use `~/.pi/agent/models.json` (the topmost layer):

```json
{
  "providers": {
    "newapi": {
      "modelOverrides": {
        "some-chat-model": { "reasoning": false },
        "some-reasoning-model": { "thinkingLevelMap": { "xhigh": null, "max": null } }
      }
    }
  }
}
```

`get_available_thinking_levels` then reports `["off"]` for a non-reasoning
model and the mapped subset otherwise.

## Notes

- Model cost defaults are placeholders (0 cost). Context defaults to 1M tokens and is lowered only when the built-in catalog is unanimous; override via `models.json` if needed.
- Reasoning and input modalities are matched against pi-ai's built-in catalog by exact id; unmatched ids default to `true` reasoning and the id-based vision heuristic.
- For gateways that are true LiteLLM, prefer `pi-provider-litellm`.
- There is no separate `cc` provider; Codex import writes into `newapi` only.
- MCP / project trust settings from Codex are not imported.

## Intermittent relay routing errors

Some New API / One API relays occasionally answer a **valid** request with:

```
New API API error (400): {"message":"Missing required parameter: 'messages'.", ...}
```

This is the relay mis-routing your request to a chat-completions upstream and
forwarding the body unchanged — nothing to do with `baseUrl`, the model id, or
your payload. Evidence it is the relay and not the request:

- The identical body succeeds on the very next attempt.
- The failing response carries **none of the upstream's response headers**
  (e.g. `x-ms-served-model`, `apim-request-id`) — only the relay's own
  `x-…-request-id` — so the request never reached a model.
- Rate is endpoint-dependent; measured ~20% of attempts on one relay.

Because the status is `400`, pi's built-in provider retry (which only retries
`408/409/429/5xx`) does not catch it. `pi/packages/ai/src/utils/retry.ts` now
classifies `bad_response_status_code` / `missing required parameter` as
retryable, so the agent's normal retry budget (`retry.maxRetries`, default 3)
absorbs the flake. If you still see these errors, raise the budget in
`~/.pi/agent/settings.json`:

```json
{ "retry": { "maxRetries": 5 } }
```

Do **not** work around this by switching `api` between `openai-completions` and
`openai-responses`, or by changing the base URL layout — both routes typically
work, and the error is random per attempt, so such a "fix" only appears to help.

