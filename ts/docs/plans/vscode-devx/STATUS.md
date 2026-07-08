# TypeAgent Studio — Status

> Living status of the VS Code DevX work. Unlike `DESIGN.md` (which describes
> the **intended** end state), this file tracks what is **actually built today**
> and what remains. Update it whenever a capability changes state.

Branch: earlier feature work merged to `main` via PR #2468; ongoing work
continues on the `dev/talzacc/typeagent_studio_part*` stack (currently part6 —
corpus capture + Impact Report regression verdict, which **closes the headline
"find a regression" gate**: the shipped predicate agrees with the hand-labelled
`player` set at ~92%, above the 80% bar).

## Capability matrix

Legend: ✅ done · 🟡 partial · ❌ not started.
"Wired to dispatcher" = backed by the real TypeAgent dispatcher/engine rather
than an in-memory stand-in.

| Capability                                                     | Core logic                                                                                                                                                                                  | UI                                                                                                                                                                                  | Wired to dispatcher                                                                                                           | Tested |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| Sandboxes (lifecycle, agent load/unload)                       | ✅ in-memory                                                                                                                                                                                | ✅ tree view (channel-backed; agent runtime is source of truth)                                                                                                                     | ❌ in-memory only (no subprocess/isolated dispatcher)                                                                         | ✅     |
| Sandbox persistence across reload/restart                      | ✅                                                                                                                                                                                          | ✅ (auto-restore)                                                                                                                                                                   | n/a                                                                                                                           | ✅     |
| Corpora (federation: in-repo / captures / external / feedback) | ✅ file-backed                                                                                                                                                                              | ✅ tree view                                                                                                                                                                        | n/a                                                                                                                           | ✅     |
| Event Log (structured event stream)                            | 🟡 in-memory ring buffer                                                                                                                                                                    | ✅ tree view (+ channel-backed source)                                                                                                                                              | ❌ most emit sites unwired                                                                                                    | ✅     |
| Agent health (status bar + findings)                           | 🟡 heuristic/filesystem checks                                                                                                                                                              | ✅ status bar                                                                                                                                                                       | ❌ no real schema parse / grammar compile                                                                                     | ✅     |
| Collisions (cross-schema grammar overlap)                      | ✅ real NFA scanner over compiled `.ag.json`                                                                                                                                                | ✅ tree view + Skipped group + auto-scan (+ channel-backed source)                                                                                                                  | n/a (reads compiled grammars)                                                                                                 | ✅     |
| Feedback (thumbs up/down → corpus)                             | ✅                                                                                                                                                                                          | ✅ command                                                                                                                                                                          | n/a                                                                                                                           | ✅     |
| Replay / compare engine                                        | ✅ schema-enriched grammar (L1), construction-cache (L2), selectable two-mode (grammar/cache) + opt-in live wildcard validation (L4a) + red/green regression predicate (`likelyRegression`) | ✅ Impact Report webview (`ActionDelta[]`)                                                                                                                                          | 🟡 grammar + live construction cache + working-tree wildcard validation; no two-version build-from-ref (L4b, deferred to P-7) | ✅     |
| Onboarding bridge (snapshot/restore, stale detection)          | ✅                                                                                                                                                                                          | ✅ commands                                                                                                                                                                         | ❌ in-memory bridge                                                                                                           | ✅     |
| Repo-root detection (find `packages/agents`)                   | ✅                                                                                                                                                                                          | ✅ warn toast + status bar                                                                                                                                                          | n/a                                                                                                                           | ✅     |
| Webview infrastructure (`webviewKit`)                          | ✅ CSP/nonce host + typed protocol                                                                                                                                                          | ✅ singleton-panel host                                                                                                                                                             | —                                                                                                                             | ✅     |
| Regression verdict (red/green predicate)                       | ✅ `likelyRegression` (delta-shape + observation-scoped feedback-override); benchmarked ~92% vs the hand-labelled `player` set (bar 80%)                                                    | ✅ verdict banner + per-row Impact column                                                                                                                                           | n/a (classifies replay rows)                                                                                                  | ✅     |
| Impact Report webview                                          | ✅ `replayCorpus` over channel                                                                                                                                                              | ✅ context header, A/B controls, Grammar/Cache + Validate toggles, durable state, verdict banner + Impact column, unified live-count filter chips, column sorting, utterance filter | 🟡 grammar + construction-cache + working-tree wildcard validation (L1–L2, L4a)                                               | ✅     |
| Corpus capture (real utterances → actions, any agent)          | ✅ display/interaction-log → corpus transform + import, auto-promote to shared in-repo corpus                                                                                               | ✅ import command + Corpora tree (filename-based rows, auto-refresh)                                                                                                                | ✅ reads real interaction logs                                                                                                | ✅     |
| Schema Studio                                                  | ❌                                                                                                                                                                                          | ❌                                                                                                                                                                                  | ❌                                                                                                                            | ❌     |
| Live Trace                                                     | ❌                                                                                                                                                                                          | ❌                                                                                                                                                                                  | ❌                                                                                                                            | ❌     |
| `agr-language` / `vscode-shell` refactor onto core             | 🟡 dependency edge only                                                                                                                                                                     | —                                                                                                                                                                                   | ❌ no behavioral integration                                                                                                  | ❌     |

## Roadmap at a glance — gate spine + backlog

This is the single at-a-glance tracker. The MVP is fenced by five acceptance
gates ([`04-mvp-slice.md` §3](./04-mvp-slice.md)); phase sequencing lives in
[`05-implementation-plan.md` §11](./05-implementation-plan.md#11-phasing--concrete-sequencing).
The **gate spine** is the critical path; the **backlog** holds everything
deliberately off it, each row tagged with its parent gate and precondition so it
is clear why it waits. There is no second roadmap — depth (L4b) and breadth
(multi-variant / multi-agent) are backlog rows here, not a parallel plan.

### Gate spine (MVP critical path)

| Gate  | Journey              | Capability                                              | Phase | Status                                                                                                                   |
| ----- | -------------------- | ------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| **A** | J1 Stand up an agent | New-Agent Wizard                                        | P-2   | ❌ not started (onboarding bridge ✅)                                                                                    |
| **B** | J2 Tune schema       | Schema Studio                                           | P-4   | ❌ not started                                                                                                           |
| **C** | J4 Find a regression | Impact Report ≥ 80% red/green on hand-labelled `player` | P-3   | 🟡 **long pole** — engine L1–L4a ✅; corpus ✅; predicate + measurement ✅ (92% on real deltas); Impact Report wiring ❌ |
| **D** | J5 Debug a trace     | Trace Viewer                                            | P-3   | ❌ not started                                                                                                           |
| **E** | J6 Observe live      | Live Trace + status bar                                 | P-5   | ❌ not started                                                                                                           |

**Critical path now: close Gate C** — corpus capture (the agent-agnostic capture
path; `player` is just the anchor set the gate is scored on) → predicate tuning →
run the ≥ 80% validation. It is the only _tunable_ gate and §7's top risk.

### Backlog (off the critical path — tagged, not a separate plan)

Each item is a child of a gate/journey; **none is required to pass A–E**. Track
tags: **depth** = how faithfully one replay side is realized (improves Gate C
accuracy); **breadth** = how many things are compared at once (multiplies cells);
**infra** = enabling plumbing.

| Item                                                                      | Parent      | Track              | Precondition                        | Status                         |
| ------------------------------------------------------------------------- | ----------- | ------------------ | ----------------------------------- | ------------------------------ |
| Per-side fidelity matrix (which layers ran on each side + skip reasons)   | Gate C / J4 | depth              | —                                   | ✅ shipped (L4b Step 1)        |
| "Sandbox A / Sandbox B" relabel of the A/B columns                        | Gate C / J4 | depth              | —                                   | optional cosmetic (L4b Step 2) |
| **L4b** build-from-ref sandboxes (real compiled ref side)                 | Gate C / J4 | depth (P-7)        | Gate C banked                       | deferred flagged epic (Step 3) |
| Multi-variant compare (Baseline vs N variants; bisect / first-divergence) | J4          | breadth — versions | Gate C banked; must preserve Gate C | post-MVP                       |
| Multi-agent / multi-corpus replay (`code`, 684 utterances)                | J4          | breadth — agents   | Gate C banked                       | post-MVP (§2 exclude)          |
| Active-sandbox selector + per-sandbox scoping                             | —           | infra              | single-sandbox E2E                  | P-7a                           |
| Sandbox copy-on-write overlay (true sandbox-local A/B)                    | —           | infra              | P-7a                                | P-7b                           |

Why depth and breadth are distinct dials on the same `replayCorpus` (F4.1)
primitive: **depth** raises the fidelity of each compared _cell_ (and thus Gate C
accuracy); the two **breadth** axes raise the _number_ of cells (versions ×
agents). They compose and are independent. Detailed slice breakdowns live in the
design docs ([the L4b sandbox-convergence plan](./replay-l4b-design.md) and
[the multi-variant compare design](./impact-report-multi-variant-design.md)).

## The long pole

The headline "find a regression" journey (capture → replay two versions →
Impact Report) is **progressing but not yet closed**:

- **Webview infrastructure now exists.** ✅ `webviewKit` (strict CSP/nonce HTML
  builder, singleton-panel host, typed host↔webview protocol, browser-neutral
  replay view model) and the Impact Report webview are built and tested — the
  foundation Schema Studio, Wizard, Trace, and Live Trace will reuse.
- **Replay has climbed the fidelity ladder to L4a.** Beyond the original identity
  resolver, replay now runs **static-grammar** matching, **schema-enriched
  grammar** matching (L1: the agent's grammar is enriched with checked-variable
  metadata from its action schema and matched through the real `GrammarStore`),
  and a **live construction-cache consult** (L2: the working-tree side checks the
  agent's real per-session construction cache first — the dispatcher's actual
  first step — hash-gated to the current schema exactly as the dispatcher gates
  it, so a schema edit invalidates the cached constructions rather than reporting
  a phantom hit). The construction cache is consulted for the **working tree
  only** (caches are runtime artifacts, never committed / never read at a git
  ref) and degrades cleanly to L1 when no live cache is found or it has gone
  stale. Two replay **modes** are now selectable in the Impact Report (grammar-only
  vs. construction-cache), and an opt-in **live wildcard validation** pass (L4a)
  runs the agent's real `validateWildcardMatch` over working-tree wildcard matches
  (`timer`/`list`; fail-open + diagnostics). Results are still indicative for
  grammar-resolved rows — **L4b** (build-from-git-ref two-version sandboxes)
  remains and is **deferred to P-7** (post-Gate-C, per the implementation plan);
  there is no git-worktree build of two versions yet.
- **No capture-to-corpus path.** `vscode-shell` depends on core but doesn't use
  it; without capture the Impact Report would have no real labelled corpus.
- **Health gives false confidence.** It does not run the schema parser or
  compile `.agr`; `grammar.rules.targetKnownActions` is currently a no-op pass
  (`health/service.ts`). It can mark things healthier than the dispatcher would.

## Recently completed (this work stream)

- Impact Report webview + `webviewKit`: a strict-CSP webview that drives
  `replayCorpus` over the service channel and renders the `ActionDelta[]`
  contract, with a context header (sandbox + resolved versions), A/B version
  launch controls, durable state across navigate-away/back, and run-error
  surfacing.
- Replay fidelity: a **static-grammar** resolver (real needs-explanation path;
  ships `builtInEntities.agr` in the bundle), a **schema-enriched grammar**
  resolver (L1 — schema `checked_wildcard`/param metadata projected onto the
  grammar, matched through the real `GrammarStore`; graceful fallback to
  static-grammar when the schema can't be discovered), and a **construction-cache
  layer** (L2 — the live working-tree side consults the agent's real per-session
  construction cache before the grammar; faithful to the completion-based
  dispatcher's construction-store-first path, hash-gated to the working-tree
  schema; a cache hit is reported distinctly from a grammar-resolved `miss`, and
  the layer degrades to L1 when the cache is absent or stale).
- Connection-aware UX: Corpora / Event Log / Collisions views show "Connect to
  Studio service" welcome content when the service is down (mirroring
  Sandboxes); the corpus tree auto-refreshes on in-repo capture; clearer
  clickable seed-corpus affordance.
- Shared WebSocket liveness heartbeat: `attachClientHeartbeat` (client-side
  ping/pong watchdog) extracted alongside `attachHeartbeat` into
  `@typeagent/websocket-utils`; the Studio service client uses it to detect a
  silently-dropped service and drive the existing reconnect/backoff path.

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
3. **Corpus capture** — wire `vscode-shell` request/feedback IDs into the
   core corpus. Agent-agnostic capture path (works for any agent); `player` is
   simply the first corpus captured because Gate C is scored on it.
4. **One real replay path** — one agent, one utterance, working tree vs. HEAD,
   real dispatch; validate the Impact Report `ActionDelta[]` contract (which the
   agent's `ValidateChange` and the webview both consume). **Largely done:** the
   grammar replay path (L1 schema-enriched, L2 construction-cache, two selectable
   modes, L4a opt-in wildcard validation) is live and validated against the
   contract. The remaining fidelity rung **L4b** (build-from-ref two-version
   sandboxes) is **deferred to P-7** (post-Gate-C). **Live priority is now #3
   (corpus capture) → Gate C measurement** — the headline acceptance bar.
5. **Active-sandbox selector + per-sandbox scoping** (plan phase **P-7a**;
   sequenced **after** the single-sandbox E2E closes) — collisions and corpora are
   intrinsically per-sandbox (a collision is a function of the co-loaded agent
   set). Add a single active-sandbox selector that scopes the Corpora, Collisions,
   and Event Log views to the selected sandbox's agents (`scanGrammarCollisions`
   already takes `sandboxId`/`agents`; `listCorpusAgents` currently unions across
   all sandboxes). Scopes _visibility/analysis_ only — a small, clean win that also
   sets up the overlay below. See [`DESIGN.md` §3.6](./DESIGN.md).
6. **Sandbox isolated overlay (the bigger lift)** (plan phase **P-7b**) — evolve a
   sandbox from a filtered view over shared repo source into a per-sandbox
   **copy-on-write overlay** so tuning is sandbox-local (true A/B; a full debugging
   experience). The seam exists: the loader probes ordered _agent roots_, so give
   each sandbox a higher-priority overlay root
   (`~/.typeagent/sandboxes/<id>/agents/` shadowing `packages/agents`). Unlocks
   sandbox-vs-base replay, hot-reload, and a create-from-base → tune →
   promote/discard lifecycle. See [`DESIGN.md` §3.6](./DESIGN.md).

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
