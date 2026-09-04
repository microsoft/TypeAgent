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
> @typeagent mode dev
> @typeagent powershell on
> @typeagent run list the playlists
```

### Step 5: Verify Verification in Copilot CLI

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

### Rollout Controls

Each macro boundary is enabled by default and can be disabled independently:

| Environment variable                    | Boundary                   |
| --------------------------------------- | -------------------------- |
| `TYPEAGENT_MACRO_RECORDING_ENABLED`     | Explicit trace recording   |
| `TYPEAGENT_MACRO_INDUCTION_ENABLED`     | Draft creation from traces |
| `TYPEAGENT_MACRO_REPLAY_ENABLED`        | Deterministic replay       |
| `TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED` | Agent-runner handoff       |

Set a variable to `0`, `false`, or `off` before starting Copilot to disable
that boundary. `@typeagent status` reports the effective settings. These flags
do not change direct, MCP, dev, or PowerShell mode selection.

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

The hook connects directly to TypeAgent over WebSocket. When TypeAgent recognizes and handles the request, the hook returns `{ handled: true, responseContent: "..." }` — Copilot skips the LLM entirely. TypeAgent still translates the prompt; what is skipped is Copilot's model.

- **Pros:** Fast (~1-3s), no LLM tokens consumed
- **Cons:** No streaming output, response is returned all at once

### MCP Mode

The hook injects a directive into the prompt context, instructing the LLM to
call TypeAgent's MCP tools. TypeAgent's MCP server streams progress
notifications to the CLI timeline.

There are two ways in.

**`typeagent-processCommand` is the default.** It sends the user's own words and
lets TypeAgent translate them. This is the right choice for anything a person
phrased, not just conversational or multi-step requests: TypeAgent caches
translations, so a phrase it has seen before resolves with no model call at all.
It is also the only path that honors `learn:` / `dev:` / `record:` directives.

**The typed-action shortcut exists for actions Copilot already holds.** In one
line: _a caller that already knows the action it wants can run it directly,
instead of writing a sentence for TypeAgent to translate back into the action it
started with._

The case that motivates it is agentic. The MCP servers are registered
independently of the prompt hook, so their tools stay in Copilot's catalog on
every turn of a multi-step loop — including steps Copilot planned itself, where
no user ever said anything. Previously the only way to run such a step was to
describe it in prose. That round trip costs a model call, and it can lose or
distort a parameter that was never ambiguous to begin with. Two tools cover it:

- `typeagent-executeAction` runs a single typed action by `schemaName`,
  `actionName` and `parameters`, skipping translation and TypeAgent reasoning.
- `typeagent-discoverActions` supplies the contract when it is not already
  known. It only reports agents and schemas whose actions the session has
  enabled, so anything it lists is runnable.

So what it buys is **determinism and fidelity for machine-composed steps** — a
structure the caller already holds reaches the dispatcher intact, schema
validated, with no interpretation step in between. What it does **not** buy is
speed on ordinary user requests, and it should not be sold as though it does; a
warm translation cache already answers those with no model call.

#### Which path a request takes

The deciding question is not what the request does, it is **where the request
came from**. Words the user typed go to translation. Structure Copilot is
already holding goes to the shortcut.

| The situation                                                     | Path                                | Why                                                       |
| ----------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------- |
| User types `play some jazz music`                                 | `processCommand`                    | The user supplied the phrasing; the cache likely knows it |
| User types something with a `learn:`, `dev:` or `record:` prefix  | `processCommand`, always            | Directives only work through translation                  |
| User asks something conversational, ambiguous, or multi-step      | `processCommand`                    | The dispatcher is better at this than Copilot guessing    |
| User phrased it and Copilot cannot name the action                | `processCommand`, **not** discovery | Translating is cheaper than a discovery round-trip        |
| Copilot composed the action itself as a step of a task it planned | `executeAction`                     | There is no user sentence to translate                    |
| Copilot already holds the schema, action and parameters           | `executeAction`                     | The lookup is already paid for                            |

A worked example. The user says "tidy up my desktop and put on some focus
music." That sentence goes to `processCommand` — the user wrote it, it is
multi-step, and TypeAgent decomposes it. Now contrast: Copilot is midway through
a longer task it planned itself, has already fetched the `player` contract for
an earlier step, and now needs to start a specific playlist as step four of six.
Nobody said that step out loud. Copilot calls `executeAction` with the schema
and parameters it is already holding, rather than composing an English sentence
for TypeAgent to parse back into the structure it just had.

The failure mode worth naming: seeing a user request, calling
`discoverActions` to find the matching action, then calling `executeAction`.
That is the most expensive route available and the guidance tells the model not
to do it. Discovery is for contracts that get reused, not for answering a
sentence the user already phrased.

#### When the shortcut is actually cheaper

Copilot's model runs either way — the hook has already given it the turn — so
choosing the shortcut costs no extra inference. A discovery round-trip does.

| Situation                              | Copilot turns | TypeAgent model calls |
| -------------------------------------- | ------------- | --------------------- |
| `processCommand`, phrase in cache      | 1             | 0                     |
| `processCommand`, phrase not in cache  | 1             | 1                     |
| `executeAction`, contract known        | 1             | 0                     |
| `discoverActions` then `executeAction` | 2-3           | 0                     |

A warm cache is unbeatable, so the rule is: when the user supplied the phrasing
and the contract is unknown, translating is cheaper than discovering — and the
injected guidance says exactly that. The shortcut earns its keep when the
contract is already in hand, or when there was no user phrasing to begin with.

Passing `naturalLanguage` populates the translation cache through the same
explanation pipeline a normal request uses, so a request served by the shortcut
still teaches TypeAgent the phrasing for next time.

#### How discovery scales

MCP's usual scaling failure is catalog bloat: expose N capabilities as N tools
and every tool definition sits in the model's context on every turn, whether or
not it is relevant. TypeAgent's action space is far too large for that. So the
action space lives _behind_ a tool rather than _as_ tools — this integration
adds exactly two, and that stays true whether TypeAgent exposes hundreds of
actions or many thousands. Discovery output is a tool result, so it enters
context only when something asks for it.

Discovery is tiered for the same reason, and there is deliberately no "list
every action" call — `agentName` is required before any actions come back:

| Call                       | Returns                                                 |
| -------------------------- | ------------------------------------------------------- |
| no arguments               | one line per enabled agent                              |
| `agentName`                | that agent's sub-schemas and actions, with descriptions |
| `agentName` + `actionName` | one action's TypeScript parameters                      |

Results are filtered to enabled schemas, so a session sees its active subset
rather than everything installed.

Neither tier is paginated, which is fine at present scale — the largest agent in
this repo exposes on the order of 80 actions — but it is worth knowing which
tier gives first. The per-agent listing grows with one agent's action count,
while the agent list grows with the number of enabled agents; the latter is the
one to watch, since a deployment is more likely to accumulate many agents than
to put many hundreds of actions on a single one. Either would need paging before
it reached that point.

#### Why discovery is live rather than prefetched

Discovery deliberately re-reads dispatcher status on every call instead of being
snapshotted once at startup. Which agents are enabled changes during a session,
so a cached catalog would eventually offer actions that `@action` then refuses —
the same class of mismatch the `actionActive` flag exists to prevent.

Prefetching would also have to live somewhere. Anything handed over at handshake
for the model to keep in mind ends up in the tool catalog or system context,
which is per-turn cost — the bloat this shape is built to avoid, just relocated.

That cost is better avoided than amortized, and for chained work it already is:
discovery is paid per chain, not per call. One lookup for an agent, then any
number of `executeAction` calls reusing that contract from context, which is
what the guidance means by reusing a contract and never re-requesting one
already held.

If discovery ever does become a bottleneck, the useful lever is latency rather
than context: every tool call currently opens and closes its own dispatcher
connection, which costs more across a chain than re-reading the catalog does.

#### Not the same as Direct Mode

The two are independent and pull in opposite directions. Direct Mode skips
**Copilot's** LLM and lets TypeAgent translate; the typed-action shortcut skips
**TypeAgent's** translation and lets Copilot's LLM choose the action. The
shortcut lives entirely inside MCP mode.

#### What the shortcut does and does not skip

It skips translation, not execution. It runs the dispatcher's `@action`
command, which uses the same `executeActions` engine as an ordinary request, so
enabled-action gating, chained multi-step actions, result-entity resolution,
action results recorded to memory, cancellation, and per-agent confirmation all
behave identically. Two differences are worth knowing:

- No prior-turn entity context is supplied, so references like "play it again"
  cannot be resolved — pass concrete parameters instead.
- Schemas that opt into `errorReasoning` are not retried through TypeAgent
  reasoning on failure; the error is returned to the caller, which is the
  reasoner in this arrangement.

Neither tool can answer an agent's follow-up question: this MCP client has no
return path for a choice or form. When an agent asks one, the tool reports the
pending question instead of reporting success, so the user can answer it in the
TypeAgent shell.

- **Pros:** Streaming output visible during processing, LLM-formatted responses;
  the typed-action shortcut avoids a translation round-trip for actions Copilot
  already holds or composed itself
- **Cons:** Slower (~3-5s), consumes LLM tokens

### Dev Mode

The hook asks TypeAgent to handle PowerShell actions first. Ordinary requests
are translated against the active `powershell` schema family, including static
`powershell.*` namespaces and registered dynamic flows, with reasoning disabled.
A miss falls through to Copilot without running TypeAgent reasoning.

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
- **Cons:** Requires an agent-server version that supports request-scoped schema
  selection and command dispositions

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

| Server                | Tool                        | Description                                                                             |
| --------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| `typeagent`           | `typeagent-processCommand`  | Default path: send the user's words for TypeAgent to translate                          |
| `typeagent`           | `typeagent-discoverActions` | List the enabled agents, their actions, and one action's TypeScript contract            |
| `typeagent`           | `typeagent-executeAction`   | Run a typed action Copilot already holds, skipping translation                          |
| `typeagent`           | `typeagent-listAgents`      | List available TypeAgent agents                                                         |
| `typeagent`           | `typeagent-getStatus`       | Get TypeAgent server status                                                             |
| `typeagent-workspace` | `read`                      | Read bounded text under approved workspace roots                                        |
| `typeagent-workspace` | `glob`                      | Find bounded, deterministically ordered workspace files                                 |
| `typeagent-workspace` | `grep`                      | Search bounded workspace text                                                           |
| `typeagent-workspace` | `fetch`                     | Fetch bounded public HTTP(S) text without ambient credentials or private-network access |
| `typeagent-macros`    | `list_macros`               | List and search reusable captured procedures                                            |
| `typeagent-macros`    | `run_macro`                 | Replay an approved macro or return an agent-runner handoff                              |
| `typeagent-macros`    | lifecycle tools             | Capture-derived draft validation, approval, disablement, and candidate submission       |

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
agent-server. Agent-server continues to receive bounded tool/turn history from
the hooks. Macro catalog, validation, promotion, and D1 orchestration remain
agent-server responsibilities when those provider components are added.

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
