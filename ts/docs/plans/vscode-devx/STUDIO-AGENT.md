# TypeAgent Studio — `studio` Agent: Action-Surface Reference

> **Status:** Reference for the `studio` agent presenter. This is **not a
> separate plan** — the agent's build phases are sequenced inside the single
> implementation plan ([`05-implementation-plan.md`](./05-implementation-plan.md)
> §11, phases S0–S5). This doc is the **detailed action catalogue** (groups
> A–F, tiers, approval boundary) that §10.2 of that plan summarizes. The agent
> exposes the Studio authoring/tuning/validation loop as dispatchable actions,
> making it drivable by an AI orchestrator (and conversationally) — a thin
> presenter over the same `@typeagent/core` primitives as the VS Code UI.
>
> **Reads with:** [`05-implementation-plan.md`](./05-implementation-plan.md)
> (the unified plan + phasing), [`USER-STORY.md`](./USER-STORY.md) (interaction
> modes), [`STATUS.md`](./STATUS.md) (what's built), [`DESIGN.md`](./DESIGN.md)
> §3.0 (headless-core / thin-presenter principle).

## 1. Why a `studio` agent

The Studio capabilities (sandbox lifecycle, health, collision scan, corpus
federation, replay) already exist as **VS Code-free typed primitives** in
`@typeagent/core` and the runtime that wraps them. Today they're consumed only
**in-process by the extension host** — a human-driven surface.

A TypeAgent agent is the natural, low-cost way to add the **agent-driven** and
**hybrid** surfaces (USER-STORY §5):

- TypeAgent agents are **automatically exposed over MCP** and via
  `list_commands` (per the onboarding agent's `AGENTS.md`), so an AI
  orchestrator (Claude, Copilot, or a TypeAgent agent) can discover and call
  Studio actions with no new transport code.
- It is **conversational** through the dispatcher (`@studio scan player for
collisions`), reusing the platform's existing routing.
- It reuses the exact same core primitives, so the extension UI and the agent
  stay two **thin presenters over one engine** — the design principle in
  STATUS.

The `onboarding` agent already proves this shape end-to-end (it is "itself a
TypeAgent agent, so its actions are available to AI orchestrators"). `studio`
is the analogous agent for the **tune → validate** half of the loop, where
`onboarding` owns the **author** half.

## 2. How it fits the existing pieces

```
          authoring loop (USER-STORY §1)
  ┌────────────┬─────────────────────────┬──────────────┐
  │  author    │  tune schema / grammar  │  validate    │
  └────────────┴─────────────────────────┴──────────────┘
        │                  │                     │
   onboarding agent   studio agent + extension   studio agent + extension
   (exists)           (new)        (exists)      (new)        (exists)

         ┌───────────────────────────────────────────┐
         │            @typeagent/core (engine)        │
         │  sandbox · health · corpus · collisions ·  │
         │  events · feedback · replay · onboarding   │
         └───────────────────────────────────────────┘
              ▲                                  ▲
   thin presenter (human)              thin presenter (agent/MCP)
   typeagent-studio (VS Code)          studio agent (dispatchable actions)
```

- **`onboarding` agent** — owns J1 (stand up a new agent). Unchanged.
- **`typeagent-studio` extension** — the human UI. Unchanged in principle; it
  keeps consuming the core runtime directly.
- **`studio` agent (new)** — exposes the same core primitives as typed actions
  for agent/MCP/conversational consumption.

## 3. Action surface — the full vision

The agent surface is **layered by abstraction**, not a flat list of command
wrappers. Three tiers:

- **Tier 1 — Primitives:** 1:1 with a core function; deterministic or
  command-shaped; typed result is the agent's data.
- **Tier 2 — Composites:** a few primitives sequenced into a useful unit
  (e.g. "load → run an utterance → return the resolved action + trace").
- **Tier 3 — Goal-oriented:** an LLM-planned loop that pursues an objective
  ("make these utterances map without regressing the 👍 set"), emitting
  structured progress events and pausing at approval checkpoints.

Tier 1 is what makes the loop _scriptable_; Tier 3 is what makes it
_agent-driven_. The extension UI mostly needs Tier 1; an autonomous or hybrid
agent lives in Tiers 2–3.

Every action returns a **typed, documented result** and — for any mutation —
supports a **`dryRun`** that returns the proposed diff/plan without applying it.
Agents and rules are addressed by **stable ids** (agent name, action type name,
grammar rule id) so calls are idempotent and composable.

### A. Inspect (read; autonomous-safe)

| Action                     | Returns                                                                                              | Building block                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `ListAgents`               | name, emoji, loaded state, health badge, schema/grammar hashes                                       | `listAvailableAgents` + health                  |
| `DescribeAgent`            | full picture: actions, grammar rule count, corpus size, recent feedback, health findings, collisions | composite                                       |
| `GetSchema` / `GetGrammar` | the artifact text + parsed structure (actions / rules)                                               | `actionSchema`, `grammarTools/core.loadGrammar` |
| `ListActions`              | the typed action surface of an agent (names, params, descriptions)                                   | `actionSchema` parser                           |
| `GetCoverage`              | per-utterance: matched action vs unmatched, grouped                                                  | `grammarTools/core.computeCoverage`             |
| `SearchCorpus`             | corpus entries filtered by source / rating / category / text                                         | `CorpusService.list`                            |
| `ListCollisions`           | cross-schema overlaps with participants + grammar source locations                                   | collision scanner                               |
| `GetTrace`                 | full dispatch tree for a `requestId` (grammar match → cache → translate → action → result)           | structured event stream (J5)                    |
| `QueryEvents`              | filtered slice of the structured event stream                                                        | `events`                                        |

### B. Author / edit (mutating; approval or `dryRun`)

| Action                                      | Returns / effect                                            | Building block                                      |
| ------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `ProposeActionsFromUtterances`              | suggested action shapes for un-typeable utterances (J2)     | `schemaAuthor`                                      |
| `AddAction` / `EditAction` / `RemoveAction` | schema edit (file diff)                                     | `actionSchema` + edit                               |
| `ProposeGrammarVariations`                  | candidate phrasings for an intent/action (J3)               | `schemaAuthor`, `examples/schemaStudio @variations` |
| `AddGrammarRule` / `EditGrammarRule`        | `.agr` edit (file diff)                                     | `.agr` edit                                         |
| `GenerateGrammarFromSchema`                 | a `.agr` draft from the schema + phrases                    | `SchemaToGrammarGenerator`, `@fromSchema`           |
| `BuildAgent` / `CompileGrammar`             | `asc`/`agc` build result (+ errors)                         | build tasks                                         |
| `ScaffoldAgent`                             | delegate to the **`onboarding`** agent (don't duplicate J1) | `onboarding`                                        |

### C. Corpus management (mutating; approval for writes)

| Action                          | Effect                                                        | Building block                    |
| ------------------------------- | ------------------------------------------------------------- | --------------------------------- |
| `SeedInRepoCorpus`              | create `corpus/<agent>.utterances.jsonl`                      | `CorpusService.seedInRepoCorpus`  |
| `AddExternalCorpus`             | register a JSONL source in `.typeagent/studio.json`           | `CorpusService.addExternalSource` |
| `CaptureSession`                | turn a sandbox session's utterances into capture entries      | `CorpusService.append`            |
| `PromoteCaptures`               | move captures → in-repo seed                                  | `CorpusService.promote`           |
| `ImportCorpus` / `ExportCorpus` | JSONL interchange (`@feedback export` format)                 | `CorpusService` + feedback        |
| `ProposeFeedbackLabels`         | suggest 👍/👎 + category (human confirms — labels stay human) | feedback (assistive only)         |

### D. Run / try (sandbox execution; the "does it work?" loop)

| Action                                            | Returns                                                                  | Building block        |
| ------------------------------------------------- | ------------------------------------------------------------------------ | --------------------- |
| `StartSandbox` / `StopSandbox` / `RestartSandbox` | `SandboxStatus`                                                          | `SandboxManager`      |
| `LoadAgent` / `UnloadAgent`                       | `SandboxStatus`                                                          | `SandboxManager`      |
| `RunUtterance`                                    | resolved action + cache hit/miss + result + `requestId` (for `GetTrace`) | dispatcher in sandbox |
| `RunUtterances`                                   | batch of the above (drives quick coverage probes)                        | dispatcher in sandbox |

### E. Validate / regress (the headline; read-only analysis)

| Action              | Returns                                                                                                       | Building block                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `ReplayCorpus`      | `ActionDelta[]` + summary (vA vs vB over the federated corpus)                                                | `replayCorpus`                           |
| `DetectRegressions` | red/green verdict per delta by policy (changed action where prior 👍, or current 👎)                          | composite over `ReplayCorpus` + feedback |
| `ValidateChange`    | one Impact-Report-shaped verdict over all of tier E (the same shape the webview renders); read-only composite | composite over the row above + below     |
| `DiffGrammars`      | structural grammar diff                                                                                       | `grammarTools/core.diffGrammars`         |
| `CoverageDelta`     | coverage before/after                                                                                         | `computeCoverage`                        |
| `CollisionsDelta`   | collisions introduced/removed by a change                                                                     | collision scanner                        |
| `HealthGate`        | pass/fail + findings (the ship gate)                                                                          | `FileHealthService`                      |
| `ScanCollisions`    | full cross-agent overlap report                                                                               | collision scanner                        |

### F. Orchestrate (Tier 3; goal-oriented, LLM-planned, checkpointed)

These are the actions that make the agent _autonomous_; each is a loop over A–E
that emits structured progress and stops at an approval boundary.

| Action                               | Goal                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `ImproveCoverage(agent, utterances)` | add grammar/schema until the target utterances map; re-validate; report what changed                  |
| `FixRegression(agent, deltaId)`      | propose + apply a schema/grammar fix for one red replay row; re-replay; report                        |
| `TuneAgent(agent, goal)`             | a guided improve→validate loop toward a stated objective, surfacing each proposed change for approval |
| `ReviewAgent(agent)`                 | one-shot audit: health + collisions + coverage gaps + un-typeable utterances, as an actionable report |

(`ValidateChange` — the read-only verdict composite — lives in group E above;
these orchestration loops call it to judge their own proposed changes.)

### Mapping to journeys & modes

- **J1 (author)** → delegate to `onboarding`; `studio` picks up at install.
- **J2 (schema)** → B (`ProposeActionsFromUtterances`, `AddAction`) + A (`GetCoverage`).
- **J3 (grammar)** → B (`ProposeGrammarVariations`, `AddGrammarRule`) + D (`RunUtterances`).
- **J4 (regression, headline)** → E (`ReplayCorpus`, `DetectRegressions`, `ValidateChange`).
- **J5 (trace)** → A (`GetTrace`).
- **J6 (observe)** → A (`QueryEvents`).
- **Mode A (human)** uses Tiers 1–2 via the UI. **Mode B (agent)** uses Tier 3
  end-to-end. **Mode C (hybrid)** runs Tier 3 with `dryRun` + approval
  checkpoints so the human confirms each mutation.

### Build ordering (kept honest)

Ship **A (Inspect)** first — fully agent-drivable today, zero mutation risk.
Then **D (Run/try)** and **C (Corpus)**, then **E (Validate)** once real
two-version replay lands, then **B (Author/edit)** and finally **F
(Orchestrate)**, which composes everything. The phasing in §7 reflects this.

## 4. Architecture — the agent hosts the one runtime

> **Decision (Option B).** The Studio runtime is instantiated **once, inside this
> agent**, in the agent-server. The `typeagent-studio` extension, the
> `vscode-shell` canvas, an AI orchestrator (MCP), and the CLI are all
> **clients** of it — none builds its own runtime. This is the same shape as the
> rest of the system: `code` : `coda` :: `studio` : `typeagent-studio` (the agent
> holds the capability + a channel; the extension is the rich client/view). See
> [`DESIGN.md` §3.5](./DESIGN.md).

- **The agent owns the runtime.** Its handler constructs the context-agnostic
  Studio runtime from `@typeagent/core/runtime` (`createStudioRuntimeCore`),
  which wires `InMemorySandboxManager` + `createRepoAgentLoader`,
  `FileHealthService`, `FileCorpusService`, `InProcessCollisionService`,
  `createRepoGrammarScanner`, and `replayCorpus`.
- **The shared engine is already extracted.** `@typeagent/core/runtime` is the
  context-agnostic runtime (the former extension `studioRuntimeCore`, now in
  core). The agent consumes it directly; the extension consumes it **only as a
  transitional bootstrap** and migrates to driving this agent over the
  agent-server (see §8 and the implementation plan's phasing).
- **Typed result / event channel.** Rich clients need typed results (not chat
  markdown) and a live event stream (health changed, replay rows, trace tail).
  The agent exposes a structured channel for this — mirroring how the `code`
  agent serves `coda`. Results flow client←agent; events flow agent→client.
- **Repo root / search paths.** A single place resolves the repo root (the
  agent), so clients never diverge. The inspect/run actions accept the target
  explicitly where it matters (an orchestrator supplies it); the agent falls
  back to a configured root / `TYPEAGENT_STUDIO_REPO_ROOT` / cwd. Clients that
  know the workspace (the extension) pass it in rather than letting the agent
  guess.
- **State / profile.** Follow the onboarding agent's convention
  (`~/.typeagent/studio/...`) for any persisted state (e.g. replay run history),
  via an `AGENTS.md`-style `workspace.ts`.

## 5. Human-in-the-loop / approval boundary (hybrid mode)

Mirror onboarding's `pending → in-progress → approved` checkpoint model for any
**mutating** or **judgment** step:

- **Autonomous-safe** (no approval): all of group **A (Inspect)**; the
  **deterministic read-only** group **E** analyses — `ScanCollisions`,
  `HealthGate`, `DiffGrammars`, `CoverageDelta`, `CollisionsDelta`, and
  `ReplayCorpus` / `ValidateChange` **under the `needs-explanation` policy**; and
  `RunUtterance` **when it executes in a throwaway sandbox**.
- **Needs approval / `dryRun` first (or an explicit allow-list)**: group **C**
  writes (`SeedInRepoCorpus`, `AddExternalCorpus`, `PromoteCaptures` — already
  guarded in the extension by a confirmation) and all of group **B
  (Author/edit)** (schema/grammar edits), plus anything that commits; **sandbox
  lifecycle that persists state** (`StartSandbox` / `LoadAgent` against a
  non-throwaway sandbox); and any **cost-bearing or external-calling** run —
  notably `ReplayCorpus(live-llm)` and large-corpus replays, which surface a cost
  estimate before firing. The agent proposes a diff/plan; a human (or an
  allow-listed policy) approves.
- **Tier 3 orchestration** runs the whole loop but pauses at each group-B/C
  mutation for the same checkpoint, so `TuneAgent` is safe to invoke
  autonomously — it can't write without sign-off unless explicitly allow-listed.
- **Feedback labels stay human.** The agent may _propose_ labels
  (`ProposeFeedbackLabels`) and a regression verdict from `ReplayCorpus` deltas,
  but authentic 👍/👎 is the human anchor.

## 6. Agent structure (follows the onboarding template)

```
packages/agents/studio/src/
  studioManifest.json        ← manifest; emoji 🔌; declares sub-action groups
  studioSchema.ts            ← top-level coordination actions
  studioSchema.agr           ← grammar for top-level actions
  studioActionHandler.ts     ← instantiate(); routes by actionName
  lib/
    runtime.ts               ← constructs the headless core runtime
    workspace.ts             ← persisted state under ~/.typeagent/studio/
  sandbox/  health/  collisions/  corpus/  replay/   ← per-group schema/grammar/handler
```

Registration: add `"studio": { "name": "studio-agent" }` to
`packages/defaultAgentProvider/data/config.json`. Package declares the standard
`./agent/manifest` + `./agent/handlers` exports. MCP exposure is then automatic.

## 7. Phasing — see the unified plan

The agent's S0–S5 phases are **sequenced inside the single implementation plan**,
[`05-implementation-plan.md` §11](./05-implementation-plan.md#11-phasing--concrete-sequencing),
interleaved with the extension phases so each capability ships as one core
primitive + both presenters. The "agent phase ↔ plan phase" table there is the
source of truth. Summary of what each agent phase delivers (groups from §3):

- **S0 — headless runtime extraction (P-0).** Lift the engine wiring out of the
  extension's `studioRuntimeCore` into a context-agnostic runtime in
  `@typeagent/core` that both presenters consume. No behavior change.
- **S1 — Inspect, group A (P-1).** Read-only; proves MCP/conversational
  drivability with zero mutation risk. **The fast proof-of-concept for modes B/C.**
- **S2 — Run/try + Corpus, groups D, C (P-3).** Sandbox lifecycle,
  `RunUtterance(s)`, corpus seed/add/capture/promote (writes behind approval).
- **S3 — Validate, group E (P-3).** `ScanCollisions`, `HealthGate`,
  `DiffGrammars`, `CoverageDelta`; then `ReplayCorpus` / `DetectRegressions` /
  `ValidateChange` once two-version replay lands — the shared `ActionDelta[]`
  contract the Impact Report webview also renders.
- **S4 — Author/edit, group B (P-4).** `Propose*`, `Add/Edit*`,
  `GenerateGrammarFromSchema`, build actions — mutating, always `dryRun`-able.
- **S5 — Orchestrate, group F (P-6).** `ImproveCoverage`, `FixRegression`,
  `TuneAgent`, `ReviewAgent` — goal-oriented loops that compose S1–S4 (calling the
  read-only `ValidateChange` from group E to judge their own changes) and turn the
  agent from scriptable into autonomous.

## 8. Open questions

- **One agent or two?** Fold tune+validate into a single `studio` agent (simpler
  discovery) vs. separate `studio-tune` / `studio-validate` agents (smaller
  surfaces). Leaning single agent with sub-action groups, like onboarding.
- **Typed result / event channel shape.** Rich clients need typed results + a
  live event stream (§4). What's the channel — a dedicated WebSocket like
  `code↔coda`, the dispatcher's structured `ActionResult` data, or an
  agent-rpc/MCP streaming path? This is the main design task Option B introduces.
- ~~**Sandbox sharing.**~~ **Resolved by Option B:** there is one runtime (in the
  agent), so there is one sandbox set; the extension and orchestrator are clients
  of it. Hybrid mode (human watches in the UI what the agent does) falls out for
  free — no cross-process sandbox reconciliation needed.
- **Where the driving orchestrator runs** (in-editor Copilot, external MCP
  client, CI) — affects auth and which actions are allow-listed autonomous.
- **Relationship to a possible "Studio as MCP host"** (STATUS open decision):
  the `studio` agent makes Studio an MCP _provider_ via the dispatcher already;
  a dedicated MCP host is only needed if we want to bypass the dispatcher.

## 9. Why this is low-risk, high-leverage

- It adds **no new transport** — rides the dispatcher + existing MCP exposure.
- It reuses **already-tested** core primitives; the new code is thin action
  routing plus schema/grammar.
- It makes the **agent-driven and hybrid interaction modes real** without
  blocking on the Impact Report webview — the read-only actions (S1) are
  shippable immediately and are the most naturally agent-drivable surface.
