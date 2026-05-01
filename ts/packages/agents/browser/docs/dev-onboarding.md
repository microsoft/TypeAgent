# Browser Agent — Developer Onboarding Guide

This guide covers browser-specific development tasks. For architecture context,
read [browserAgent.md](../../../../docs/architecture/browserAgent.md) first.

## Prerequisites & Setup

**See project-level docs for general setup:**

- [ts/README.md](../../../../README.md) — Node/pnpm install, `.env` configuration, running shell/CLI
- [ts/CLAUDE.md](../../../../CLAUDE.md) — Build commands, testing, code conventions

**Browser-specific requirements:**

- Chrome or Edge (latest) — Extension host
- `.env` file at `TypeAgent/ts/.env` with Azure OpenAI API keys (ask team for config)

---

## Building the Extension

The extension has its own build pipeline: TypeScript type-checking + Vite
bundling with esbuild.

```bash
cd packages/agents/browser

# Production build (minified, no sourcemaps)
npm run build:extension

# Development build (sourcemaps, no minification)
npm run build:extension:dev
```

### What the build produces

Output goes to `dist/extension/` (Chrome) and `dist/electron/` (Electron):

```
dist/extension/
├── manifest.json              # Chrome MV3 manifest
├── serviceWorker.js           # Background script (ESM format)
├── contentScript.js           # Main content script (IIFE)
├── webTypeAgentContentScript.js
├── webTypeAgentMain.js        # MAIN world script (IIFE)
├── uiEventsDispatcher.js      # UI event capture (IIFE)
├── sites/                     # Site-specific scripts
├── offscreen/                 # Offscreen document
├── views/                     # Side panel, options, libraries
├── images/                    # Extension icons
├── vendor/                    # Third-party (bootstrap, cytoscape, etc.)
└── webagent/crossword/        # Compiled crossword grammar
```

### Build pipeline details

The build is orchestrated by Fluid Build with these steps:

1. **TypeScript type-checking** — `tsc` checks extension and common code
   (no emit; esbuild handles transpilation)
2. **Vite/esbuild bundling** — `scripts/buildExtension.mjs` builds both
   Chrome and Electron variants:
   - Service worker: bundled as ESM (`format: 'es'`) — required by MV3
   - Content scripts: bundled as IIFE (`format: 'iife'`, `inlineDynamicImports: true`)
3. **Static asset copy** — manifest, HTML views, CSS, images, vendor libs
4. **Grammar compilation** — `.agr` files compiled to `.ag.json` via `agc`

### Component-specific builds

```bash
npm run tsc:agent        # Agent business logic only
npm run tsc:common       # Shared utilities only
npm run agc              # Compile action grammar
npm run build:views      # Build web views (PDF viewer, knowledge library UI)
npm run package          # Package extension as .crx/.zip for distribution
```

---

## Loading the Extension in Chrome

1. Navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select `TypeAgent/ts/packages/agents/browser/dist/extension/`

The extension icon appears in the toolbar. A red badge indicates the
WebSocket connection to the agent is not established.

### After code changes

```bash
# Rebuild the extension
npm run build:extension:dev

# Then in Chrome:
# - Go to chrome://extensions
# - Click the refresh icon on the TypeAgent extension card
# - Reload any open tabs (content scripts need re-injection)
```

---

## Verifying the Connection

Start the dispatcher via shell or CLI (see [ts/README.md](../../../../README.md#running)).
Once running with the extension loaded:

- Extension badge turns green (connected)
- Side panel shows "Connected" status
- `@browser open google.com` in the shell/CLI should open a tab

---

## Debugging

The browser agent spans **four processes**, each with its own debugging approach.

### Agent process (Node.js)

Debug like any Node.js code. Use the "Shell (Main process)" VS Code launch
config in `TypeAgent/ts/.vscode/launch.json`, or attach to port 9229.

**Debug logging:**

```bash
DEBUG=typeagent:browser:* pnpm run cli:dev
DEBUG=typeagent:browser:serviceWorker pnpm run cli:dev
DEBUG=typeagent:webAgent:proxy pnpm run cli:dev
```

**Key breakpoint files:**

- `browserActionHandler.mts` — Action routing and execution
- `agentWebSocketServer.mts` — Client connections and RPC
- `externalBrowserControlClient.mts` — Outgoing RPC calls to extension

### Extension service worker

1. Go to `chrome://extensions`
2. Find the TypeAgent extension
3. Click **Inspect views: service worker** link
4. DevTools opens for the service worker context

**Common issues:**

- Service worker goes idle after 30 seconds (MV3 limitation). The WebSocket
  keep-alive (20s interval) prevents this during normal operation.
- After extension reload, the service worker restarts and re-establishes
  the WebSocket connection.

### Content script

1. Open DevTools on the target page (F12)
2. Go to **Sources** tab
3. Find the content script under `Content scripts` > extension ID
4. Set breakpoints

Content scripts run in an **isolated world** — they share the page's DOM
but have their own JavaScript scope. MAIN world scripts
(`webTypeAgentMain.js`, `uiEventsDispatcher.js`) run in the page's context.

**Common issues:**

- Content script not loaded: check URL matches manifest `matches` patterns
- RPC not responding: service worker may have restarted — extension
  auto-reinjects content scripts on RPC failure

### Electron main process

When running the shell, the Electron main process manages browser tabs.
Use the "Shell (Main process)" VS Code launch config.

**Key files:**

- `packages/shell/src/main/browserViewManager.ts` — Tab management
- `packages/shell/src/main/browserIpc.ts` — WebSocket bridge
- `packages/shell/src/main/inlineBrowserControl.ts` — Direct browser control

### WebSocket traffic inspection

Add logging or use the `DEBUG` environment variable:

```bash
DEBUG=typeagent:browser:* pnpm run cli:dev
```

---

## Common Development Tasks

### Adding a new browser action

1. **Define the action type** in `src/agent/browserActionSchema.mts`
2. **Add to the union type** — include in `BrowserActions` union
3. **Add grammar rules** in `src/agent/browserSchema.agr`
4. **Compile the grammar**: `npm run agc`
5. **Add the handler** in `browserActionHandler.mts` inside `executeBrowserAction()`
6. **Build and test**: `npm run build && npm run test`

### Adding a new RPC method (agent → extension)

1. **Add to interface** in `src/common/browserControl.mts` (`BrowserControlInvokeFunctions`)
2. **Implement in extension** — add handler in `externalBrowserControlServer.ts`
3. **Add the proxy** in `externalBrowserControlClient.mts`
4. **Rebuild both** agent and extension

### Adding a new content script RPC method

1. **Add to type** in `contentScriptRpc/types.mts`
2. **Add client call** in `contentScriptRpc/client.mts`
3. **Add handler** in content script's RPC server (`contentScript/eventHandlers.ts`)
4. **Rebuild extension**: `npm run build:extension:dev`

### Creating a new WebAgent

See [webagent-development.md](webagent-development.md) for a step-by-step guide.

### Adding a new extension view

1. Create HTML in `extension/views/yourview.html`
2. Create TypeScript in `extension/views/yourview.ts`
3. Add to `web_accessible_resources` in `manifest.json` if needed
4. Register RPC handlers in `serviceWorkerRpcHandlers.ts`
5. Rebuild extension

---

## Key File Map

| What you're looking for        | Where to find it                                              |
| ------------------------------ | ------------------------------------------------------------- |
| Action types and schemas       | `src/agent/browserActionSchema.mts`                           |
| Grammar rules (NL patterns)    | `src/agent/browserSchema.agr`                                 |
| Main action handler/router     | `src/agent/browserActionHandler.mts`                          |
| BrowserControl interface       | `src/common/browserControl.mts`                               |
| RPC type definitions           | `src/common/serviceTypes.mts`                                 |
| WebSocket server (agent side)  | `src/agent/agentWebSocketServer.mts`                          |
| RPC proxy to extension         | `src/agent/rpc/externalBrowserControlClient.mts`              |
| Extension service worker entry | `src/extension/serviceWorker/index.ts`                        |
| WebSocket client (extension)   | `src/extension/serviceWorker/websocket.ts`                    |
| Extension RPC handlers         | `src/extension/serviceWorker/serviceWorkerRpcHandlers.ts`     |
| Browser control server (ext)   | `src/extension/serviceWorker/externalBrowserControlServer.ts` |
| Content script entry           | `src/extension/contentScript/index.ts`                        |
| DOM interaction                | `src/extension/contentScript/elementInteraction.ts`           |
| Recording system               | `src/extension/contentScript/recording/`                      |
| Knowledge extraction           | `src/agent/knowledge/`                                        |
| WebFlow system                 | `src/agent/webFlows/`                                         |
| WebAgent framework             | `src/extension/webagent/`                                     |
| Electron tab manager           | `packages/shell/src/main/browserViewManager.ts`               |
