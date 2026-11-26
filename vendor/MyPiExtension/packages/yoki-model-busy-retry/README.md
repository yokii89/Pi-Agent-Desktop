# yoki-model-busy-retry

Waits out a **saturated model** instead of failing the turn. When Qoder answers a full model with

```
Qoder model is busy: request queued (10605 CALL_COUNT_LIMIT (p3), 15254 ahead, ~205s wait,
rate limit, retry-after-ms=205000)
```

this extension treats that `205s` as a **promise to chase, not a nap to take**: it sleeps a share of
it (25% → 51s), re-sends, and re-plans from whatever the queue says next. A queue that clears when it
said it would never surfaces as a failed model call — and one that lies costs us one short probe,
not the whole turn.

## Why the announced wait must not simply be slept

An announced wait is an estimate made *at rejection time*, and the run only gets one budget:

| | sleeping the announced wait whole | chasing it in slices |
| --- | --- | --- |
| `~205s wait`, 240s run budget | one blind 205s sleep, 35s left: the second re-ask lands 35s into a queue that still wants minutes, the third has nothing, and every later request in the run short-circuits | 51s probe → re-ask → 102s → re-ask → the 86s left, with a fresh number every time |
| queue drained early | still sleeps the whole estimate | caught by the next probe |
| estimate was optimistic | the entire budget is gone on guess #1 | the slice was cheap, and the new number replaces the old one |
| `Esc` | lands inside a minutes-long sleep | lands inside a slice, and the wait resolves immediately |

## Why it needs to exist

Nothing in Pi can keep that wait today:

| Layer | What it does | Why it misses |
| --- | --- | --- |
| `pi-provider-qoder` | Retries `10605` internally, max 2 times | Its wait is hard-capped at 5s (`MODEL_BUSY_MAX_WAIT_MS`), and the *queued* rejection is a plain `Error`, so it rethrows without waiting at all |
| Pi agent-level retry | Treats the failure as retryable (`rate limit` matches) and retries 3 times | `retry.baseDelayMs` is 2s → 2s/4s/8s, always re-entering a queue that asked for 30s. Extensions can read settings but not write them |
| this extension | Owns the wait at the provider stream | — |

Wrapping `streamSimple` also means the retry stays invisible to the transcript: Pi sees one response, so
no error bubble, no lost prompt cache, and no second assistant message in history.

## Install

```bash
pi install git:github.com/yokii89/MyPiExtension
```

Zero setup. It only attaches to providers whose API is `qoder-api` (both Qoder regions) and leaves every
other provider untouched.

## How it works

`pi.on(session_start | before_agent_start | model_select)` re-checks the registered providers and wraps
any `streamSimple` that is not already ours — the provider extension registers asynchronously and a
catalog refresh can hand back its original implementation, so the check is cheap and repeatable.

Each wrapped request runs this loop:

1. Forward the provider's events as they arrive, but hold the `start` event back until the attempt
   produces content. The agent loop pushes a partial message at `start` and replaces it at the terminal
   event, so a swallowed attempt must never have announced itself.
2. If the attempt ends in a `10605` busy/queued error **and produced no content**, read what the queue
   said (its wait and its position), ask the planner for the next wait, sleep it, and go back to 1.
   Once content is on the wire the response is committed and the error is passed through unchanged.
3. Otherwise forward `done`/`error` and finish — Pi's own retry still runs on top if we give up, and
   each of those retries re-enters this loop. That is why the run budget is shared, not per request.

Aborts are honored: `Esc` during a wait ends the wait immediately and the next attempt returns the
provider's own `aborted` result, which is never retried.

## Behavior

Constants live in [`policy.ts`](./policy.ts) — one place, no settings file:

| Knob | Default | Notes |
| --- | --- | --- |
| `probeFraction` | 0.25 | Share of a long announced wait slept before re-asking: the queue's X, our X/4 |
| `minProbeMs` | 5000 | Floor. A probe costs a request against the very `CALL_COUNT_LIMIT` that queued us |
| `maxProbeMs` | 60000 | Ceiling for one probe **while the estimate is still falling**; a promise at or under it is simply kept whole |
| `fallbackDelayMs` | 30000 | `busy` with no number in it: double from here (30s → 60s), still capped at one probe |
| `maxServerHintMs` | 300000 | Longest promise we are willing to chase at all |
| `drainRatio` | 0.5 | A promise that fell by less than half the time spent did not keep its word |
| `maxStalledProbes` | 3 | Kept-no-promise probes before we stop waiting for a queue that is not moving |
| `maxAttemptsPerRequest` | 6 | Waits per model request |
| `maxWaitMsPerRun` | 240000 | Total wait per agent run — shared, because Pi retries the same response through its own layer too |

The ladder in one line: **keep a short promise in one sleep, slice a long one at 25%, and double the
slice (25% → 50% → 100%) every time the new number proves the probe bought us nothing.**

Progress is judged against the time actually spent — our sleep plus whatever the request in between
took — and a queue position that *grew* (`15254 ahead` → `20000 ahead`) counts as no progress at any
rate: that is re-asking pushing us to the back.

Every wait announces itself, so a slow turn is never a mystery:

```
model busy: probing in 51s (queue asked 205s, 15254 ahead), retry 1/6
model busy: probing in 103s (queue asked 205s, 15254 ahead), retry 2/6
model busy: waiting 86s (queue asked 205s, 15254 ahead, only 86s of budget left), retry 3/6
```

`/busy-retry` answers "did it catch *my* failure?": which providers are wrapped, how long this run has
waited, and what the last decision was.

## Package layout

| File | Responsibility |
| --- | --- |
| `index.ts` | Event wiring, `/busy-retry`, notification, run-budget reset |
| `busyError.ts` | Which failures mean "saturated model", and what that failure said about the queue |
| `policy.ts` | Chase-the-promise schedule and its bounds |
| `retryStream.ts` | The forwarding retry loop |
| `wrapProviders.ts` | Which providers get wrapped, once |

## License

MIT
