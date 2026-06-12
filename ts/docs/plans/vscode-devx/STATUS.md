# TypeAgent Studio — Status

> Living status of the VS Code DevX work. Unlike `DESIGN.md` (which describes
> the **intended** end state), this file tracks what is **actually built today**
> and what remains. Update it whenever a capability changes state.

Branch: feature work has merged to `main` via PR #2468; ongoing work continues
on `dev/talzacc/typeagent_studio`.

## Capability matrix

Legend: ✅ done · 🟡 partial · ❌ not started.
"Wired to dispatcher" = backed by the real TypeAgent dispatcher/engine rather
than an in-memory stand-in.

| Capability                                                     | Core logic                                   | UI                                       | Wired to dispatcher                                   | Tested |
| -------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- | ------ |
| Sandboxes (lifecycle, agent load/unload)                       | ✅ in-memory                                 | ✅ tree view                             | ❌ in-memory only (no subprocess/isolated dispatcher) | ✅     |
| Sandbox persistence across reload/restart                      | ✅                                           | ✅ (auto-restore)                        | n/a                                                   | ✅     |
| Corpora (federation: in-repo / captures / external / feedback) | ✅ file-backed                               | ✅ tree view                             | n/a                                                   | ✅     |
| Event Log (structured event stream)                            | 🟡 in-memory ring buffer                     | ✅ tree view (+ channel-backed source)   | ❌ most emit sites unwired                            | ✅     |
| Agent health (status bar + findings)                           | 🟡 heuristic/filesystem checks               | ✅ status bar                            | ❌ no real schema parse / grammar compile             | ✅     |
| Collisions (cross-schema grammar overlap)                      | ✅ real NFA scanner over compiled `.ag.json` | ✅ tree view + Skipped group + auto-scan | n/a (reads compiled grammars)                         | ✅     |
| Feedback (thumbs up/down → corpus)                             | ✅                                           | ✅ command                               | n/a                                                   | ✅     |
| Replay / compare engine                                        | 🟡 engine + command                          | 🟡 quick-pick (no Impact Report)         | ❌ identity resolver (no two-version build/dispatch)  | ✅     |
| Onboarding bridge (snapshot/restore, stale detection)          | ✅                                           | ✅ commands                              | ❌ in-memory bridge                                   | ✅     |
| Repo-root detection (find `packages/agents`)                   | ✅                                           | ✅ warn toast + status bar               | n/a                                                   | ✅     |
| Webview infrastructure (`webviewKit`)                          | ❌                                           | ❌                                       | —                                                     | ❌     |
| Impact Report webview                                          | ❌                                           | ❌                                       | ❌                                                    | ❌     |
| Player corpus capture                                          | ❌                                           | ❌                                       | ❌                                                    | ❌     |
| Schema Studio                                                  | ❌                                           | ❌                                       | ❌                                                    | ❌     |
| Live Trace                                                     | ❌                                           | ❌                                       | ❌                                                    | ❌     |
| `agr-language` / `vscode-shell` refactor onto core             | 🟡 dependency edge only                      | —                                        | ❌ no behavioral integration                          | ❌     |

## The long pole

The headline "find a regression" journey (capture → replay two versions →
Impact Report) is **not** closed:

- **No webview infrastructure exists.** Impact Report, Schema Studio, Wizard,
  Trace, and Live Trace all depend on a `webviewKit` that hasn't been started.
  This is the single biggest hidden dependency.
- **Replay is an identity-comparison shell.** The default resolver returns each
  corpus entry's captured `expectedAction` for _both_ versions, producing an
  all-equal baseline (`studioRuntimeCore.ts` `identityReplayResolver`). There is
  no git-worktree build, transient dispatcher, or version-specific resolution.
- **No capture-to-corpus path.** `vscode-shell` depends on core but doesn't use
  it; without capture the Impact Report would have no real labelled corpus.
- **Health gives false confidence.** It does not run the schema parser or
  compile `.agr`; `grammar.rules.targetKnownActions` is currently a no-op pass
  (`health/service.ts`). It can mark things healthier than the dispatcher would.

## Recently completed (this work stream)

- Health handler discovery uses `package.json` `exports` (dispatcher contract)
  instead of filename heuristics; chat-style agents opt out of the
  "needs grammar" rule via `manifest.schema.injected`.
- Sandbox set persists across reload/restart (workspace-state snapshot).
- Collisions view: "Skipped (N)" group surfacing each skipped schema's reason
  and owning agent; auto-scan (debounced) when the loaded agent set changes.
- Collisions skips distinguish `no-grammar` (by design), `grammar-not-built`
  (buildable — has `.agr` + an `agc` script; offers an inline "Build grammar"
  action that runs `agc:all` as a VS Code task then re-scans), and grammar
  source with no compile step (e.g. `email`, shown but not buildable).
- Repo-root detection: finds the directory containing `packages/agents` by
  probing each workspace folder, its `ts/` subdir, and ancestors; warns clearly
  when none is found.
- Investigated the player/crossword/workbench collision-scan compile errors —
  root cause is an engine issue (see Known issues), not a per-agent defect.
- Repo policy + CodeQL fixes for the two new packages (LICENSE, Trademarks,
  `crypto.randomUUID`, polynomial-regex removal).

## Next slice candidates

The build sequence now lives in **one unified plan** —
[`05-implementation-plan.md` §11](./05-implementation-plan.md#11-phasing--concrete-sequencing)
— where each capability ships as a core primitive + both presenters (UI +
`studio` agent), and the agent's S0–S5 phases are mapped onto P-0…P-6. The
candidates below are the immediate ready-to-start slices; pick per that plan.

Done / superseded:

- ~~**S0 — extract the runtime into `@typeagent/core/runtime`**~~ — **done**:
  `studioRuntimeCore` (+ `repoRootResolver`, `getDefaultPhaseInputs`) moved into
  a context-agnostic `typeagent-core/src/runtime/` with a `./runtime` export; the
  extension consumes it via the package boundary (the only VS-Code-coupled file
  is the `studioRuntime.ts` adapter). No behavior change; core 127 / studio 112
  tests green. The further "split into bounded modules" cleanup can follow as
  needed. **Still open in P-0:** scaffold the empty `packages/agents/studio/`
  agent (manifest/schema/handler + `defaultAgentProvider` registration).
- ~~**P-0 `studio` agent scaffold + S1 Inspect actions**~~ — **done**:
  `packages/agents/studio/` (schema-only agent, emoji 🎨) registered in
  `defaultAgentProvider`, with a thin handler over the headless runtime
  (`getStudioRuntime` → `createStudioRuntimeCore`). Read-only group-A surface,
  deliberately scoped to what's Studio-distinct and headless-appropriate (no
  duplication of the dispatcher's `@config agent`):
  `getStudioInfo` (repo root + agent **locations** with per-root counts),
  `listCollisions`, `queryEvents`. Backed by a read-only `getAgentLocations()`
  core runtime method. Repo root is an explicit per-action param (cached per
  root), `TYPEAGENT_STUDIO_REPO_ROOT`/cwd fallback. Verified end-to-end; 11
  agent tests + core 127 + studio-ext 112 green.
  _Reintroduce later (not as generic agent actions):_ per-agent describe,
  schema/grammar/corpus inspection — these belong **sandbox-scoped** (S2) and/or
  as client-side "open in VS Code" actions over the P-1.5 channel (the headless
  agent can't open an editor).
- ~~**Configurable agent search paths**~~ — **done** (merged in #2472):
  `typeagentStudio.agentSearchPaths`, live (no-reload) roots, Add/Remove
  directory commands, user-settings persistence.
- ~~**Loader parity for registry entries**~~ — **moot**: discovery is now
  filesystem-only (we removed the `defaultAgentProvider` config.json source and
  the `provider.registers` health rule), so there are no registry-only picker
  entries to reconcile.

Ready to start (smallest → larger):

1. **Studio service channel (the Option B migration; plan phase P-1.5)** —
   **mostly done.** The typed service channel served by the `studio` agent's
   **own WebSocket** (the `code`↔`coda` pattern: port via `registerPort`, client
   discovers via `discoverPort("studio")`, `agent-rpc` `createRpc` framing) is
   built and verified end-to-end, and the **Event Log tree now reads through the
   channel** (the "Connect Event Log to studio service" command swaps it from the
   in-process runtime to the agent's runtime, with graceful fallback on
   disconnect) — satisfying the "≥1 existing tree over the channel" half of the
   P-1.5 exit. Also wired: the `studio` agent reports its live client count to
   `@system ports`. **Remaining for P-1.5 exit:** the Impact Report webview shell
   as the greenfield first client (item 2), and the channel guardrails
   (capability-token auth; subscription cancellation/backpressure).
2. **Minimal `webviewKit` + Impact Report shell** — prove lifecycle, state
   restore, CSP/assets, message protocol, theming before full replay exists.
   Built as a **client of the `studio` agent over the channel**, not on the
   extension's in-process runtime.
3. **Player corpus capture** — wire `vscode-shell` request/feedback IDs into the
   core corpus.
4. **One real replay path** — one agent, one utterance, working tree vs. HEAD,
   real dispatch; validate the Impact Report `ActionDelta[]` contract (which the
   agent's `ValidateChange` and the webview both consume).

## Interaction modes & agent-drivability

Studio's authoring loop (author → tune schema/grammar → compare-and-replay →
judge) can be driven three ways (see [`USER-STORY.md`](./USER-STORY.md) §5):

- **A. Human-driven** — clicks through trees/webviews; optimized for judgment.
  This is what the MVP UX targets today.
- **B. AI-agent-driven** — an autonomous agent drives the same primitives
  headlessly, consuming typed results as data.
- **C. Hybrid** — human sets intent, agent does the mechanical loop, human
  approves; needs UI _and_ callable primitives over one source of truth.

**Where we are:** the architecture is **agent-ready** (the vscode-free
`typeagent-core`, typed runtime methods, the structured event stream, and
RPC-shaped capabilities), and the J1 entry door already reuses the platform's
existing MCP/conversational authoring (`@typeagent create an agent for X` →
`onboarding`). But the _new_ Studio primitives are currently only consumed
**in-process by the extension host** — there is no headless entry point, CLI,
MCP tool, or published JSON result contract for `replayCorpus` / health /
collisions. The earlier plan deferred the CLI/CI form of replay and the
"Studio as MCP host" role to post-MVP; we are **electing to treat
agent-drivability as a first-class direction** rather than a deferred extra.

**Design principle (going forward):** every Studio capability should have a
**headless core primitive with a typed, documented result**, and the UI should
be a thin presenter over it. This single investment serves modes A, B, and C at
once (the webview renders the result; an agent consumes the same shape). A
concrete vehicle for the agent surface is a new first-party **`studio` TypeAgent
agent** — see [`STUDIO-AGENT.md`](./STUDIO-AGENT.md).

**Architecture decision — where the runtime runs (Option B; decided).** The
Studio runtime is hosted **in the `studio` agent** (in the agent-server) — **one
runtime per target workspace** (keyed by resolved repo root), not a global
singleton — and every UI is a **client** of it, the same shape as the rest of the
system (`code` : `coda` :: `studio` : `typeagent-studio`). The `typeagent-studio`
extension does **not** host its own runtime; it drives the agent's typed actions
and renders the results. See [`DESIGN.md` §3.5](./DESIGN.md). The extension's
current in-process `createStudioRuntime` is a **transitional bootstrap** to be
migrated to an agent-server client as the agent's action surface grows.

**Typed result / event channel (decided).** For rich (non-chat) clients, the
`studio` agent serves a **typed service channel over its own WebSocket** — the
proven `code`↔`coda` pattern: port registered via `registerPort`, the
`typeagent-studio` client discovers it via `discoverPort("studio")`. On top runs
`agent-rpc` `createRpc`: `invoke` for typed results + a server→client
subscription that pushes the existing `StudioEvent` union from
`@typeagent/core/events` (`sandbox.*`, `collision.detected`, `replay.row` /
`replay.summary`, `feedback.recorded`, …) — reuse that type. That WS
protocol is the **canonical typed API**; `studio` actions and MCP tools wrap the
**same typed runtime methods**; `ActionResult.displayContent` is
chat-summary-only. Guardrails: session/repo identity on every message, a
capability token, and subscription/cancellation/backpressure. Rejected:
"structured data on `ActionResult`" (clients get a `CommandResult`, not the raw
`ActionResult<T>` — a platform change) **and** "an `agent-rpc` channel on the
existing agent-server connection, no new port" — **infeasible**: an AppAgent gets
only `SessionContext` (no `ChannelProvider`/transport), and only the
agent-server's `connectionHandler` creates channels, so an agent can't add one
(this is exactly why `code` runs its own WS). See [`STUDIO-AGENT.md` §8](./STUDIO-AGENT.md).
Mutating actions must sit behind `dryRun` + approval **and** the channel's
capability-token check.

**Open decisions to make** (from [`USER-STORY.md`](./USER-STORY.md) §6):

- ~~Where does the Studio **runtime** live?~~ **Resolved (Option B):** in the
  `studio` agent (one per workspace); UIs are clients (see the note above).
- ~~**Typed result / event channel** for rich clients.~~ **Resolved:** the
  `studio` agent's own WebSocket (`code`↔`coda` pattern: `registerPort` /
  `discoverPort`) with `agent-rpc` framing; actions/MCP wrap the same methods
  (see the note above).
- Where does the driving agent run — in-editor (Copilot driving commands), as a
  TypeAgent agent (conversational), or a CLI in CI? Each implies a different
  headless surface.
- Should `typeagent-studio` (or `typeagent-core`) expose an **MCP server** so
  external LLM tools can drive the loop? (Previously an open question in the
  inventory; revisit now.)
- What is the **approval boundary** in hybrid mode (which steps an agent may do
  autonomously vs. which require human sign-off)?
- The **minimum machine-readable contract** for the Impact Report so an agent
  can act before the webview exists (likely a typed `ActionDelta[]` + summary).

## Known issues

- **Collision scan can't compile many agents' optimized grammars**
  (`compile-error: Cannot compile: unknown variable t` / `__opt_v_0`).
  Confirmed-affected: `list`, `timer`, `desktop`, `github-cli`, `powershell`,
  `visualStudio`, `player`, `browser`'s `crossword`, `code`'s `workbench`.
  Root cause: the `agc` **optimizer** rewrites two constructs into rule
  fragments that reference a variable not bound in the flattened rule —
  (1) **optional groups**, emitted as `__opt_v_N`, and (2) **inlined captures**
  from sub-rules (e.g. the built-in `Ordinal`/`Cardinal` compound number rules
  `$(t:<Tens>) (\-)? $(o:<OrdinalOnes>) -> t + o` in `builtInEntities.agr`,
  leaving `t` dangling). `grammar-tools-core`'s re-compilation
  (`action-grammar/environment.ts`) rejects these. The grammar **source is
  valid** and the **dispatcher consumes these grammars fine** (it uses the
  precompiled dispatch tables rather than re-compiling the AST); a fresh `agc`
  rebuild does **not** fix it. Engine-level issue for the action-grammar /
  grammar-tools owners, not a per-agent grammar defect. The Skipped view
  surfaces it honestly as a compile error.
  - Agents that **do** scan cleanly today: `calendar`, `weather`, `ipconfig`,
    `discord`, `vampire`, `utility`, `screencapture`, `osNotifications`.

## Build / test

From `ts/`:

```bash
pnpm i

# Engine library (jest against dist/test/*.spec.js — build first):
pnpm --filter "@typeagent/core" build
pnpm --filter "@typeagent/core" test          # 124 tests

# Extension (esbuild bundles core into dist/extension.js; tests via tsx/node:test):
pnpm --filter typeagent-studio build
pnpm --filter typeagent-studio test:local     # 107 tests

# Package + install the VSIX into the local VS Code:
cd packages/typeagent-studio
pnpm build && pnpm deploy:local               # then: Developer: Reload Window
```

## Known gotchas

- **Open `ts/`, not the git root.** Repo-root detection now finds
  `packages/agents` under `ts/` (or by walking up), and warns if it can't —
  but pointing Studio at a folder with no agents still yields empty views.
- **esbuild inlines core into the extension bundle.** Changes to
  `@typeagent/core` require a `typeagent-studio` rebuild to be visible.
- **Installed VSIX vs. F5 dev host.** Rebuilding `dist/extension.js` does not
  update an installed VSIX — use `pnpm deploy:local` + reload, or run via F5.
- **`vsce package` needs a LICENSE** in the package directory (now present).
- **`string-union` action params** throw "Unknown type string-union" via
  `confirmTranslation` when `@config dev on` (pre-existing dispatcher bug,
  `actionTemplate.ts`), unrelated to Studio but can surface during agent work.
