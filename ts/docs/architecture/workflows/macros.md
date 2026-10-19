# Checked program macros

A macro saves a successful task as a reusable program with named inputs. TypeAgent
checks the program before saving it; only the current approved revision can run.

## Using macros

Enable learning with Prepare if you want to review each candidate before it is
approved. Read-only can publish validated candidates automatically when all tool
effects are classified as read-only. The preferences are described below.

To use a saved macro:

1. Find it with `search_macros` or `list_macros`.
2. Check its inputs with `get_macro_requirements`. Use `inspect_macro` if you
   want to review the program.
3. Call `run_macro` with its `macroId` and `inputs`, and optionally a `version`
   and `timeoutMs`. Dry runs are not supported.
4. Inspect the returned outcome. If the reply is lost or uncertain, use
   `get_macro_run` to check the run before doing anything else. Do not repeat the
   task through another tool: the first run may already have had effects.

In a configured host, a matching natural-language request can also run the current
approved macro. See the [plugin setup guide](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/copilot-plugin/README.md#tool-composed-macros)
for recording and learning commands.

## Macros and other workflows

Macros are different from [provider-owned flows](./workflows.md) and from the
[workflow DSL and IR design](./README.md). Copilot dev actions route Windows
PowerShell actions. They aren't a second macro executor.

Recorded steps and expressions provide authoring and audit evidence. Execution
uses the checked program, never a replay of those steps. Old development-only
records are discarded without migration.

## Learning and execution are separate

![A successful task supplies learning evidence; independently verified and compiled programs are published before grammar or explicit execution can run them.](./diagrams/macro-program-lifecycle.png)

[Full SVG](./diagrams/macro-program-lifecycle.svg) ·
[Editable scene](./diagrams/macro-program-lifecycle.excalidraw)

1. **Capture evidence.** For a native learning task, TypeAgent needs a
   token-bound root success receipt, followed by the final answer. An idle session
   or one successful business tool call isn't enough. The
   `typeagent_recorded_task_succeeded` tool records the caller's claim that the task
   worked. It doesn't judge whether the task was actually correct.
2. **Seal the context and queue a job.** The request, the output and the calls
   become a durable, scoped learning job. TypeAgent doesn't assume access to any
   hidden parent reasoning. The original answer doesn't wait for the macro to be ready.
3. **Author and check independently.** Candidate authors get the explicit context.
   The verifier writes specifications and fixtures without seeing the candidate's
   source, and the candidate never sees the verifier's private fixtures. Native
   author children have no business tools and can't delegate further.
4. **Compile and run the real executable.** TypeScript diagnostics, schema and
   capability checks, and fixtures gate publication. The fixtures cover the
   observed run plus changed inputs and fresh results. Passing doesn't prove the
   program is right in every case.
5. **Stage or publish.** The workspace's learning preference decides whether a
   validated candidate waits for review. If learning fails, you can inspect the
   failure. A failure never lets a draft run or the original interaction replay.
6. **Run the current approved revision.** Grammar matches and explicit calls both
   go to `MacroManager.runMacro`, which runs the stored code and doesn't start a
   planning child. An old approval is audit history. It can't route a call to a
   superseded version.

### Learning preferences

| Preference | What happens to a validated candidate                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Off        | No automatic learning, and pending learning is cancelled. Approved macros stay.                                               |
| Prepare    | The candidate is staged for you to review and approve.                                                                        |
| Read-only  | It is published automatically only if the host's inspected descriptors show read-only effects.                                |
| All        | It may be published automatically if it is a validated local candidate, within the supported broker and normal authorization. |

The current production brokers reject writes even when the preference is All.
Approving a publication never grants permission to use a tool or backend. Dynamic
PowerShell script authorization is a separate contract, and macro learning can't
bypass it.

### Waiting, interruption and readiness

Native contextual authoring uses durable requests, digests and leased replies.
The state `awaitingAuthor` means no compatible author has finished the required
phase yet. It doesn't mean the macro is ready, and it doesn't fall back to another
model. New user work can preempt the exact child that owns a job. The job's lease
stays recoverable. Turning learning Off, or cancelling explicitly, cancels pending
learning and rejects late submissions. Finished phases and independent verifier
responses are checkpointed so they survive a restart.

The launcher matches the exact child, prompt, result and native completion event.
A synchronous task RPC can return before the completion event arrives, so the
reply alone isn't enough. TypeAgent retires the exact completed child so its
context can't be reused, and it doesn't abort the parent session.

Clients that can't capture native context still use the TypeAgent-hosted
compatibility authoring path. A failed contextual job never silently switches to
that path.

## Choosing an owner

![TypeAgent-hosted and opt-in plugin-owned coordination use the same manager, compiler and contained runtime. Tools and model adapters remain outside the guest.](./diagrams/macro-runtime-ownership.png)

[Full SVG](./diagrams/macro-runtime-ownership.svg) ·
[Editable scene](./diagrams/macro-runtime-ownership.excalidraw)

| Owner                 | Coordination and storage                                                                                                                               | Tools and models                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typeagent` (default) | The agent server owns the manager, catalog, learning, publication, matching and runs.                                                                  | The first broker supports the read-only MCP tools TypeAgent can reach. The hosted model configuration supplies verification and declared semantics. Native callers can supply restricted author children. |
| `plugin` (opt-in)     | The joined native extension owns one manager per workspace and profile. Hooks, commands and macro MCP tools talk over authenticated session-local IPC. | Native reads and explicitly classified read-only MCP tools. Restricted task children write the source. Verification and semantic functions run on a separate installed native CLI.                        |
| `off`                 | Turns off recipe routing and learning. No other owner is chosen automatically.                                                                         | An accepted invocation is never repeated through another provider.                                                                                                                                        |

Both owners use the same authoring, compiler, runtime and publication rules.
Each keeps its own catalog.

The owner is chosen independently of three other settings:

- The plugin routing mode: `direct`, `mcp`, `dev` or `bypass`. Bypass turns off
  hook and MCP routing. A macro isn't a fourth routing mode.
- The learning preference: Off, Prepare, Read-only or All.
- Tool permissions and backend authorization.

`TYPEAGENT_RECIPE_OWNER` overrides the config key `recipeOwner`. To switch, run
`@typeagent recipe owner plugin` or `/typeagent-recipe-owner plugin`, then close
and restart the native session. Switching back to `typeagent` selects its own
stored data. Recipes aren't migrated or synchronized between the two.

For installation, exact config and rollback, see the
[plugin setup guide](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/copilot-plugin/README.md#checkpoint-c-plugin-owned-recipes).

### Plugin-local state and inference

State lives under the plugin data root, in `recipes/<workspace-profile digest>/`.
`TYPEAGENT_RECIPE_PROFILE_ID` defaults to `local-default`. A SQLite writer lock
needs Node 22.13 or later. If a second process tries to mutate the same scope, it
fails, so close the existing session before you move a scope to another process.
The operating system releases the lock after a crash, and TypeAgent never steals
a lock by checking PIDs. The old experimental SQLite catalog is left alone and not
migrated.

Macro MCP clients look up the native session, workspace and profile that is
actually registered. Their process may start in the plugin directory, which isn't
the recipe's workspace. Registration doesn't copy a catalog.

The standalone verifier and semantic adapter start fresh sessions with tools
disabled on a separate installed native CLI, using the normal CLI login. They
don't use same-process inference, inherited root context, ambient plugin, skill
or MCP discovery, TypeAgent config or API keys. The executable must be on `PATH`
or set by `TYPEAGENT_RECIPE_CLI_PATH` or `recipeInferenceCliPath`. There's no
shell fallback and no fallback to a bundled SDK runtime.

The standalone facade can refresh tool and MCP registry generations between
inference calls while keeping the owner identity. It fails if the account or
workspace changes, or the generation changes during an inference call. The
lower-level static-bound adapter is stricter. Events from child sessions alone
don't invalidate the root generation.

A copied plugin includes the TypeScript libraries, the QuickJS worker and WASM
files, licenses and asset hashes. The installed CLI is a separate requirement
from these bundled runtime assets.

## Execution, capabilities and failure

TypeScript source is compiled to a checked executable. It runs in a QuickJS/WASM
guest inside a worker, not in Node `eval`, `vm` or the `new Function` helper that
provider flows use. CPU and time, guest memory, stack, JSON size and broker calls
all have limits. The guest reaches the outside world only through declared
capability and semantic adapters, never through ambient process APIs.

- **Symbolic** programs make no model calls when they run again.
- **Hybrid** programs make only the semantic calls they declare, with bounds,
  through the configured provider. Results are schema-validated, calls can be
  cancelled, and model and token usage is recorded.

Capture, verification and publication may call models. Run time also depends on
tools, network access and permissions; measure the workload before assuming that
a macro will be faster or cheaper.

Before the program's first tool call, TypeAgent preflights every capability it
declares. If preflight fails, no program tools run. That doesn't freeze external
contracts for the whole run. The plugin broker supports `view`, `rg`, `glob` and
the exact read-only MCP tools listed in `recipeReadOnlyMcpTools`. Unknown effects,
writes, unsupported schemas and changed contracts all fail with an error.
Classifying a tool's effect **doesn't grant permission**. Native hooks, content
exclusions and the usual host and backend authorization still apply.

The optional TypeAgent action adapter runs in the same host. It swaps the recorded
protocol scopes and IDs for stable schema and action dependencies plus concrete
parameters. At run time it resolves fresh contracts and scopes, and it keeps the
completed `{ output, results }`. The action it calls must declare read-only
effects. The generic `typeagent-executeAction` wrapper isn't read-only as a whole.
The adapter uses existing native MCP tools, with no second executor and no
extension-owned backend connection. Programs that use only native tools never
start the bridge.

Statuses such as `requires_interaction` and `execution_uncertain` stay distinct.
For supported confirmations and questions, the macro forwards the real user's
answer, never a model's approval or a default. Rich forms and proposals, learning
interactive workflows, and writes aren't supported. Passing fixtures doesn't
certify the live interaction UI.

### Invoking and reconciling

The MCP adapter assigns a unique run ID to each `run_macro` call. Callers that
use the manager directly must supply their own run ID. Although the tool schema
accepts `dryRun`, the current program path rejects it before dispatch.

Run journals separate dispatched, completed and uncertain work. Report the actual
structured outcome, and use `get_macro_run` to reconcile. A failure, a denial, a
cancellation, or a lost or ambiguous reply never permits a fallback to the native
agent, the planner or legacy replay. Cancelling is not a rollback. Disabling or
superseding a revision stops future use and future calls, and it doesn't undo
effects that already happened.

With plugin ownership, a prompt that clearly doesn't match any macro returns to
native Copilot before the macro is accepted. An ambiguous match, or an accepted
invocation that failed, stays with the macro system. If the owner context is
missing, the result is an explicit "unavailable", not a successful empty run.

## Data and privacy

The two owners keep separate data. TypeAgent stores macro state under its instance
root, and plugin ownership uses the scoped directory described above. Don't open
either store with a second manager while its owner is running.

Private captured evidence can keep full originals and large-result sidecars, even
when ordinary histories and displayed values show redacted versions. Filtering and
previews don't manage secrets and don't securely erase anything. Limit what you
capture, check local retention and ACLs, and don't put credentials or live session
bindings in artifacts. "Forget" removes an active macro and keeps its suppression
and audit history. It doesn't erase immutable histories, backups or effects that
already happened elsewhere.

The Automations catalog lists what each provider can inspect and manage. It isn't
one universal executor, and it doesn't synchronize the plugin and server stores.

## Current qualification and further reading

Synthetic proofs with the native CLI cover restricted authoring, symbolic and
hybrid execution of a copied artifact without TypeAgent, and restarting a ready
artifact. The optional action-bridge proof uses a real Dispatcher with a
synthetic read-only provider. None of this certifies VS Code, every platform,
production services, arbitrary effects, plugin-update compatibility or
performance. Unit tests cover handing off an interrupted job and recovering from
a crash while the writer lock is held, but those aren't a live upgrade test.

- [Macro package contracts and persistence](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/copilot-macros/README.md).
- [Plugin learning and owner setup](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/copilot-plugin/README.md#tool-composed-macros).
- [Fast-action status ledger](https://github.com/microsoft/TypeAgent/blob/main/ts/docs/plans/copilot-fastActions/STATUS.md)
  for dated evidence and release gates. Plans live in the repository and aren't site pages.
- [Provider flow architecture](./workflows.md) for PowerShell authorization,
  WebFlow and TaskFlow execution, and provider-specific recovery.
