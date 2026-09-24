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
  +-> mcp delegate (default): Copilot calls typeagent-processCommand
  |
  +-> mcp mixed: Copilot chooses whole-request delegation or owns the task
  |              and prefers structured TypeAgent tools for operations
  |              (native tools only when no suitable capability is available)
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

## Guarded GHCP evaluation harness

The `scripts/ghcp-eval*.mjs` tools run actual Copilot SDK conversations for seven
MCP/native routing candidates and twenty cases (four five-case cohorts). They
are separate from the discovery smoke launcher below. Build the plugin and
agent-server dependencies first; run script tests with `pnpm test:ghcp-eval`
from this package.

The harness requires an existing reconciled credit ledger, an authenticated
Copilot executable, and an existing TypeAgent model-configuration directory.
It never creates a fresh spending allowance or fetches credentials. The ledger
includes opening parent/implementation usage, reporting headroom, and a
catalog-verified conservative maximum reservation per model request. The
request proxy admits before forwarding, settles explicit Copilot billing
fields, retains unknown charges, rejects other models/WebSockets, and limits
each scoped session to 24 requests and the cumulative ledger to 2,000 requests.
The SDK's 60-credit session limit is only an additional **soft** limit.
This is not a general-purpose pricing service: verify the model's current
credit rates and maximum context/output bounds before constructing a ledger.

From `ts`, invoke:

```text
node packages\copilot-plugin\scripts\ghcp-eval-preflight.mjs <new-preflight-dir> <model-config-dir> <ledger> --external-evidence
node packages\copilot-plugin\scripts\ghcp-eval.mjs <copilot.exe> <preflight-dir> <run-dir> <model-config-dir> <ledger> <candidate-ids> pilot <oracle.json> <case-ids>
node packages\copilot-plugin\scripts\ghcp-eval.mjs <copilot.exe> <preflight-dir> <run-dir> <model-config-dir> <ledger> 1,2,3,4,5,6,7 measured <oracle.json> S1 <batch-start> 7 1
```

Use a nonsynchronized local directory for live databases/locks. Preserve
sanitized results, the frozen specification, and the cumulative ledger in
durable storage. Measured batches contain one paired case across all seven
candidates; advance the zero-based start by seven only after reconciliation.
One complete balanced pass contains 140 trials; freeze additional repetitions
only when the reconciled allowance permits them. A changed specification or a mismatched
persisted trial count blocks resumption instead of replaying uncertain work.
The oracle JSON pins public issue/PR evidence and a relative `readinessFile`
pointing to the successful preflight result.

The four domain agents are lists, GitHub CLI, registered PowerShell file
actions, and IP configuration. Fixtures are restored per trial. Shipped MCP
domain schemas outside that scope are disabled only in the disposable
session. The production internal reasoning toolset is unchanged. The
mixed candidates keep production routing guidance and the pinned native tools.
Auxiliary outer workspace/macro/skill MCP servers are omitted to keep the
declared entry interfaces in scope. After failed or uncertain execution,
the eval policy blocks replay (including internal error-triggered retries);
it does not repair the underlying product failure or substitute an action.
These controls are identical across the relevant candidate pairs. The
`translationReasoningFallback` request option controls only the existing
unknown/clarification translation-to-reasoning transition, not ordinary
orchestration. Optional `TYPEAGENT_GHCP_EVAL_TRACE` records its actual decision,
entry, and outcome. No global configuration or shared service is modified.

**`completed_ungraded` is not task success.** Final-answer faithfulness must
be reviewed against the independent fixtures/external evidence after timing.
Network answers and raw evidence remain in clearly named private local files;
sanitized results contain hashes. Unobserved internal stage durations are
null, not zero. Keep pilot/harness failures separate from measured outcomes,
and do not pool fast refusals with successful-completion latency.

## Structured actions in Direct and MCP modes

### One-command discovery E2E session (Windows)

From the repository root in PowerShell:

```powershell
Set-Location .\ts
pnpm copilot:discovery
```

Run the commands below from `ts`. Changing directory first lets Corepack find
the pinned pnpm version; `pnpm -C ts` from the repository root can instead try
to fetch a default version before pnpm processes `-C`.

The launcher incrementally builds the plugin, agent server, and their transitive
dependencies using Fluid Build's `--dep` option, without selecting unrelated
workspace packages. It stages a session-local plugin
snapshot, starts a disposable server on port 9024, checks the real MCP connection,
then opens interactive Copilot in a new Windows console, leaving the printed
prompt visible in the original PowerShell window. Paste that prompt into Copilot
to discover the list-inventory action and execute it. Answer any required confirmation yourself.
Afterward, ask Copilot to repeat the action without rediscovery. Exit Copilot to
stop the owned server process tree; the original window waits for Copilot and
propagates failures. Ctrl+C in the original window also stops the owned Copilot
window/process tree and server. Use `--same-window` to keep Copilot in the original
console. The launcher currently supports Windows only.

This is a **controlled discovery session**: the normal initial-prompt routing
hook uses bypass mode, while a separate `typeagent-e2e` MCP process uses MCP mode.
Existing TypeAgent MCP registrations are disabled only for this CLI invocation.
No global mode settings change. Default MCP delegate-policy user prompts still use
`processCommand`; this launcher is not a routing optimization or benchmark.

**How discovery is triggered:** in interactive mode, the startup check only lists
MCP tools and calls `typeagent-getStatus`. It does not search actions or submit
a prompt for you. After you paste the printed prompt, Copilot is asked to call
`typeagent-searchActions` through `typeagent-e2e`, choose an action from the
returned contracts, and call `typeagent-executeAction` with its scope, exact
identity, and parameters. The query and tool calls are chosen by Copilot, not
hardcoded by the launcher. Confirmation still requires your actual answer.
The server uses the same TypeAgent action discovery implementation as other
structured callers; no separate catalog or ranking logic is added here.

With `--smoke-test`, the script instead calls
`typeagent-searchActions({ query: "listLists" })` directly through the MCP SDK
and checks that `list.listLists` is returned. That verifies the real
MCP-to-TypeAgent discovery connection, **not Copilot's reasoning or selection**.
It never launches Copilot, opens another console, or executes an action.

Prerequisites: Windows, Node 22+ with npm, pnpm, a native Copilot CLI executable on
PATH (already signed in), and existing TypeAgent model/embedding configuration.
The launcher does not obtain credentials, change Azure accounts, or copy files
from another checkout. Build/install requires a provisioned `ts\.npmrc`.

```powershell
# First checkout: explicitly restore dependencies before building.
pnpm copilot:discovery --install-dependencies

# Repeat with existing builds and an already-provisioned config directory.
pnpm copilot:discovery `
  --skip-build --config-dir 'C:\TypeAgent config' --port 9025

# Noninteractive check: real MCP catalog + discovery, NO action execution.
pnpm copilot:discovery --skip-build --smoke-test

# Optional: also update the global plugin using the existing registrar.
pnpm copilot:discovery --install-plugin
```

`--model <model>` selects the Copilot model; otherwise the CLI uses its normal
default. `--startup-timeout <seconds>` controls the server listener wait
(default 120); MCP connection/probe calls have separate bounded timeouts.
`--config-dir` sets `TYPEAGENT_CONFIG_DIR` for child processes; without it,
existing configuration resolution applies.

The worktree must have its own model configuration; building the code does not
provision it. If startup reports `Missing ApiSetting: AZURE_OPENAI_ENDPOINT`,
pass `--config-dir` for an existing configuration directory, or provision
`ts\config.local.yaml`. This can mean no configuration was loaded, not that you
need to add an Azure endpoint when using a different provider. The launcher
does not automatically use another checkout's configuration or fetch keys.

Each invocation prints a fresh temporary run directory containing `mcp.json`,
`prompt.txt`, `probe.json`, server stdout/stderr logs, `copilot-logs`, the staged plugin, and
disposable user data. These are retained for inspection, not deleted on exit.
New-window launches also record console handles, owned process IDs, and the
actual child exit or startup error in `console-status.json`. If no window appears,
the launcher reports missing child completion rather than assuming success.
`probe.json` contains catalog/discovery evidence, not a Copilot transcript;
use Copilot's `/share` command to save the interactive tool timeline.
The smoke-test binding is closed and must not be reused by another session.

An occupied port causes an error rather than reusing or stopping its owner.
For startup/configuration failures, inspect the printed server logs. If optional
global registration fails with Windows `EPERM`, close other Copilot sessions
holding the installed directory and retry; the default local snapshot needs no
global registration. Only the launcher's child processes are stopped.

The bundled manifests now classify 25 audited actions across eight agents as
read-only, including `list.listLists` and `list.getList`. These skip the
structured dispatcher's outer effect-confirmation prompt unless confirmation
is explicitly required. Unknown/state-changing policies still require
confirmation. Authorization, readiness, validation, and handler questions still
apply; read-only does not mean every interaction is bypassed.
Restart the agent server after rebuilding so it loads the updated manifests;
an already-running discovery session retains its previously loaded policy.

Run launcher regression checks with
`npm run test:e2e-launcher` from `ts\packages\copilot-plugin`.

### Routing and tool contracts

**In MCP mode, TypeAgent is the preferred action provider.** Copilot owning
the reasoning does not mean using native tools for the operations underneath
it. For example, Copilot can compare PRs and recommend smoke tests while using
TypeAgent to read PR details and changed-file lists, rather than native GitHub
tools, `gh`, or direct web/API requests.

In mixed policy, reuse an existing suitable action contract or discover one
before selecting a native tool. Refine unrelated discovery results before
concluding that no suitable TypeAgent capability is available. Native tools
are fallback only for an established capability gap; explain that gap and
preserve the user's scope and permissions. Reasoning and explanation without
an external operation do not require a TypeAgent call.

Delegate policy still sends the user's intact request to `processCommand`
first, without a structured-discovery stage. Native fallback requires an
explicit unsupported-capability result before any action executes. Errors,
partial results, connection failures, denials, cancellation, and uncertain
delivery do not authorize repeating an action through native tools or another
provider. Recording directives always stay with TypeAgent.

These are routing instructions, not removal of native tools or a runtime
permission gate. PowerShell reminders apply even to commands such as `gh`,
`git`, and scripting runtimes in MCP mode; Direct mode's existing command
exemptions and dev/bypass behavior are unchanged.

There are two intentional entry paths:

- **User-originated natural language:** ordinary Direct prompts still go through
  the hook and TypeAgent intent resolution. In MCP delegate policy the hook sends
  the user's exact request to `typeagent-processCommand`. Mixed policy preserves
  this path for user requests delegated intact to TypeAgent, while allowing
  Copilot to own broader tasks. Preserve `learn:`, `dev:`,
  `record:`, and `dev: learn:` exactly. Do not replace them with typed calls.
- **Copilot-selected actions with concrete inputs (MCP mixed routing, or Direct's
  structured bridge):** fixed MCP tools call the
  real shared Dispatcher structured-action interface. They do not build command
  strings, parse contracts, hash schemas, determine effect policy, or translate
  natural language locally.

The structured sequence is **search complete action contracts -> execute**,
not the default MCP delegate routing policy. In MCP mode, only mixed policy
steers Copilot-selected steps to this path. Structured tools remain available
under delegate policy; tool availability is not a routing instruction.
Search requires one free-text `query` and returns `protocolVersion`, `scopeId`
and `actions`: complete contracts with exact identities, closed TypeScript input
schemas including referenced types, policy, outputs and interactions. The shared
service uses its semantic top-five ranking when available, or literal matching
when ranking is unavailable. The adapter does not rank or truncate results.
A current contract can be reused within its binding without another search.
`getStatus` and `listAgents` remain available but are not prerequisite stages.
If an identity or input remains unresolved ("it", "that one"), clarify with the
user or use the natural-language path rather than guessing.

| Tool                       | Input / behavior                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `typeagent-searchActions`  | Required nonempty `query`; complete candidate contracts and the binding scope                                 |
| `typeagent-executeAction`  | `protocolVersion`, `scopeId`, exact `schemaName` and `actionName`, optional typed `parameters` object         |
| `typeagent-continueAction` | `protocolVersion`, `scopeId`, `operationId`, `interactionId`, and the actual user's typed `response`          |
| `typeagent-cancelAction`   | `protocolVersion`, `scopeId`, `operationId`, and optional exact `interactionId`; cancel at the user's request |

Lists, IDs, paths, Unicode, quotes and newlines remain JSON values, not command
arguments or prose. The shared service owns contract generation, exact-match
validation, enabled/readiness checks, permission scope, effect confirmation,
execution and single-use interaction state. Unknown and state-changing effect
policy requires user confirmation; only explicitly read-only policy can be
exempt (agents can still ask questions). Choosing an action is not user consent.
Discovery neither enables an action nor authorizes execution.
Execution resolves the exact identity internally, independently of the latest
search ranking, and rechecks current schema, parameters, scope, visibility,
active state, readiness, authorization and confirmation policy before effects.
There is no public single-contract lookup, fingerprint, or stale-contract
status. Removed actions return `unavailable`; invalid current parameters return
a validation failure. A prior search result is not execution approval.

### A reachable Direct structured bridge

Direct's `userPromptSubmitted` hook is a **one-shot natural-language process**,
not a structured protocol endpoint. The existing long-lived `typeagent` MCP
server therefore exposes the four structured tools in **both Direct and MCP
modes**, and calls the same transport-neutral `StructuredActionClient` /
Dispatcher interface. This is the Direct structured caller; it is not a claim
that Copilot can inject structured requests into the one-shot prompt hook.
Except for explicit cancellation, tool calls are rejected in dev/bypass modes
before connecting. Mode is checked per call because the MCP catalog remains
registered when a mode changes.
Workspace and macro server registrations and their mode behavior are unchanged.

`StructuredActionClient` is a public export of
`@typeagent/agent-server-client`, shared with other consumers such as command
executor. The plugin wrapper only supplies its URL, public conversation ID,
ClientIO and unique conversation name. The shared client exposes the four
Dispatcher-shaped methods (with an optional `AbortSignal`), `close()`, and
public `binding` metadata. A `StructuredActionClientError.dispatched` flag
distinguishes a pre-dispatch failure from uncertain delivery; raw transport
exceptions and private resume capabilities are never exposed. The exported
`StructuredActionClientErrorReason` supplies a safe `reason`, preserved in tool
errors instead of flattening resume rejection into `transport_error`.
`resume_rejected` means the host rejected the capability; the host intentionally
does not distinguish invalid/wrong-conversation, expired, or restarted/lost
state. `resume_failed` reports an unclassified failure to resume the same owner.
Neither result permits a replacement owner or automatic replay.

### Results and actual user interaction

Every shared-service result is returned intact as MCP `structuredContent`,
with readable, untruncated JSON in `content`. Actual nested `ActionResult`
values, `resultEntity`, `entities`, IDs, display content, collected output and
child results are retained. Text output is not treated as the action's data.

Execution has six distinct statuses: `completed`, `failed`, `cancelled`,
`requires_interaction`, `unavailable`, `execution_uncertain`.
Pending interactions are not MCP tool errors: `completed`, `requires_interaction`
and successful searches omit `isError`; unsuccessful terminal results set
`isError: true` while preserving the complete service envelope.
Responses also include public `binding` metadata (conversation ID and connection
state), never the private resume capability.
Connection/caller failures use a separately marked `source: copilot-transport`
error result rather than fabricating a service operation ID. Once a call has
been dispatched, lost delivery is `execution_uncertain`; no effect is replayed.

For `requires_interaction`, display the full `prompt` (all choices, form fields
and field IDs), keep `operationId`, `interactionId`, `expiresAt` and `scopeId`,
then **ask the USER and wait**. Submit only their answer to `continueAction`.
Supported response types are `confirmation`, `question`, `yesNo`, `multiChoice`,
`pickRemember`, `form` and `proposal`. Form answers are keyed by the exact field
ID. A new prompt requires a new user answer. Never use a displayed default,
invent form answers, autoapprove, or direct the user to an inaccessible Shell.
Use `cancelAction` with the returned IDs if the user wants to stop.
Cancellation remains available after switching to Dev or Bypass mode; new
execution and continuation remain disabled there. Switching mode never supplies
an answer or implies that pending work was cancelled.

On a validation or availability failure, reassess the current action and inputs
before constructing a new request; **no automatic replay**. On timeout,
disconnect or uncertain execution, effects may already have happened. Surface
that uncertainty and do not rerun the effect call. The service supports typed
flows through its guarded executor; **raw PowerShell flow steps are unsupported**
on this structured path. Do not present an unsupported flow as completed.

Two legacy setup-capable actions are also unsupported on the structured path:
`system.config.toggleAgent` and `system.config.enterAgentPriorityMode`. Their
unquoted argument bridges can enter agent setup, so their candidate descriptions
explain this limitation and execution rejects them before handler entry. Other
deterministic internal command bridges remain supported. A runtime guard also
rejects unsupported nested setup before invoking agent setup hooks. Ordinary
natural-language routing, including legacy setup choices, is unchanged. A
guarded failure, including one crossing agent RPC, retains the authoritative
service status such as `failed` or `unavailable`; do not reinterpret it
as completion or retry it through a command string.

The legacy natural-language ClientIO cannot continue its prompts through these
structured tools. It no longer supplies default answers, and reports collected
pending prompts/unsupported interaction rather than pretending completion.

### Explicit binding, reconnect, and trust

NL and structured calls use the same conversation selection in every routing
mode. With no explicit ID, the first caller resolves the server default and
saves its **concrete conversation ID** under the plugin data directory's
`conversation-bindings` folder, keyed by server URL. Later hooks, MCP processes,
and reconnects reuse that ID even if the server default changes. Concurrent
first callers atomically adopt the same saved ID. Routing mode does not change
which conversation data is visible.

This is shared plugin/server context, not one conversation per Copilot chat:
stdio does not provide an intrinsic Copilot session identity. Sessions using the
same plugin data directory and server share the saved default, as NL callers
already shared the server default. Separate plugin data directories or explicit
IDs select separate context.

The two routes keep separate connections. Structured calls explicitly join the
selected ID with `structuredActions: {}` to obtain an independent owner; the
saved binding contains only the public conversation ID, never approval state
or a resume capability. All four structured operations share that process's
owner and connection attempts are singleflight.

To intentionally use a known conversation, set `TYPEAGENT_CONVERSATION_ID`, or
set public `conversationId` in the plugin `config.json`. Environment wins over
config. The ID must exist: an explicit failed join does not silently fall back to
another conversation. An explicit ID selects context, **not** a prior owner's
authority. The setting applies to NL and structured calls in every mode. A
bound structured client refuses new calls if the selected ID changes instead
of continuing against a different conversation from NL. Close active sessions
before changing selection, then start fresh sessions; pending work is not
automatically moved or replayed. Two fresh processes using the same public ID
still get isolated structured owners.

A missing/deleted conversation or an unreadable/corrupt saved binding is an
error, not a reason to silently choose a new default. To select another existing
conversation, configure its ID. To intentionally resolve the default again,
close sessions, remove only the matching server's saved binding file, and start
fresh sessions with no explicit ID. Configuration fields such as selected
skills are not rewritten when the default ID is saved.

The server's structured resume token is retained only in private volatile
connector memory. It is never logged, printed, persisted, put in config, or sent
to Copilot. On reconnect the connector reuses the **same conversation ID and
token**, preserving scope and pending service operations. It never creates a
replacement owner if resume fails. If the initial join reply is lost, it fails
closed because it cannot recover a capability it never received. Transport
exceptions are not echoed since they could contain join arguments.

A server restart, expired/lost state, deleted conversation or new MCP process
can make continuation unavailable. Shutdown disconnects; it does not assert
cancellation, rollback or completion of pending work. A lost operation reply
without an operation ID cannot be safely continued by guessing one. No automatic
effect retry is provided.

Public conversation IDs, operation/interaction IDs and `scopeId` are binding
metadata, not credentials. The server retains its existing **unauthenticated
loopback host trust model**, not a multi-user ACL or a remote-authentication
boundary. Do not expose this endpoint to untrusted network clients.

See the [canonical structured-action design](../../docs/plans/copilot-direct-actions/director-actions.md).

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

The global install is a **snapshot copy**, not a live reference. Switching
repository branches does not update it. After editing the plugin, rebuild with
its dependencies and refresh the global copy from `ts`:

```powershell
pnpm exec fluid-build '^@typeagent/copilot-plugin$' -t build --dep
pnpm --filter @typeagent/copilot-plugin run register
copilot plugin list
```

Start a fresh Copilot session after installation to load the updated extension
and MCP tools. Existing sessions are not guaranteed to reload those assets.
If `@typeagent mode mcp mixed` prints "Processing command..." or reaches
TypeAgent's natural-language dispatcher, check for an old installed snapshot:
the current plugin consumes valid and invalid mode arguments locally, without
an agent-server connection. A downstream translation error is not evidence
that mode selection requires natural-language dispatch.

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

Copilot-selected typed calls use the persistent MCP structured bridge described
above; this does not reinterpret or alter the user prompt hook.

- **Pros:** Fast (~1-3s), no LLM tokens consumed
- **Cons:** No streaming output, response is returned all at once

### MCP Mode

MCP mode has two routing policies. **Delegate** is the backward-compatible
default: the hook instructs Copilot to call `typeagent-processCommand` with the
original request and present the complete result. TypeAgent's MCP server streams
progress notifications to the CLI timeline. Delegate policy does not steer
subsequent Copilot-selected steps to discovery/direct calls; that guidance
belongs only to mixed policy. Both policies retain the same structured tools
and permission checks.

**Mixed** lets Copilot judge whether to delegate the request intact or own the
task. It does not classify prompts deterministically or force discovery first:

- "Show my lists" or "Create a list and add these three items" delegates through
  `processCommand`, even when TypeAgent performs several actions.
- "Review this diff, identify missing tests, and track the resulting work in a
  list" stays with Copilot for the review. TypeAgent steps Copilot selects use
  `searchActions` and `executeAction` with concrete inputs.
- Ordinary explanations and coding tasks need not invoke TypeAgent.

```text
@typeagent mode mcp mixed
@typeagent mode mcp delegate
@typeagent mode
@typeagent status
```

Native extension commands `/typeagent-mode mcp mixed`,
`/typeagent-mode mcp delegate`, and `/typeagent-status` expose the same settings.
Plain `mode mcp` preserves the saved policy; absent policy defaults to delegate.
Other modes ignore the policy but preserve it for the next switch to MCP.
Commands take effect on subsequent prompts without restarting an up-to-date
plugin; installing updated plugin assets requires a fresh Copilot session.
Settings persist
in the plugin config and are **shared by sessions using that config**, not
session-local. `TYPEAGENT_MODE` still overrides the saved top-level mode; commands
report when that prevents the selected mode from taking effect.

Recording directives keep the exact natural-language path in both policies.
`@typeagent run <request>` remains an explicit direct TypeAgent override.
Mixed Windows PowerShell guidance follows the same ownership distinction rather
than redirecting Copilot-selected steps back through `processCommand`.
Confirmation, permission, and uncertain-execution handling are unchanged;
switching policy never authorizes an action or retries it.

MCP tool titles identify the **actual route** in Copilot's tool cards:

```text
TypeAgent: Natural-language delegation
TypeAgent: Structured discovery
TypeAgent: Structured execution
```

These are tool metadata, not model reasoning or a predicted route. They apply
in both policies without adding tool calls, output text, or an extension
dependency. Continuation/cancellation tools are labeled too. A card identifies
the invoked tool, not whether an action succeeded: consult its actual result
for `requires_interaction`, failure, or completion. Clients that display tool
names instead of titles still show the exact method name. Direct-hook requests
such as `@typeagent run` do not produce MCP tool cards. Tool response envelopes
remain unchanged. Restart an existing client after updating the plugin to reload
tool titles.

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
> @typeagent mode mcp mixed # Copilot chooses delegation or orchestration
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
  "mcpRouting": "delegate",
  "powershell": {
    "enabled": true
  }
}
```

**Environment variable overrides** (take precedence over config file):

| Variable                    | Default                            | Description                                                                                      |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `TYPEAGENT_MODE`            | `direct`                           | `direct`, `mcp`, `dev`, or `bypass`                                                              |
| `TYPEAGENT_HOST`            | `localhost`                        | TypeAgent server host                                                                            |
| `TYPEAGENT_PORT`            | `8999`                             | TypeAgent server port                                                                            |
| `TYPEAGENT_CONVERSATION_ID` | Dedicated per-process conversation | Optional existing public conversation ID for structured tools; overrides config `conversationId` |
| `TYPEAGENT_PLUGIN_DATA`     | `~/.typeagent-copilot`             | Config directory                                                                                 |
| `TYPEAGENT_WORKSPACE_ROOTS` | Copilot process working directory  | Approved roots for workspace MCP tools, separated by the platform path delimiter                 |

---

## Plugin Components

### Hooks (`hooks.json`)

| Hook                  | File             | Purpose                                       |
| --------------------- | ---------------- | --------------------------------------------- |
| `userPromptSubmitted` | `hook-router.js` | Route action requests to TypeAgent or Copilot |

### Extension (`extensions/typeagent/extension.mjs`)

The plugin extension registers `/typeagent-status`, `/typeagent-mode`, and
`/typeagent-macro-record`. It consumes typed Copilot session events to capture
macro traces and TypeAgent history, injects PowerShell guidance with an
`onPreToolUse` hook, and emits turn-completion state for the demo driver.

### MCP Servers (`.mcp.json`)

The plugin starts four logical MCP servers from the same bundled entry point and
single-file release executable:

| Server                | Tool                                 | Description                                                                                     |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `typeagent`           | `typeagent-processCommand`           | Send a command to the TypeAgent agent-server                                                    |
| `typeagent`           | `typeagent-listAgents`               | List available TypeAgent agents                                                                 |
| `typeagent`           | `typeagent-getStatus`                | Get TypeAgent server status                                                                     |
| `typeagent`           | four structured-action tools         | Search complete contracts, execute, continue, and cancel through Dispatcher in Direct/MCP modes |
| `typeagent-workspace` | `read`                               | Read bounded text under approved workspace roots                                                |
| `typeagent-workspace` | `glob`                               | Find bounded, deterministically ordered workspace files                                         |
| `typeagent-workspace` | `grep`                               | Search bounded workspace text                                                                   |
| `typeagent-workspace` | `fetch`                              | Fetch bounded public HTTP(S) text without ambient credentials or private-network access         |
| `typeagent-macros`    | `list_macros`                        | List and search reusable captured procedures                                                    |
| `typeagent-macros`    | `run_macro`                          | Replay an approved macro or return an agent-runner handoff                                      |
| `typeagent-macros`    | lifecycle tools                      | Capture-derived draft validation, approval, disablement, and candidate submission               |
| `typeagent-skills`    | `typeagent-listSkills`               | List local immutable skill package revisions                                                    |
| `typeagent-skills`    | `typeagent-searchSkills`             | Search the local catalog by exact name or origin-qualified identity                             |
| `typeagent-skills`    | `typeagent-getSkill`                 | Get revision metadata and its complete file manifest                                            |
| `typeagent-skills`    | `typeagent-previewProcedureArtifact` | Preview a skill or macro artifact from a saved procedure without changing state                 |
| `typeagent-skills`    | `typeagent-promoteProcedureArtifact` | Generate and publish a skill draft or macro from a saved procedure                              |
| `typeagent-skills`    | `typeagent-previewSkillAcquisition`  | Validate and preview a directory, Git, or archive source without publishing                     |
| `typeagent-skills`    | `typeagent-checkSkillUpdate`         | Check whether a source differs from its catalog revision without publishing                     |
| `typeagent-skills`    | `typeagent-acquireAndPublishSkill`   | Acquire a source and publish its validated package as a draft                                   |
| `typeagent-skills`    | `typeagent-updateSkill`              | Reacquire a source and publish a changed draft revision                                         |

`typeagent-skills` implements the `io.modelcontextprotocol/skills` read
extension (`server/discover`, `skills/list`, and `skills/get`) and publishes
active catalog files as `skill://typeagent/...` MCP resources. Listings include
verbatim `SKILL.md` frontmatter plus complete SHA-256 resource manifests.
Resource discovery and reads are backed by the agent-server-owned local catalog
and never execute skills.

The preview and update-check tools are annotated read-only. Promotion,
acquisition, and update tools are explicitly annotated as mutating and publish
catalog or macro state. These six management tools are ordinary MCP tools only;
they are not added to `server/discover`, `skills/list`, or `skills/get`.

The plugin's SDK host can also create an isolated session from an explicit set
of catalog selections with `createApprovedSkillSession`. Omitted revisions
resolve through the server's active pointer; explicit revisions must be
`approved` or `active`. Before session creation, every file is downloaded into
a session-private temporary tree and checked against its manifest byte size and
SHA-256 digest. The SDK session disables configuration discovery, built-in
skills, plugins, file hooks, remote export, and the shared session store, and
receives only the selected materialized directories. Call `close()` (or use
`await using`) to disconnect the private SDK runtime and remove all staged
files. Materialization never invokes package hooks.

The live extension session uses the same materializer when `selectedSkills` is
present in the plugin `config.json` (shown by `/typeagent-status`), or when the
`TYPEAGENT_SELECTED_SKILLS` environment variable contains the equivalent JSON
array. The environment value takes precedence. For example:

```json
{
  "mode": "direct",
  "selectedSkills": [
    {
      "identity": {
        "scope": "project",
        "origin": "C:/src/project",
        "name": "calendar"
      },
      "revision": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  ]
}
```

When selections are configured, the extension verifies and stages them before
calling the SDK's `joinSession`, passes only those directories, and removes the
staging tree on join failure, normal close, process termination, or the SDK
`session.shutdown` event. With no selection, startup behavior is unchanged.

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

The plugin therefore behaves as follows:

- `userPromptSubmitted` keeps its existing direct/MCP/dev routing behavior;
- the extension records live workspace MCP calls because they execute in the
  plugin, not in agent-server;
- the extension preserves completed Copilot turns for history and future trace
  induction; and
- the extension applies the existing PowerShell guidance policy before tool
  execution.

The workspace MCP server is local to the plugin and does not require
agent-server. Agent-server receives bounded tool and turn history from the
extension and owns macro recording state, catalog management, validation,
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
