# TypeAgent Plugin for GitHub Copilot CLI

This plugin connects GitHub Copilot CLI to TypeAgent. It can route prompts to
TypeAgent, expose TypeAgent through MCP, give registered PowerShell actions
first refusal, and capture successful tool sequences as reusable macros.

## How It Works

```text
User prompt
  |
  +-> direct: TypeAgent dispatcher -> handled response or fallthrough
  |
  +-> mcp: Copilot calls typeagent-processCommand
  |
  +-> dev: registered PowerShell action/flow
  |           -> handled response
  |         or PowerShell capability fallback
  |           -> reuse/create/repair or fall through as not suitable
  |
  +-> bypass: Copilot handles the prompt

Registered alongside routing (calls are disabled in bypass mode):
  typeagent-workspace MCP tools
  typeagent-macros MCP tools -> replay or macro-runner handoff
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
> @typeagent mode dev
> @typeagent powershell on
> @typeagent run list the playlists
```

### Step 5: Verify the Plugin in Copilot CLI

Check that the plugin loaded:

```
> /plugin list
```

Should show `typeagent` under the plugins section.

## Tool-Composed Macros

The plugin includes the `typeagent-macros` MCP server, the TypeAgent Macro
Runner agent, and the `typeagent-macros` skill. Approved replayable macros run
deterministically. If `run_macro` returns `agentRequired`, the skill hands the
complete launch payload to the runner, which executes the whole macro through
Copilot's live tool and permission surface.

Agent-guided adaptations may be saved only through
`submit_macro_candidate`. The server validates handoff provenance, execution
budgets, and macro structure, then creates a new draft. It never mutates or
promotes the approved version.

Macros are not a plugin routing mode. They are a tool surface available in
direct, MCP, and dev modes.

### Record, approve, and run a macro

1. Arm one interaction:

   ```text
   @typeagent macro record
   ```

2. Complete one successful Copilot turn that uses an MCP tool.
3. Retrieve the trace ID:

   ```text
   @typeagent macro status
   ```

4. Ask Copilot to use `create_macro_from_trace`, then inspect the draft,
   retrieve its requirements, and call `validate_macro`.
5. Review the draft and explicitly call `approve_macro`. A draft cannot run;
   approval creates a new immutable version.
6. Call `run_macro` with the approved macro ID, required inputs, and
   `preference: "auto"`.
7. Use `get_macro_run` to inspect the sanitized persisted run record.

Replayable macros are preflighted in full before step one. Preflight checks
approval, required inputs, tool availability, and tool-schema fingerprints.
Macros containing Copilot-native tools use the macro runner for the whole
procedure. TypeAgent never replays a prefix and hands only the remainder to
the agent.

### Rollout Controls

Each macro boundary is enabled by default and can be disabled independently:

| Environment variable                    | Boundary                   |
| --------------------------------------- | -------------------------- |
| `TYPEAGENT_MACRO_RECORDING_ENABLED`     | Explicit trace recording   |
| `TYPEAGENT_MACRO_INDUCTION_ENABLED`     | Draft creation from traces |
| `TYPEAGENT_MACRO_REPLAY_ENABLED`        | Deterministic replay       |
| `TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED` | Agent-runner handoff       |

Set a variable to `0`, `false`, or `off` before starting Copilot to disable
that boundary. These flags do not change direct, MCP, dev, or PowerShell mode
selection. Restart Copilot after changing them.

### Recovery And Rollback

Macro data is stored under the agent-server instance directory in
`copilot-macros/`. Back up that directory before schema or deployment changes.
Run records, handoffs, and immutable macro versions are separate files;
`metrics.jsonl` contains only timestamp, operation, and outcome.

To stop a rollout, disable the affected boundary and restart Copilot. Existing
approved versions and drafts remain intact. Restore the backed-up
`copilot-macros/` directory only while agent-server is stopped. To roll back the
plugin, reinstall the previous plugin snapshot and leave the newer boundary
disabled until compatibility is confirmed.

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

1. Stages only the bundled runtime files under
   `~/.typeagent-copilot/plugin-stage`. This deliberately excludes the
   workspace's pnpm `node_modules` junctions, which Copilot cannot copy on
   Windows.
2. Creates and registers a local marketplace at
   `~/.copilot/marketplaces/typeagent-local`.
3. Installs or updates `typeagent@typeagent-local`, which copies the staged
   snapshot into `~/.copilot/installed-plugins/`, and verifies that it appears
   in `copilot plugin list`.

On Windows, VS Code may hold a directory watcher on the installed snapshot that
blocks Copilot CLI's normal directory replacement with `Access is denied`. The
registrar preserves the previous snapshot, removes the locked directory, and
retries `plugin update`. If the retry fails, it restores the previous snapshot.

### Why the build must bundle

Installing copies a plugin snapshot into `~/.copilot/installed-plugins/`.
Because this is a pnpm workspace, the package's runtime dependencies are
symlinks/junctions into the central `.pnpm` store. Copying those links can fail
with `Access is denied` on Windows, and copied links would not be portable.
`pnpm run build` therefore runs `scripts/bundle.mjs` to inline every dependency,
and registration stages only that self-contained runtime without
`node_modules`.

### Updating after a code change

The global install is a **snapshot copy**, not a live reference. After editing
the plugin, rebuild and refresh the global copy:

```powershell
pnpm run build       # re-bundle
pnpm run register    # stages and installs a fresh snapshot
```

> For rapid local development with live edits, prefer `pnpm copilot`
> (`--plugin-dir`), which runs your working directory directly and skips the
> build+refresh cycle. Use the global install for the "available everywhere"
> workflow.

---

## Integration Modes

The plugin supports three prompt-routing modes, plus bypass. These modes decide
how the `userPromptSubmitted` hook routes a request; they do not select a
different MCP tool catalog.

### Direct Mode (default)

The hook connects directly to TypeAgent over WebSocket. When TypeAgent recognizes and handles the request, the hook returns `{ handled: true, responseContent: "..." }` — Copilot skips the LLM entirely.

- **Pros:** Fast (~1-3s), no LLM tokens consumed
- **Cons:** No streaming output, response is returned all at once

### MCP Mode

The hook injects a directive into the prompt context, instructing the LLM to call the `typeagent-processCommand` MCP tool. TypeAgent's MCP server streams progress notifications to the CLI timeline.

- **Pros:** Streaming output visible during processing, LLM-formatted responses
- **Cons:** Slower (~3-5s), consumes LLM tokens

### Dev Mode

Dev mode is supported on Windows. The hook asks TypeAgent to handle the
PowerShell schema family first, including static `powershell.*` namespaces and
registered dynamic flows.

Ordinary requests use the `powershellCapabilityFallback` reasoning profile
after a grammar or translation miss. That bounded fallback can reuse an
existing flow, add a grammar pattern, create and test a new flow, repair one
stale flow once, or report that the request is not suitable for PowerShell. A
typed `notSuitable` result falls through to Copilot with the original prompt.

Recording directives such as `learn:`, `record`, and `dev: learn:` are sent to
the configured TypeAgent reasoning engine with a PowerShell flow recording
profile.

Calls to the broad TypeAgent agent-server MCP tools and the PowerShell pre-tool
redirect are disabled in this mode. The tool definitions remain registered so
mode changes take effect without restarting Copilot. The read-only
`typeagent-workspace` MCP server remains available for deterministic macro
steps. Once the hook returns a miss, the Copilot runtime handles the request
with its normal tool set.

- **Pros:** Reuses deterministic development actions without taking over normal
  Copilot coding requests
- **Cons:** Requires Windows, the PowerShell agent, and an agent-server version
  that supports request-scoped schema selection and command dispositions

Try a registered action:

```text
> @typeagent mode dev
> show top 5 memory hogs
```

To demonstrate flow creation, use a disposable read-only task:

```text
> learn: show the 3 newest .log files under <PATH>
> @typeagent run list powershell flows
> show the 3 newest .log files under <PATH>
```

The generated name and output can vary with the configured model. Dynamic
PowerShell scripts currently run in FullLanguage mode. Cmdlet and path policy
metadata does not prevent direct .NET access, so do not treat generated or
imported flows as securely sandboxed.

**Switch modes:**

```
> @typeagent mode direct    # fastest, skips LLM
> @typeagent mode mcp       # streaming, uses LLM
> @typeagent mode dev       # PowerShell flows first, Copilot on misses
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

| Variable                    | Default                           | Description                                                                      |
| --------------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `TYPEAGENT_MODE`            | `direct`                          | `direct`, `mcp`, `dev`, or `bypass`                                              |
| `TYPEAGENT_HOST`            | `localhost`                       | TypeAgent server host                                                            |
| `TYPEAGENT_PORT`            | `8999`                            | TypeAgent server port                                                            |
| `TYPEAGENT_PLUGIN_DATA`     | `~/.typeagent-copilot`            | Config directory                                                                 |
| `TYPEAGENT_WORKSPACE_ROOTS` | Copilot process working directory | Approved roots for workspace MCP tools, separated by the platform path delimiter |

---

## Plugin Components

### Hooks (`hooks.json`)

| Hook                  | File                 | Purpose                                                      |
| --------------------- | -------------------- | ------------------------------------------------------------ |
| `userPromptSubmitted` | `hook-router.js`     | Route action requests to TypeAgent or Copilot                |
| `agentStop`           | `hook-agent-stop.js` | Track Copilot interactions in TypeAgent history              |
| `postToolUse`         | `hook-post-tool.js`  | Track Copilot tool results in TypeAgent history              |
| `preToolUse`          | `hook-powershell.js` | Inject TypeAgent PowerShell guidance for PowerShell commands |

### MCP Servers (`.mcp.json`)

The plugin starts three logical MCP servers from the same bundled entry point and
single-file release executable:

| Server                | Tool                       | Description                                                                             |
| --------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| `typeagent`           | `typeagent-processCommand` | Send a command to the TypeAgent agent-server                                            |
| `typeagent`           | `typeagent-listAgents`     | List available TypeAgent agents                                                         |
| `typeagent`           | `typeagent-getStatus`      | Get TypeAgent server status                                                             |
| `typeagent-workspace` | `read`                     | Read bounded text under approved workspace roots                                        |
| `typeagent-workspace` | `glob`                     | Find bounded, deterministically ordered workspace files                                 |
| `typeagent-workspace` | `grep`                     | Search bounded workspace text                                                           |
| `typeagent-workspace` | `fetch`                    | Fetch bounded public HTTP(S) text without ambient credentials or private-network access |
| `typeagent-macros`    | `list_macros`              | List and search reusable captured procedures                                            |
| `typeagent-macros`    | `run_macro`                | Replay an approved macro or return an agent-runner handoff                              |
| `typeagent-macros`    | lifecycle tools            | Capture-derived draft validation, approval, disablement, and candidate submission       |

Workspace tools are available in direct, MCP, and dev modes. In bypass mode
they remain discoverable because Copilot fixes the MCP catalog when the session
starts, but calls return a disabled error. This makes `@typeagent mode` changes
take effect without requiring tool re-registration or a Copilot restart.

### Macro mode

Macros do not add a fourth routing mode. Direct, MCP, and dev describe ownership
of the root user prompt, while deterministic workspace tools are capabilities
that may be used by a macro in any of those modes. A separate macro mode would
couple tool availability to a catalog that was already registered at session
startup and would become stale after `@typeagent mode` changes.

The hooks therefore behave as follows:

- `userPromptSubmitted` keeps its existing direct/MCP/dev routing behavior;
- `postToolUse` records workspace MCP calls because they execute in the plugin,
  not in agent-server;
- `agentStop` does not classify a workspace-only turn as already handled by
  TypeAgent, so the completed Copilot turn remains available to history and
  future trace induction; and
- `preToolUse` keeps its existing PowerShell guidance policy.

The workspace MCP server is local to the plugin and does not require
agent-server. Agent-server receives bounded tool and turn history from the
hooks and owns macro recording state, catalog management, validation,
immutable approval, replay orchestration, handoff records, and persisted run
evidence.

### Agents (`agents/`)

- `typeagent.agent.md` — Sub-agent that delegates action requests to TypeAgent via MCP tools
- `typeagent-macro-runner.agent.md` — Executes an entire agent-required macro
  through Copilot's live tools and permissions

### Skills (`skills/`)

- `typeagent-setup/` — Interactive skill to configure integration mode and server connection
- `typeagent-macros/` — Discovers, validates, runs, and adapts TypeAgent macros

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

| Issue                        | Cause                                                                   | Fix                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `copilot` not found          | Copilot CLI not installed                                               | Install GitHub Copilot CLI and verify with `copilot --version`                              |
| Dev action falls through     | Request was unsuitable, PowerShell is unavailable, or mode is not `dev` | Check `@typeagent status`, Windows platform, agent-server, and the PowerShell agent         |
| TypeAgent connection refused | Server not running                                                      | Start TypeAgent server (`pnpm run start:agent-server`)                                      |
| Hook timeout                 | TypeAgent slow to respond                                               | Increase `timeout` in `hooks.json` or use MCP mode                                          |
| Recording does not complete  | The turn is still running or recording failed                           | Run `@typeagent macro status`; re-arm after a failed or expired recording                   |
| Macro will not run           | Version is not approved or a feature boundary is disabled               | Inspect the macro state and the macro flags shown by `@typeagent status`                    |
| Replay fails before step one | Required input, tool, or approved schema no longer matches              | Inspect requirements and the structured replay error; revalidate or create a reviewed draft |
| SQLite experimental warning  | Node 24 feature                                                         | Normal — can be suppressed with `--no-experimental-warnings`                                |

---

## Architecture Reference

During development, the runtime implementation lived in `D:\repos\copilot-agent-runtime`.
The key runtime hook behavior change was in:

- **`src/core/hooks.ts`** — Added `handled`, `responseContent`, `handledBy` to `UserPromptSubmittedHookOutput`
- **`src/core/session.ts`** (~line 7473) — Added handler that checks hook output and emits an assistant message directly, bypassing `runAgenticLoop()`

This allows any `userPromptSubmitted` hook to fully handle a request and return a response without the LLM being invoked.

See the repository's
[Copilot fast actions plan](../../docs/plans/copilot-fastActions/PLAN.md) for
the cross-package design and
[workflow architecture](../../docs/architecture/workflows/workflows.md) for
TypeAgent's common flow model.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
