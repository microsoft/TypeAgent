# TypeAgent Plugin for GitHub Copilot CLI

This plugin integrates TypeAgent with GitHub Copilot CLI, enabling action requests (calendar, email, music, browser automation, etc.) to be routed to TypeAgent before the Copilot LLM.

## How It Works

```
User Input → copilot
    ↓
userPromptSubmitted hook (hook-router.js)
    ↓
Question word? → Fall through to Copilot LLM
Action request?
    ├── direct mode → Connect to TypeAgent ws://localhost:8999
    │     → Recognized action? → Return response, skip LLM
    │     → Unknown action? → Fall through to Copilot
    └── mcp mode → Inject directive, LLM calls typeagent-processCommand tool
```

  The hook output fields `handled`, `responseContent`, and `handledBy` are supported in current Copilot CLI behavior, allowing the hook to skip the agentic loop entirely when TypeAgent handles a request. For local runtime debugging against the runtime repo, use `pnpm copilot:dev`.

---

## Prerequisites

### 1. Node.js and pnpm

For this workspace, use Node.js 22+ and pnpm 10+ (from `ts/package.json` engines).

**On Windows** — install via [nvm-windows](https://github.com/coreybutler/nvm-windows) or the [Node.js installer](https://nodejs.org/):

```powershell
nvm install 22
nvm use 22
node --version  # should show v22.x.x or later
```

**In WSL** — via nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22 && nvm use 22
```

### 2. TypeAgent Server Running

The plugin connects to TypeAgent at `ws://localhost:8999` by default.

Start the TypeAgent agent-server from `D:\repos\TypeAgent\ts`:

```bash
# In WSL or Windows
cd D:\repos\TypeAgent\ts
pnpm run start:agent-server
```

Or set `TYPEAGENT_PORT` and `TYPEAGENT_HOST` to override the connection.

---

## Building

### Build the Plugin (WSL)

```bash
cd /mnt/d/repos/TypeAgent/ts
pnpm install        # installs workspace deps, syncs TypeAgent credentials
pnpm run build      # builds all packages including copilot-plugin
```

Or build just the plugin:

```bash
cd /mnt/d/repos/TypeAgent/ts/packages/copilot-plugin
pnpm run build
```

**Output:** `dist/hooks/hook-router.js` and other hook entry points.

### Optional: Build Dev Runtime (copilot-agent-runtime)

This is only needed if you want to run against a local runtime checkout with `pnpm copilot:dev`.

**Build in WSL** (builds for all platforms — the Windows binary runs on Windows):

```bash
cd /mnt/d/repos/copilot-agent-runtime
npm install --force   # --force bypasses platform-specific native module errors
npm run build:mcp-client
npm run build
```

**Optional install globally on Windows** — open PowerShell/CMD in `D:\repos\copilot-agent-runtime`:

```powershell
npm install -g .
copilot-dev --version
```

---

## Testing on Windows

### Step 1: Verify Copilot CLI is Installed

```powershell
copilot --version
```

Expected: a valid GitHub Copilot CLI version.

### Step 2: Start TypeAgent Server

In a separate terminal (Windows or WSL):

```bash
cd D:\repos\TypeAgent\ts
pnpm run start:agent-server
```

Wait until you see the server is ready on port 8999.

### Step 3: Launch Copilot with the Plugin

```powershell
copilot --plugin-dir D:\repos\TypeAgent\ts\packages\copilot-plugin
```

The `--plugin-dir` flag loads the plugin from a local directory. On first launch it reads `plugin.json`, registers hooks from `hooks.json`, and exposes the MCP server from `.mcp.json`.

### Step 4: Test Routing

**Action requests → TypeAgent:**

```
> schedule a meeting with John tomorrow at 2pm
> send an email to alice@example.com about the project
> play some jazz music
> open browser and navigate to github.com
> list my playlists
```

**Questions → Copilot LLM (fall-through):**

```
> what is the difference between var and let in JavaScript?
> explain how async/await works
> how do I configure webpack?
```

**Plugin commands (no TypeAgent server needed):**

```
> @typeagent status
> @typeagent mode direct
> @typeagent mode mcp
> @typeagent powershell on
> @typeagent run list the playlists
```

### Step 5: Verify Verification in Copilot CLI

Check that the plugin loaded:

```
> /plugin list
```

Should show `typeagent` under the plugins section.

---

## Install Globally (available in every `copilot` session)

The `--plugin-dir` flag (and the `pnpm copilot` wrapper) only loads the plugin
for that one launch. To make it available in **every** `copilot` session,
regardless of which directory you start from, install it globally:

```powershell
cd D:\repos\TypeAgent\ts\packages\copilot-plugin
pnpm run build       # tsc + esbuild bundle (produces a self-contained dist/)
pnpm run register    # registers a local marketplace and installs the plugin
```

After this, plain `copilot` from any directory loads the plugin with a working
MCP server — no `--plugin-dir`, no `pnpm copilot` needed. Verify with:

```powershell
copilot plugin list   # shows: typeagent@typeagent-local (v0.0.1)
```

To remove it everywhere:

```powershell
pnpm run uninstall:global
```

### How it works

The current Copilot CLI (>= 1.0) does **not** accept a local path for
`copilot plugin install` — only `plugin@marketplace`, `owner/repo`, repo
subdirs, or git URLs. However, `copilot plugin marketplace add <path>` **does**
accept a local path. So `pnpm run register` (`scripts/install-plugin.mjs`):

1. Registers the `ts` workspace root as a local marketplace named
   `typeagent-local`. The CLI discovers the marketplace manifest at
   `ts/.github/plugin/marketplace.json`, whose plugin `source` points at
   `./packages/copilot-plugin` (resolved relative to the marketplace root).
2. Installs `typeagent@typeagent-local`, which **copies** the plugin dir into
   `~/.copilot/installed-plugins/`.

> The CLI searches several locations for the marketplace manifest, in order:
> `marketplace.json` (root), `.plugin/marketplace.json`,
> `.github/plugin/marketplace.json`, then `.claude-plugin/marketplace.json`.
> We use `.github/plugin/` since the workspace already has a `.github` folder.

### Why the build must bundle

Installing copies the plugin directory into `~/.copilot/installed-plugins/`.
Because this is a pnpm workspace, the plugin's runtime deps (the MCP SDK and the
`workspace:*` packages) are symlinks/junctions into the central `.pnpm` store —
the copy breaks them, and the MCP server crashes on launch with
`ERR_MODULE_NOT_FOUND`. To fix this, `pnpm run build` runs an esbuild bundle
step (`scripts/bundle.mjs`) that inlines every dependency into the hook and MCP
entry points, so the copied `dist/` is self-contained and needs no
`node_modules` at runtime.

### Updating after a code change

The global install is a **snapshot copy**, not a live reference. After editing
the plugin, rebuild and refresh the global copy:

```powershell
pnpm run build       # re-bundle
pnpm run register    # re-copies the fresh build (runs `copilot plugin update`)
```

> For rapid local development with live edits, prefer `pnpm copilot`
> (`--plugin-dir`), which runs your working directory directly and skips the
> build+refresh cycle. Use the global install for the "available everywhere"
> workflow.

---

## Integration Modes

The plugin supports two modes, switchable at runtime:

### Direct Mode (default)

The hook connects directly to TypeAgent over WebSocket. When TypeAgent recognizes and handles the request, the hook returns `{ handled: true, responseContent: "..." }` — Copilot skips the LLM entirely.

- **Pros:** Fast (~1-3s), no LLM tokens consumed
- **Cons:** No streaming output, response is returned all at once

### MCP Mode

The hook injects a directive into the prompt context, instructing the LLM to call the `typeagent-processCommand` MCP tool. TypeAgent's MCP server streams progress notifications to the CLI timeline.

- **Pros:** Streaming output visible during processing, LLM-formatted responses
- **Cons:** Slower (~3-5s), consumes LLM tokens

**Switch modes:**

```
> @typeagent mode direct    # fastest, skips LLM
> @typeagent mode mcp       # streaming, uses LLM
```

Or set permanently via environment variable before launching:

```powershell
$env:TYPEAGENT_MODE = "mcp"
copilot --plugin-dir D:\repos\TypeAgent\ts\packages\copilot-plugin
```

---

## Configuration

The plugin stores config at `%USERPROFILE%\.typeagent-copilot\config.json` (Windows) or `~/.typeagent-copilot/config.json` (WSL/Linux).

```json
{
  "mode": "direct",
  "powershell": {
    "enabled": true
  }
}
```

**Environment variable overrides** (take precedence over config file):

| Variable                | Default                | Description           |
| ----------------------- | ---------------------- | --------------------- |
| `TYPEAGENT_MODE`        | `direct`               | `direct` or `mcp`     |
| `TYPEAGENT_HOST`        | `localhost`            | TypeAgent server host |
| `TYPEAGENT_PORT`        | `8999`                 | TypeAgent server port |
| `TYPEAGENT_PLUGIN_DATA` | `~/.typeagent-copilot` | Config directory      |

---

## Plugin Components

### Hooks (`hooks.json`)

| Hook                  | File                 | Purpose                                                      |
| --------------------- | -------------------- | ------------------------------------------------------------ |
| `userPromptSubmitted` | `hook-router.js`     | Route action requests to TypeAgent or Copilot                |
| `agentStop`           | `hook-agent-stop.js` | Track Copilot interactions in TypeAgent history              |
| `postToolUse`         | `hook-post-tool.js`  | Track Copilot tool results in TypeAgent history              |
| `preToolUse`          | `hook-powershell.js` | Inject TypeAgent PowerShell guidance for PowerShell commands |

### MCP Server (`.mcp.json`)

Exposes TypeAgent as MCP tools for the LLM (used in MCP mode):

| Tool                       | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `typeagent-processCommand` | Send a command to TypeAgent and get the response |
| `typeagent-listAgents`     | List available TypeAgent agents                  |
| `typeagent-getStatus`      | Get TypeAgent server status                      |

### Agents (`agents/`)

- `typeagent.agent.md` — Sub-agent that delegates action requests to TypeAgent via MCP tools

### Skills (`skills/`)

- `typeagent-setup/` — Interactive skill to configure integration mode and server connection

---

## Debugging

### Enable Hook Debug Logging

Hooks write diagnostics to stderr (not visible in normal CLI output). To see them, redirect stderr:

```powershell
# Windows: run hook directly for testing
echo '{"sessionId":"test","timestamp":1234,"cwd":"C:\\temp","prompt":"list my playlists"}' | node D:\repos\TypeAgent\ts\packages\copilot-plugin\dist\hooks\hook-router.js
```

### Test Hooks Directly (WSL)

The `package.json` includes test scripts that simulate hook invocation:

```bash
cd /mnt/d/repos/TypeAgent/ts/packages/copilot-plugin

# Test direct mode routing (TypeAgent server must be running)
pnpm run test:direct

# Test MCP redirect mode (no server needed — just checks prompt injection)
pnpm run test:mcp-redirect
```

### Check TypeAgent Connection

```powershell
# Windows: test WebSocket connection to TypeAgent
> @typeagent status
```

Expected output shows server URL and current mode. If TypeAgent is not running, direct mode requests will fall through to Copilot.

### Common Issues

| Issue                          | Cause                         | Fix                                                            |
| ------------------------------ | ----------------------------- | -------------------------------------------------------------- |
| `copilot` not found            | Copilot CLI not installed     | Install GitHub Copilot CLI and verify with `copilot --version` |
| Action not routed to TypeAgent | Prompt detected as a question | Rephrase: use imperative ("schedule...", "send...", "play...") |
| TypeAgent connection refused   | Server not running            | Start TypeAgent server (`pnpm run start:agent-server`)         |
| Hook timeout                   | TypeAgent slow to respond     | Increase `timeout` in `hooks.json` or use MCP mode             |
| SQLite experimental warning    | Node 24 feature               | Normal — can be suppressed with `--no-experimental-warnings`   |

---

## Architecture Reference

During development, the runtime implementation lived in `D:\repos\copilot-agent-runtime`.
The key runtime hook behavior change was in:

- **`src/core/hooks.ts`** — Added `handled`, `responseContent`, `handledBy` to `UserPromptSubmittedHookOutput`
- **`src/core/session.ts`** (~line 7473) — Added handler that checks hook output and emits an assistant message directly, bypassing `runAgenticLoop()`

This allows any `userPromptSubmitted` hook to fully handle a request and return a response without the LLM being invoked.

See the [investigation document](D:\repos\codeDocs\TypeAgent\forAgent\investigations\active\2026-04-06_copilot-cli-typeagent-integration.md) for full architectural analysis.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
