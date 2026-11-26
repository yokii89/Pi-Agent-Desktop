# PiDesk native extension preview v1

The authoritative contract is `src/shared/durableExtension.ts` in the target PiDesk checkout. It is not a published extension SDK. The bundled runtime is pinned to `@earendil-works/pi-durable@1.6.0`; inspect that installed package's types when creating tools, tasks, hooks or wraps.

## Package and entry

```json
{
  "name": "pidesk-example",
  "version": "1.0.0",
  "type": "module",
  "files": ["dist", "skills", "prompts"],
  "pidesk": {
    "runtime": {
      "engine": "durable",
      "apiVersion": 1,
      "id": "example",
      "entry": "./dist/desktop.js",
      "capabilities": ["commands"],
      "hosts": ["session"]
    }
  }
}
```

`id` is a lowercase letter followed by lowercase letters, digits or hyphens, at most 64 characters. `entry` is a relative compiled `.js`/`.mjs` file inside the package, including after resolving links. `.js` requires ESM package metadata. Bare TypeScript and old `pi.extensions` code are not executable entries. Ship compiled output before installation; install scripts do not run.

A minimal compiled entry needs no runtime imports:

```javascript
export default function createExtension(context) {
  return {
    commands: [{
      name: `${context.id}:review`,
      description: "Review the requested changes",
      expand: (args) => `Review these changes carefully: ${args || "the current workspace"}`,
    }],
    dispose() {
      // Release resources owned by this factory instance, when present.
    },
  };
}
```

Write source in TypeScript and compile it as ESM. Runtime dependencies must resolve from the installed package; do not assume imports resolve against PiDesk's private ASAR dependencies.

## Factory context and result

The factory runs once per host instance, also on recovery, with read-only properties:

- `id`: manifest id.
- `sessionId`: stable stored session id for session hosts, opaque host id otherwise.
- `cwd`: host working directory.
- `scope`: `user` or `project`.
- `hostScope`: `session`, `app` or `settings`.
- `signal`: aborted before host shutdown.
- `views`: a host-owned `DesktopViewClient` when `views` is declared.
- `contributions`: approved static keys indexed by placement and id, such as `settings:preferences`.

Return an object with only `agent?`, `commands?` and `dispose?()`. Imports may be cached; mutable module globals cannot hold host identity. The host validates manifests in main and paths again in the utility process. Third-party Node code is not sandboxed.

`agent` is a Durable `Extension`, named exactly like the manifest id. Tool names and custom task names start with `<id>__`. Hooks, sections and wraps follow the pinned Durable types. All definitions are installed before Harness recovery.

Each command is either `{ name, description, expand(args) }` or `{ name, description, execute(args) }`. Its name is `<id>:<name>` with each segment following the id syntax. Descriptions are at most 400 characters. `expand` returns a nonempty prompt string; `execute` returns a prompt string or `undefined` when handled locally. Same-request retries share the in-memory command result; failed commands may be retried. Unknown commands fail instead of being sent to the model.

## Views and host lifetimes

Only user packages may declare `app` or `settings` in `hosts`, and those lifetimes require the `views` capability. Factories running there must omit `agent` and `commands`. A package may also declare `session` and return a scope-specific result.

App hosts live with the application. Settings hosts share leases and close after the final lease's grace period. Session hosts close with their conversation. All run in PiDesk's bundled utility process without starting a CLI.

Use `context.views.openLive(...)` for supported placements. Static entries belong under `pidesk.contributes.settingsViews`, `accessModes` or `panels`; each has an `id` and `title`. For example, a settings View supplies `contributionKey: context.contributions["settings:preferences"]` and `placementHint: { panelId: "preferences" }`. Follow the installed View SDK for method parameters and limits. The host issues separate in-memory credentials for every instance and revokes them on shutdown or failure. Do not use `process.env` or environment auto-discovery for View connections.

## Validation

Test both declared and rejected capabilities, duplicate ids/names, path containment, concurrent command admission, open failure cleanup and close retry behavior. Verify enabled resource toggles affect discovery. Changes to a running session apply on close/reopen. Use the target checkout's native test suites and `pnpm check:agent-runtime --extensions` for desktop/ASAR View acceptance when available. Do not publish unimplemented interactions or MCP transports as working native capabilities.
