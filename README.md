<div align="center">

# PiDesk

**A Windows desktop client for [pi](https://github.com/earendil-works/pi)**

[![Official website](https://img.shields.io/badge/official_website-pidesk--web.pages.dev-2E6BF0?logo=cloudflare&logoColor=white)](https://pidesk-web.pages.dev/)
[![Release](https://github.com/yokii89/Pi-Agent-Desktop/actions/workflows/release.yml/badge.svg)](https://github.com/yokii89/Pi-Agent-Desktop/releases)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-0078D4?logo=windows11&logoColor=white)
![Electron](https://img.shields.io/badge/Electron%20%7C%20React%2019%20%7C%20TypeScript-19354C?logo=electron&logoColor=9FEAF9)
[![License: MIT](https://img.shields.io/badge/license-MIT-3DA639)](./LICENSE)

![PiDesk workbench: session area, file panel and split terminal](./assets/images/hero-session.webp)

**English** ｜ [简体中文](./README.zh-CN.md) ｜ 🌐 **[Official website](https://pidesk-web.pages.dev/)**

</div>

> There are many agent clients — this one runs on your own pi.

PiDesk is the Windows desktop client for the open-source coding agent [pi](https://github.com/earendil-works/pi). It does not reimplement the agent: pi runs as a `--mode rpc` child process (JSONL over stdio) and PiDesk drives it. Session history stays in pi's native JSONL files, so the pi in your terminal and the pi in PiDesk are the same data. The **[official website](https://pidesk-web.pages.dev/)** carries the visual tour and two recorded walkthroughs.

## The client, not a second agent

- The agent loop, model auth, context compaction and tool execution all happen inside the pi process. What PiDesk adds is the desktop workbench around them: the event stream rendered as a readable document, and the project, terminal, browser and git changes kept within reach.
- **Session history stays in pi's own files.** No transcript copy, no second sync, no question of which copy wins — PiDesk keeps only markers such as titles, archive flags and pins. Uninstall it and your sessions still open in the terminal.
- **MCP config lives in pi's user-level `mcp.json`**, shared with the CLI.
- **No PiDesk account and no PiDesk model quota.** Model auth stays in pi's own config; GitHub sign-in is optional and exists to sync settings.
- When pi evolves the protocol, there is no second implementation to chase.

## Features

### Session area

- AI replies render as **document-flow Markdown** — GFM tables, numbered lists, inline code chips, one-click code block copy. No chat bubbles: a 200-line answer is a document, not twenty colored blocks.
- Tool calls collapse into compact status rows, and consecutive calls group into a summary header ("Ran 2 commands · Read 3 files"). Thinking folds into a single row until you expand it.
- **Parallel sessions**: 8 live pi processes by default, tunable from 1 to 32. Switching never kills one, and hitting the ceiling refuses the new session instead of evicting an old one.
- `@` file references as atomic tokens with read-only file chips; paste or drop images, attach any file.
- A **question rail** — one anchor per question, so you can jump straight back after fifty turns.
- Context usage next to the composer; a **per-turn file-edit summary** with undo and review on the same row; whole-session **Markdown or HTML export** (Markdown puts bodies in order, folds thinking and tool calls, and counts images rather than embedding them; HTML uses pi's native exporter).
- Access modes: full access is built in, and extensions can register their own (plan mode ships as an extension example) through the SDK.
- Streaming is a ~32ms-batched event stream routed by `sessionId`, so parallel chats never bleed into each other.

![Session area: user bubble, run header, collapsed thinking and tool-call summary rows](./assets/images/session-flow.webp)

*User bubble · run header (32s · 64.1K tokens) · collapsed thinking · "Ran 2 commands" summary rows · edit row with +1 −1*

### Workbench panels

Real components, not iframe placeholders: a real terminal on node-pty, a real embedded Chromium, a real git working-tree diff.

| ![File tree with Shiki preview](./assets/images/file-preview.webp) | ![Terminal split into two panes](./assets/images/terminal-split.webp) |
| :---: | :---: |
| **Files** — project tree, Shiki-highlighted read-only preview, fuzzy quick-open. Edits belong to the agent. | **Terminal** — node-pty + xterm, tabs and side-by-side / stacked splits, cwd bound to the project. |

| ![Element picking in the embedded browser](./assets/images/browser-pick-hover.webp) | ![Floating review panel](./assets/images/review-floating.webp) |
| :---: | :---: |
| **Browser** — import your cookie session, hover-highlight and select in pick mode, press Enter to drop the element into the composer, hot-edit styles, inspect. | **Review** — working-tree change list plus line-by-line diff, docked or floating, with stage / commit / push and rollbackable git snapshots. |

Splitting reuses a terminal that is already running rather than starting another session, and hiding the panel never kills the pty — panes are a way of looking at terminals, not a way of killing them.

### pi's ecosystem, hosted in a panel

PiDesk doesn't invent an ecosystem, it hosts one.

- **Extensions** — manage pi packages: install, uninstall, enable, globally or per project, with resource-level toggles for extensions, skills, prompt templates and themes.
- **MCP servers** — edit configs, probe status, hot-reload into running sessions; the market offers official-registry search plus curated one-click templates, so you never hand-type JSON. `mcp__*` calls render in the transcript with the same status rows. (Requires pi ≥ 0.99.0.)
- **View SDK** (`@pidesk/view-sdk`) — a serializable View protocol with capability negotiation and graceful degradation, so extensions ship UI into 8 placement slots while pi itself stays untouched.
- **Scheduled tasks** and **usage statistics** (summary cards, daily / monthly trends, per-model breakdown).

| ![Extensions page managing pi packages](./assets/images/extensions.webp) | ![MCP market with registry search and curated list](./assets/images/mcp-market.webp) |
| :---: | :---: |
| **Extensions** — pi packages plus per-resource toggles for extensions, skills, prompt templates and themes. | **MCP market** — official-registry search and curated one-click templates. |

### Desktop integration

zh-CN / en-US interfaces, light and dark themes, custom title bar, system tray, a one-shot startup animation with a replaceable logo, splash copy and font, Windows toasts with per-scenario sounds, optional GitHub sign-in for settings sync, and in-app auto-update from GitHub Releases — an **Update** button appears beside *Settings* when there is something new.

## Six things we deliberately didn't build

A client should not become a second agent. Each of these was buildable, and each would have competed with pi for the same job.

| Not built | Why |
| --- | --- |
| A copy of the transcript | Message bodies stay in pi's native JSONL; PiDesk keeps markers plus whole-session export as Markdown or HTML. |
| Bundled pi | No agent in the installer. You point PiDesk at your local pi executable; it probes the version and launches it. |
| An account system | Model auth belongs to pi. Skip GitHub sign-in and everything still works. |
| Chat bubbles | Agent output was always a document. |
| Reinvented agent features | Sub-agents, permission gates and sandboxing belong to pi's extension ecosystem — PiDesk renders them, and lets extensions register views and access modes through the SDK. |
| Cross-platform | Windows 10/11 only. The saved budget went into desktop integration: tray, native toasts, scenario sounds, auto-update. |

## Get started

1. Install the pi CLI — `npm install -g @earendil-works/pi-coding-agent` — and configure model auth in pi.
2. Download the NSIS installer from [Releases](https://github.com/yokii89/Pi-Agent-Desktop/releases) (SHA-256 checksums included).
3. On first launch, set the pi executable path and a working directory in Settings, then create a task.

![Settings → Configuration: pi executable path and probed version](./assets/images/pi-executable.webp)

*Settings → Configuration: point PiDesk at your local pi executable — it probes the version and reports readiness.*

Prefer to watch before you install? The [website](https://pidesk-web.pages.dev/#demo) has two walkthroughs captured from a running build: the full MCP flow, and picking a page element into the chat.

## Local development

Requirements: Windows 10/11 · Node.js ≥ 20 · [pnpm](https://pnpm.io) (locked by `packageManager`) · pi CLI

```bash
pnpm install   # run pnpm run rebuild:native first if node-pty needs an Electron ABI rebuild
pnpm dev       # tsc-compiled main process + Vite HMR renderer + automatic Electron restarts
pnpm dist      # NSIS installer and SHA-256 checksums into release/
```

| Script | Purpose |
| --- | --- |
| `pnpm dev` / `pnpm dev:renderer` | Full dev loop / Vite dev server only (renderer in a plain browser) |
| `pnpm build` / `pnpm start` | Build, then run the built output |
| `pnpm dist` / `pnpm release` | Package / bump version + tag to trigger the CI release |
| `pnpm typecheck` / `pnpm lint` | tsc strict / Biome format + lint |
| `pnpm test:view` / `pnpm test:sdk:coverage` | Protocol & SDK tests / SDK coverage |

Pushing a `v*` tag triggers GitHub Actions to build and publish to Releases. Release notes live in `release-notes/<tag>.md`, bilingual.

## Architecture

| Directory | Role |
| --- | --- |
| `src/main` | Electron main process: pi RPC driver, terminal pty, embedded browser, git, MCP, window & settings |
| `src/preload` | `contextBridge` whitelisted API (`window.pidesk`) |
| `src/renderer` | React 19 UI: session area, panels, settings, extension view host |
| `src/shared` | IPC protocol, i18n message tables, shared types |
| `packages/view-sdk` | Extension-facing SDK, published as `@pidesk/view-sdk` |

Main ↔ renderer talk over `ipcMain.handle` (request-response, always `{ ok, data \| error }`) and `webContents.send` (pushes such as terminal and session streams). The renderer has no Node capabilities. Session pushes carry `sessionId`, so multiple pi processes multiplex over one channel.

## Extension development

```bash
npm install @pidesk/view-sdk
```

```ts
import { connectDesktopView, viewOnDesktop } from "@pidesk/view-sdk";

const desktop = connectDesktopView(); // sync env probe, socket is lazy
if (desktop) {
  await viewOnDesktop(desktop, {
    title: "Pick a model",
    root: { type: "list", id: "model", items: [{ value: "a", label: "A" }] },
    actions: [{ id: "cancel", label: "Cancel", kind: "submit", variant: "ghost" }],
  });
}
```

Placement slots: `modal` · `stream` · `widget` · `panel` · `sidebar` · `header` · `settings` · `access-mode`. Under plain terminal pi the env probe returns `null`, so an extension falls back to its TUI — the same package runs in both hosts.

## Documentation

- **[Official website](https://pidesk-web.pages.dev/)** — the visual tour, in zh-CN and en-US
- [AGENTS.md](./AGENTS.md) — development conventions, fixed tech stack, session-area rendering rules
- [@pidesk/view-sdk reference](./packages/view-sdk/README.md) — protocol, slots, capabilities, limits
- [pi](https://github.com/earendil-works/pi) — the agent PiDesk drives

## License

PiDesk is released under the [MIT License](./LICENSE). Third-party assets keep their own licenses — the file-type icons come from [vscode-jetbrains-icon-theme](https://github.com/peakoss/vscode-jetbrains-icon-theme) (JetBrains Design Resources, Apache 2.0), see [src/renderer/fileIcons/NOTICE.md](./src/renderer/fileIcons/NOTICE.md).
