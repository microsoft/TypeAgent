# TypeAgent Studio — `studio` Agent Plan

> **Status:** Draft. Proposes a new first-party TypeAgent agent (`studio`) that
> exposes the Studio authoring/tuning/validation loop as dispatchable actions,
> making it drivable by an AI orchestrator (and conversationally) — not only by
> the VS Code extension UI.
>
> **Reads with:** [`USER-STORY.md`](./USER-STORY.md) (interaction modes),
> [`STATUS.md`](./STATUS.md) (what's built; agent-drivability direction),
> [`DESIGN.md`](./DESIGN.md) (architecture).

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

## 3. Action surface (first cut)

Each action is a thin wrapper over an existing core primitive, returning that
primitive's **typed result** (the whole point — the result is the agent's data).

| Action (proposed)                                 | Wraps (core primitive)                               | Result                     |
| ------------------------------------------------- | ---------------------------------------------------- | -------------------------- |
| `ListAgents`                                      | `listAvailableAgents`                                | name + emoji list          |
| `StartSandbox` / `StopSandbox`                    | `SandboxManager.start/stop`                          | `SandboxStatus`            |
| `LoadAgent` / `UnloadAgent`                       | `SandboxManager.loadAgent/unloadAgent`               | `SandboxStatus`            |
| `CheckHealth`                                     | `FileHealthService.check`                            | `HealthFinding[]`          |
| `ScanCollisions`                                  | `createRepoGrammarScanner` / `scanGrammarCollisions` | scanned/skipped/collisions |
| `BuildGrammar`                                    | agent `agc` build (task/exec)                        | success + rescan           |
| `ListCorpus` / `SeedCorpus` / `AddExternalCorpus` | `CorpusService.*`                                    | entries / path             |
| `ReplayCorpus`                                    | `replayCorpus(corpus, {vA, vB}, opts)`               | `ActionDelta[]` + summary  |

MVP ordering favors the **read/deterministic** actions first (`ListAgents`,
`CheckHealth`, `ScanCollisions`) — they're the most naturally agent-drivable
(STATUS "agent-drivability" ranking) and need no human judgment — then corpus
mutations, then `ReplayCorpus`.

## 4. Architecture

- **Reuse `@typeagent/core` directly.** The agent's handler constructs the core
  services (`InMemorySandboxManager` + `createRepoAgentLoader`,
  `FileHealthService`, `FileCorpusService`, `InProcessCollisionService`,
  `createRepoGrammarScanner`, `replayCorpus`) — exactly what the extension's
  runtime does, minus the VS Code context.
- **Factor a headless runtime.** The extension's `studioRuntimeCore` already
  contains this orchestration but is shaped around a VS Code-ish context
  (`workspaceState`, `globalStorageFsPath`). Extract the engine wiring into a
  context-agnostic core runtime that **both** the extension and the `studio`
  agent consume. (This is the "split `studioRuntimeCore`" item in STATUS,
  now with a second consumer justifying it.)
- **Repo root / search paths.** The agent resolves its repo root the same way
  the extension does (`resolveRepoRoot` + the planned `agentSearchPaths`), so
  both surfaces see the same agents.
- **State / profile.** Follow the onboarding agent's convention
  (`~/.typeagent/studio/...`) for any persisted state (e.g. replay run history),
  via an `AGENTS.md`-style `workspace.ts`.

## 5. Human-in-the-loop / approval boundary (hybrid mode)

Mirror onboarding's `pending → in-progress → approved` checkpoint model for any
**mutating** or **judgment** step:

- **Autonomous-safe** (no approval): `ListAgents`, `CheckHealth`,
  `ScanCollisions`, `ListCorpus`, `ReplayCorpus` (read-only analysis).
- **Needs approval**: `SeedCorpus` / `AddExternalCorpus` (writes files — already
  guarded in the extension by a confirmation), grammar/schema edits, anything
  that commits. The agent proposes; a human (or an allow-listed policy)
  approves.
- **Feedback labels stay human.** The agent may _propose_ a regression verdict
  from `ReplayCorpus` deltas, but authentic 👍/👎 is the human anchor.

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

## 7. Phasing

- **S0 — headless runtime extraction.** Lift the engine wiring out of the
  extension's `studioRuntimeCore` into a context-agnostic runtime in
  `@typeagent/core` (or a small shared package); the extension switches to it.
  No behavior change; unblocks a second consumer.
- **S1 — read-only `studio` agent.** `ListAgents`, `CheckHealth`,
  `ScanCollisions`, `ListCorpus`. Proves MCP/conversational drivability with
  zero mutation risk.
- **S2 — sandbox + corpus actions.** `StartSandbox`/`LoadAgent`,
  `SeedCorpus`/`AddExternalCorpus` (with the approval checkpoint).
- **S3 — `ReplayCorpus`.** Once the real two-version replay lands, expose it;
  this is the headline agent action and the shared contract the Impact Report
  webview also renders.

## 8. Open questions

- **One agent or two?** Fold tune+validate into a single `studio` agent (simpler
  discovery) vs. separate `studio-tune` / `studio-validate` agents (smaller
  surfaces). Leaning single agent with sub-action groups, like onboarding.
- **Sandbox sharing.** Should the `studio` agent and the extension share one
  sandbox set, or run isolated ones? Sharing enables true hybrid (human watches
  in the UI what the agent does); isolation is simpler. Likely: shared, keyed by
  repo root + sandbox id.
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
