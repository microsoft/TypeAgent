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

| Capability                                                     | Core logic                                   | UI                                                                 | Wired to dispatcher                                   | Tested |
| -------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- | ------ |
| Sandboxes (lifecycle, agent load/unload)                       | ✅ in-memory                                 | ✅ tree view (channel-backed; agent runtime is source of truth)    | ❌ in-memory only (no subprocess/isolated dispatcher) | ✅     |
| Sandbox persistence across reload/restart                      | ✅                                           | ✅ (auto-restore)                                                  | n/a                                                   | ✅     |
| Corpora (federation: in-repo / captures / external / feedback) | ✅ file-backed                               | ✅ tree view                                                       | n/a                                                   | ✅     |
| Event Log (structured event stream)                            | 🟡 in-memory ring buffer                     | ✅ tree view (+ channel-backed source)                             | ❌ most emit sites unwired                            | ✅     |
| Agent health (status bar + findings)                           | 🟡 heuristic/filesystem checks               | ✅ status bar                                                      | ❌ no real schema parse / grammar compile             | ✅     |
| Collisions (cross-schema grammar overlap)                      | ✅ real NFA scanner over compiled `.ag.json` | ✅ tree view + Skipped group + auto-scan (+ channel-backed source) | n/a (reads compiled grammars)                         | ✅     |
| Feedback (thumbs up/down → corpus)                             | ✅                                           | ✅ command                                                         | n/a                                                   | ✅     |
| Replay / compare engine                                        | 🟡 engine + command                          | 🟡 quick-pick (no Impact Report)                                   | ❌ identity resolver (no two-version build/dispatch)  | ✅     |
| Onboarding bridge (snapshot/restore, stale detection)          | ✅                                           | ✅ commands                                                        | ❌ in-memory bridge                                   | ✅     |
| Repo-root detection (find `packages/agents`)                   | ✅                                           | ✅ warn toast + status bar                                         | n/a                                                   | ✅     |
| Webview infrastructure (`webviewKit`)                          | ❌                                           | ❌                                                                 | —                                                     | ❌     |
| Impact Report webview                                          | ❌                                           | ❌                                                                 | ❌                                                    | ❌     |
| Player corpus capture                                          | ❌                                           | ❌                                                                 | ❌                                                    | ❌     |
| Schema Studio                                                  | ❌                                           | ❌                                                                 | ❌                                                    | ❌     |
| Live Trace                                                     | ❌                                           | ❌                                                                 | ❌                                                    | ❌     |
| `agr-language` / `vscode-shell` refactor onto core             | 🟡 dependency edge only                      | —                                                                  | ❌ no behavioral integration                          | ❌     |

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

1. **Studio service channel (plan phase P-1.5; host moved to the standalone
   service in P-1.6)** — **done (exit criteria met).** The typed `agent-rpc`
   service channel — originally served by the `studio` agent's own WebSocket, now
   served by the **standalone per-workspace Studio service** (P-1.6) with the
   agent as a thin proxy — is built and verified end-to-end, with guardrails
   (capability-token auth on every connection, idempotent subscribe +
   `unsubscribeEvents`, backpressure). All channel-backed clients read through it:
   the Event Log, Collisions, Sandbox, and Corpus trees, the health status bar,
   and the Impact Report webview. **P-1.6 cleanup done:** all those surfaces are
   channel-only (no in-process fallback); the in-process `createStudioRuntime`
   remains only for onboarding (J1). **Remaining:** see the implementation plan's
   P-1.6 follow-ups (onboarding channelization, service-side workspace binding,
   lifecycle/security hardening).
2. **`webviewKit` + Impact Report shell** — **done.** A minimal, reusable
   `webviewKit` (strict CSP/nonce HTML builder, singleton-panel host, typed
   host↔webview message protocol, browser-neutral replay view model) and an
   Impact Report webview that drives `replayCorpus` over the service channel and
   renders the `ActionDelta[]` contract. The webview never opens a socket
   (webview → extension host → channel → agent runtime).
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

**Architecture decision — where the runtime runs (standalone per-workspace
service; supersedes "Option B").** The Studio runtime's affinity is to the
developer's **workspace**, not to an agent-server session, so it runs in a
**standalone, per-workspace Studio service** (a host-agnostic library + a small
process entrypoint) launched by the extension or a `typeagent-studio serve` CLI.
The **`studio` agent is a thin proxy** — never the runtime host; the
`typeagent-studio` extension, the `vscode-shell` canvas, MCP, and the CLI are all
**clients** of the service for a given workspace. **Single mode** (no agent-hosted
fallback — the CLI covers the headless case). See [`DESIGN.md` §3.5](./DESIGN.md)
and [`STUDIO-AGENT.md` §4](./STUDIO-AGENT.md).

> _Earlier this was "Option B" (the runtime hosted **inside** the `studio` agent,
> the `code`↔`coda` pattern). **P-1.6 has migrated off it** (commits on
> `dev/talzacc/typeagent_studio_part2`): the runtime now lives in the
> `studio-service` package, the `studio` agent hosts a registry + proxies its
> read-only actions (no longer hosts the runtime), and the extension
> launches/attaches the service and routes its shared live surfaces to it. The
> extension's in-process `createStudioRuntime` survives **only** for onboarding
> commands (J1) — channelizing those removes it. Remaining hardening is tracked in
> the implementation plan's P-1.6 follow-ups._

**Typed result / event channel (decided).** Rich (non-chat) clients consume a
**typed `agent-rpc` channel over the Studio service's WebSocket**: `invoke` for
typed results + a server→client subscription pushing the existing `StudioEvent`
union from `@typeagent/core/events` (`sandbox.*`, `collision.detected`,
`replay.row` / `replay.summary`, `feedback.recorded`, …) — reuse that type.
Clients **look up** the service through the `studio` agent's registry
(`discoverPort("studio", "registry")` → `lookup(workspaceKey)`). Because the
discovery channel is read-only and the extension/CLI — not the agent — spawns the
service, the service **registers** by announcing its `{workspaceKey, repoRoot,
port, token, …}` to the agent's registry (validated: protocol version +
`workspaceKey === studioWorkspaceKey(repoRoot)`; entry tied to the announcing
socket, evicted on close); evolving to authenticated external self-registration. That protocol is the **canonical typed API**; `studio` actions and MCP
tools proxy the **same typed runtime methods**; `ActionResult.displayContent` is
chat-summary-only. Guardrails: session/repo identity on every message, a
capability token, and subscription/cancellation/backpressure. Rejected:
"structured data on `ActionResult`" (clients get a `CommandResult`, not the raw
`ActionResult<T>` — a platform change). See [`STUDIO-AGENT.md` §8](./STUDIO-AGENT.md).
Mutating actions must sit behind `dryRun` + approval **and** the channel's
capability-token check.

**Open decisions to make** (from [`USER-STORY.md`](./USER-STORY.md) §6):

- ~~Where does the Studio **runtime** live?~~ **Resolved:** a **standalone,
  per-workspace Studio service**; the `studio` agent and the UIs are clients (see
  the note above). _(Earlier "Option B" placed it inside the agent; migrating
  out.)_
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
