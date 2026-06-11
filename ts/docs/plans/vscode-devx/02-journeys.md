# TypeAgent Studio — Phase 3: Personas & Journeys

> **Status:** Drafted 2026-05-14, after Phase 1 inventory ([01-inventory.md](./01-inventory.md)) and Phase 2 open-question resolutions (§13 of the inventory).
>
> **Scope:** Capture the six developer journeys that TypeAgent Studio targets, the personas that walk them, the in-flight work that intersects each, and the success/exit criteria that tell us a journey is "done enough" for MVP.
>
> **Anchor agent (MVP):** `player` (Phase 2 / Q-P4).
> **Center of gravity:** compare-and-replay — _"change schema/grammar; see action-level impact against a corpus of real utterances, annotated with the user-feedback labels we already collect."_

---

## 0. Reading order and how this file relates to the rest

| File                                 | Role                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [01-inventory.md](./01-inventory.md) | What exists today (§1–§7), gaps (§0, §8), in-flight work (§10 collisions, §11 MCP, §12 feedback), and Phase 2 decisions (§13). |
| **02-journeys.md (this file)**       | What developers _do_ with Studio. Defines journeys J1–J6, the personas, and the success criteria that gate MVP.                |
| 03-features.md (next deliverable)    | Per-journey feature sketch at three layers (editor / panels / commands), mapped to inventory primitives.                       |
| 04-mvp-slice.md (subsequent)         | Vertical slice across all six journeys that becomes the MVP scope.                                                             |
| 05-implementation-plan.md            | How we build it; sequencing, API shapes, file layouts.                                                                         |

Journeys are intentionally **independent of feature sketches**. A journey is a story the developer experiences end-to-end; the features are the specific UI affordances we build to make that story possible. Keeping them separate lets us change one without breaking the other.

---

## 1. Personas

Six personas, derived from the inventory's capability surface and the parallel plan's `we-have-a-giant-declarative-platypus.md` Phase B. One developer typically wears multiple hats; the personas are roles, not people.

| #      | Persona                        | Owns                                               | Today's friction                                                                                                                                                  |
| ------ | ------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | **Agent Author**               | A new agent from scratch.                          | `onboarding` agent works but is CLI/MCP-hidden. Without it: hand-copy four files and pray dispatcher picks the agent up. No health check (§0 obs 9).              |
| **P2** | **Schema Designer**            | The TypeScript action surface (`<name>Schema.ts`). | `examples/schemaStudio` CLI exists but isn't in the editor. No "load corpus, see misses" view. Action collisions surface late (§10).                              |
| **P3** | **Grammar Tuner**              | The `.agr` file.                                   | `agr-language` debug panel exists but loads one `.txt` corpus at a time. No federation. No direct schema-context tie-in.                                          |
| **P4** | **Quality / Regression Owner** | "Did this change make things better or worse?"     | `diffGrammars` is structural. No action-level / utterance-level delta. No batch report. Feedback labels (PR #2341, §12) are not yet wired into a regression view. |
| **P5** | **Trace Investigator**         | "This one real utterance went wrong — why?"        | Profiler is polled; `debug("typeagent:*")` is stderr text; reasoning traces are POC-grade and uncorrelated. No "all 👎 traces this week" worklist.                |
| **P6** | **Live Observer**              | Demos, internal review, perf spot-checks.          | `vscode-shell` shows chat; no dispatch-event trace stream. No per-session live mirror.                                                                            |

**The MVP must serve P1 (entry door) and P4 (the headline value) end-to-end.** P2/P3 are heavily exercised inside P4's workflow. P5/P6 are the per-trace zoom and the live mirror; they share the structured-event infrastructure that P4 needs anyway.

---

## 2. Journeys overview

Six journeys. Numbered to match the parallel plan and to be referenceable in feature work.

| #      | Journey title                                 | Primary persona(s) | Why it matters                                                                                                                  | MVP depth                                                                                                  |
| ------ | --------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **J1** | Stand up a new agent                          | P1                 | The entry door. Without it, the platform stays one-team-deep.                                                                   | Minimal viable: wizard exists, onboarding agent works behind it, scaffold compiles and dispatches.         |
| **J2** | Tune the schema against real utterances       | P2                 | Schemas drift. Real utterances reveal action shapes the designer didn't anticipate.                                             | Moderate: load corpus, see typed-action mapping per utterance, see un-typeable utterances.                 |
| **J3** | Tune the grammar against utterance variations | P3                 | Same intent, many phrasings — grammar must cover them without forcing a cache miss / LLM round-trip every time.                 | Light: existing `agr-language` linked into Studio. Federation comes via the same corpus service J2 builds. |
| **J4** | Find a regression (compare-and-replay)        | P4                 | **The headline.** Compare schema or grammar versions against a corpus, see action-level impact, annotated with feedback labels. | **Deep.** The defining MVP capability.                                                                     |
| **J5** | Debug a single failing trace                  | P5                 | When the report flags an utterance, you need to walk one trace to ground truth.                                                 | Light in MVP: navigate from a failure row to a trace view; trace primitives may stay polled.               |
| **J6** | Observe a live session                        | P6                 | Demos, live debugging, "watch the system breathe."                                                                              | Minimal: status bar + a basic event tail; reuses the same structured event stream as J5.                   |

The **center of gravity (compare-and-replay)** cuts hardest through J2, J3, J4. J5 is per-trace zoom-in. J1 is the entry door. J6 is the live mirror.

---

## 3. Cross-journey assumptions (from Phase 2)

All journeys assume the following, established in §13 of the inventory:

- **Dispatcher isolation (Q2).** Every journey runs against a **sandboxed agent-server** (or in-memory dispatcher, by config) that is separate from the developer's personal active TypeAgent. Studio's tuning experiments do not leak into the dev's everyday usage. Agents in the sandbox are loaded/unloaded dynamically based on the journey context.
- **Anchor agent for MVP is `player`** (Q-P4). Building the player corpus is itself part of the MVP work; it forces the federated-corpus capture path to be MVP-quality.
- **Corpus federation (Phase 2 / parallel-plan design).** Three source types: in-repo `corpus/<agent>.utterances.jsonl`, per-user captures under `~/.typeagent/profiles/<studio-instance>/captures/`, external repo sources declared in `.typeagent/studio.json`. Provenance metadata travels with each utterance.
- **Feedback corpus (PR #2341, §12).** Every agent message in the sandbox emits a labelable bubble. `userFeedback` events land in displayLog + Cosmos/Mongo. The `@feedback export --format jsonl` flow is already a corpus interchange format; Studio uses it natively.
- **Action collision events (§10).** Collision detection runs at four detection points with experimentId tagging. These events are first-class in the structured event stream; J4 and J5 surface them directly.
- **Structured event stream (cross-cutting).** A new typed event API in `typeagent-core` emits at high-value sites (dispatcher phases, cache hit/miss, grammar match outcome, collision detection, reasoning trace steps). The 180+ `debug()` sites stay; the new API runs alongside.
- **Replay-miss policy is developer-controlled** per replay run: mark-as-needs-explanation (default), auto-explain-via-live-LLM (slow, costs tokens), strict cache-only (fastest, lossy).

---

## 4. The journeys

Each journey below has the same five-part shape:

1. **Story** — narrative walkthrough from the persona's POV.
2. **Entry points** — how the developer starts the journey.
3. **Touched primitives** — which existing inventory pieces this journey uses.
4. **In-flight work it intersects** — PR #2341 feedback, §10 collisions, §11 MCP / onboarding, the structured event stream.
5. **Success criteria** — what makes this journey "done" for MVP.

---

### J1 — Stand up a new agent

**Persona:** P1 (Agent Author). Often a developer brand-new to TypeAgent.

#### Story

> Aïda wants an agent that controls a smart-home thermostat. She opens VS Code, runs **TypeAgent Studio: New Agent** from the command palette. A panel asks her what the agent should do, in plain English. She types two paragraphs. Studio runs the `onboarding` agent's seven phases — Discovery → PhraseGen → SchemaGen → GrammarGen → Scaffolder → Testing → Packaging — each in its own revisitable panel with a "guided" toggle that walks her in order. When the SchemaGen output looks wrong, she jumps back to PhraseGen, adds three phrasings, and re-runs SchemaGen without losing later state. At the end she clicks **Install into sandbox**. The sandboxed dispatcher restarts with `thermostat` loaded. She types "set the living room to 68" into vscode-shell. It works.

#### Entry points

- Command palette: `TypeAgent Studio: New Agent`.
- A "New agent…" entry in the Studio activity-bar tree.
- Conversational: `@typeagent create an agent for X` in Copilot Chat or vscode-shell (routes to the same `onboarding` agent).

#### Touched primitives (from inventory)

- `packages/agents/onboarding/` — the 7-phase scaffolder.
- `actionSchema.generateSchemaTypeDefinition` — the `Discovery → SchemaGen` glue.
- `actionGrammar.generation.SchemaToGrammarGenerator` — the `SchemaGen → GrammarGen` glue.
- `packages/defaultAgentProvider/` — agent registration target.
- `packages/agentSdk/` — the `AppAgent` contract the generated handler implements.

#### In-flight work this journey intersects

- **§11 (conversational authoring).** Conversation is the primary entry door; the panel UI is a structured view of the same conversation.
- **The "agent health check" gap (§0 obs 9).** This journey is the first place a health check can run end-to-end on a fresh agent — manifest ↔ schema ↔ grammar ↔ handler coherence. The Testing phase of `onboarding` is the natural home.
- **Sandbox dispatcher (Q2).** "Install into sandbox" is the only install target in MVP. No effect on the dev's personal agent-server.

#### Success criteria (MVP)

- A developer with **zero TypeAgent prior** can produce a working agent (schema + grammar + handler + manifest + provider registration) that handles **at least one utterance variation per phrasing example** they gave at phase 2.
- The sandboxed dispatcher restarts and the agent answers without manual file edits or `pnpm` commands.
- The seven phases are revisitable; re-running phase 3 does not destroy state in phases 4–7 (it triggers explicit reconciliation prompts instead).
- A health check at the end of phase 7 passes; if it fails, the failure points at a specific phase/panel to fix.

---

### J2 — Tune the schema against real utterances

**Persona:** P2 (Schema Designer). The agent exists; new utterances are arriving.

#### Story

> Bruno owns the player agent's schema. He opens **Schema Studio** in TypeAgent Studio. Left pane: the player corpus (in-repo `corpus/player.utterances.jsonl` plus his recent sandbox captures, plus the labeled feedback corpus from `@feedback export`). Right pane: `playerSchema.ts`. Center pane: per-utterance mapping rows showing `(utterance, matched typed action, args, source)`. He filters to 👎-rated utterances. Several are tagged `wrong-agent`. One reveals a missing `PlayAlbum` variant. He extracts an action shape via a code-action, names it, and the schema updates. Studio re-types the affected rows live. He commits.

#### Entry points

- Activity-bar tree: open a schema → "Open in Schema Studio."
- Command palette: `TypeAgent Studio: Schema Studio` with the current schema preselected.
- Code lens on each action type: "Matched by N corpus utterances; M unmatched." Clicking opens Schema Studio focused on the unmatched.

#### Touched primitives

- `actionSchema` parser + `generateSchemaTypeDefinition`.
- `cache` ConstructionCache (schema-hash-keyed; the disk view of past matches per schema version).
- `schemaAuthor` LLM helpers for action-variant suggestion.
- `examples/schemaStudio` CLI (`@fromSchema`, `@variations`, `@mergeCaches`) — graduated into the webview.
- Federated corpus service (built for this journey, reused everywhere).

#### In-flight work this journey intersects

- **Feedback corpus (PR #2341, §12).** The 👎-filter is the headline use of feedback for schema work. Categories (`wrong-agent | didnt-understand | bad-response | other`) directly drive Schema-Studio filter chips.
- **Action collisions (§10).** When Bruno adds `PlayAlbum`, the collision detector fires if it overlaps `PlayTrack`. Studio surfaces the collision inline (don't make him hunt for it in a separate report). Resolution strategies show as quick-fix options on the diagnostic.
- **§12 / dblogging default-on.** Feedback events from any developer (not just Bruno) are visible in Schema Studio's corpus when remote-sink read access is enabled.

#### Success criteria (MVP)

- Loading a federated corpus for `player` shows every utterance grouped by (matched action / unmatched), with feedback labels where present.
- Filtering by `rating: down`, `category: wrong-agent` returns the expected subset.
- An un-typeable utterance produces an actionable suggestion (add field, split variant) tied to a code-action on the schema file.
- Adding a new action variant that collides triggers the collision detector inline; the developer sees the collision _before_ commit.
- A schema edit re-evaluates the per-utterance mapping rows visibly within a few seconds (no full daemon restart for incremental edits).

---

### J3 — Tune the grammar against utterance variations

**Persona:** P3 (Grammar Tuner). The action types are right; users phrase requests in N+1 ways.

#### Story

> Casey owns `playerSchema.agr`. The `agr-language` debug panel in Studio loads the same federated corpus as Schema Studio (not a single .txt file). It shows a list of utterances clustered by intent. The cluster "play music by artist" has 19 utterances; 4 match her current rule, 15 don't. She clicks the rule in the editor; a code lens says "matches 4 corpus utterances; 15 utterances target this action but miss." She opens the debug panel's miss-cluster view, sees the 15 utterances, accepts two suggested rule edits via quick-fix, and re-runs match. 18 now hit. The final hold-out is a typo she leaves alone.

#### Entry points

- `.agr` file open → code lens on each rule → "Show miss cluster."
- From Schema Studio: "Open AGR rule for this action" (cross-link from J2).
- Command palette: `TypeAgent Studio: Auto-grammar from schema` invokes `SchemaToGrammarGenerator` and presents a diff.

#### Touched primitives

- `extensions/agr-language/` — LSP + debug panel (kept; gains `typeagent-core` dependency).
- `grammarTools/core.diffGrammars`, `computeCoverage`, `traceMatch`, `formatTrace`.
- `grammarTools/ui` Lit components.
- `actionGrammar.generation.SchemaToGrammarGenerator` + `ClaudeGrammarGenerator`.
- Federated corpus service (shared with J2).

#### In-flight work this journey intersects

- **§11 (conversational authoring).** Casey can ask `@typeagent` "make this rule also match 'queue up X'" without leaving the editor; the conversational path produces a diff she reviews before commit.
- **§10 (collisions).** Grammar collisions surface in `agr-language`'s existing trace tooling; J3 simply hosts those views inside Studio.

#### Success criteria (MVP)

- Existing `agr-language` capabilities continue to work unchanged after the refactor to depend on `typeagent-core`.
- The debug panel loads the federated corpus (not just a `.txt` file).
- Code lens on a rule reports both "matched by N" and "targeted but missed by M."
- A miss-cluster view surfaces grouped misses; at least one suggested rule edit is available per cluster.
- Cross-link from Schema Studio to a specific AGR rule (and back) works.

---

### J4 — Find a regression (compare-and-replay)

**Persona:** P4 (Quality / Regression Owner). **The headline journey.**

#### Story

> Dani changed `playerSchema.ts` and `playerSchema.agr` on a feature branch. From the source-control gutter or the command palette, they run **TypeAgent Studio: Replay corpus across versions** with `working tree` vs `HEAD~1`. Studio loads the federated `player` corpus (in-repo + captures + the labeled feedback corpus). It replays each utterance against both versions in the sandboxed dispatcher. Twenty seconds later the **Impact Report** opens.
>
> The report has four panes:
>
> 1. **Structural diff** — `diffGrammars` output.
> 2. **Coverage delta** — `computeCoverage` before/after.
> 3. **Action-level delta** _(the new primitive)_ — every utterance where vA and vB produced different action JSON. Each row is annotated with a feedback label when present: a `👎` on the vA action with category `bad-response` shows green here ("you fixed a known bad response"); a `👍` on vA with a different vB action shows red ("you may have broken something users liked"). Cells that hit a cache miss in vB show the developer-chosen replay-miss state (needs-explanation / live-LLM-resolved / strict).
> 4. **Collisions delta** — any new action collisions vB introduced vs vA (data from the §10 detectors).
>
> Dani filters action-level rows to "red" (likely-bad changes). Two rows remain. They click one; J5 opens with that trace fully expanded.

#### Entry points

- Command palette: `TypeAgent Studio: Replay corpus across versions`.
- Source-control gutter: right-click → "Compare working tree vs HEAD against corpus."
- From J2 or J3: "Run replay against this change."
- (Future) CI hook: the same primitive exposed as a CLI for PR validation. Not in MVP.

#### Touched primitives

- `grammarTools/core.diffGrammars`, `computeCoverage`.
- `cache.constructionMatch` for replay against version A's cache.
- `actionGrammar.matchGrammar` for version B comparison.
- Federated corpus service.
- Feedback corpus (PR #2341) — the only labeled signal that lets the report annotate "better" vs "worse," not just "different."
- Collision detection (§10) — fed in as the fourth diff lens.
- **New primitive:** `replayCorpus(corpus, {versionA, versionB}, options) → ActionDelta[]`. Single missing engine piece in `typeagent-core`.

#### In-flight work this journey intersects

- **All of it.** This is the journey that justifies every other primitive existing.
- **PR #2341 (§12).** Without feedback labels the Impact Report is just "different." With them it becomes "different _and judged by humans to be worse_ (or better)" — the difference between a curiosity and a decision-grade tool.
- **§10 (collisions).** Collisions are surfaced as a fourth diff lens, not a separate report.
- **Structured event stream.** Each replay run emits structured events; the report reads from the event log so individual rows can drill into J5.

#### Success criteria (MVP)

- A replay across **the full player corpus** (in-repo + captures + feedback) finishes in **under one minute** on a developer laptop with the default replay-miss policy.
- The report shows all four lenses (structural / coverage / action-level / collisions).
- Action-level rows are annotated with the latest feedback label per `requestId` when one exists. Rows without a label render gracefully.
- Filtering rows by "likely-bad change" (= changed action where the prior version had 👍 _or_ current version's matching feedback is 👎) returns the expected subset.
- Each row links to J5 for full-trace investigation.
- The developer can choose the replay-miss policy per run; the choice is remembered per workspace; the auto-explain mode shows estimated LLM-call count + cost before firing.
- **Validation gate:** the report must agree with developer judgment on a hand-labeled regression set for `player` before the journey is declared MVP-complete.

---

### J5 — Debug a single failing trace

**Persona:** P5 (Trace Investigator). Arrived from J4, or from a direct "this utterance is wrong" report.

#### Story

> Eli arrives in **Trace Viewer** from a J4 red row, or by right-clicking a 👎 message in vscode-shell. The viewer renders the full dispatch tree for that requestId: user prompt → grammar match attempts (with which rules matched/missed) → cache hit/miss → translation phase (with LLM calls if any) → action selection → execution → result. Every node carries timing. Collision events (§10) for that trace are inline. Reasoning trace steps (when available) are correlated by requestId. Eli clicks a grammar miss node; jumps to the `.agr` line that _should_ have matched and didn't.

#### Entry points

- From J4: any row → "Open trace."
- From vscode-shell: 👎 on a bubble → "Investigate this trace."
- Command palette: `TypeAgent Studio: Replay this trace` with a `requestId`.
- A "Trace history" tree view (recent N traces in the sandbox).

#### Touched primitives

- `ProfileLogger` / `ProfileEntry` tree (wrapped in a streaming subscriber via the new structured event stream).
- `displayLog.json` per session (the source of truth for the trace, now including feedback entries).
- Reasoning traces under `reasoning/tracing/` — correlated by requestId.
- `cache` for "what did the cache see?" replay.

#### In-flight work this journey intersects

- **The structured event stream** is the substrate. Without it, trace assembly is hand-correlating polled profiler output with debug text.
- **PR #2341 (§12).** Feedback rows are visible inline on the trace timeline (and the developer can re-rate or correct the category from the viewer).
- **§10 (collisions).** Collision events render as inline annotations on the affected nodes.

#### Success criteria (MVP)

- Open a Trace Viewer for any requestId from the current sandbox session within a couple of seconds.
- Render: grammar match steps, cache match/miss, LLM calls (model + token usage if available), action selection, execution, feedback (if any), collision events (if any).
- Click any grammar match step to jump to the `.agr` source line; click any action step to jump to the schema variant.
- "Replay this trace" against the current sandbox produces a fresh trace and a row-by-row diff against the original.

---

### J6 — Observe a live session

**Persona:** P6 (Live Observer). Demos, customer reviews, internal review meetings, perf spot-checks.

#### Story

> Fatima is demoing the `player` agent to stakeholders. She opens **Live Trace** in Studio (sibling panel to vscode-shell's chat). As she types requests into the chat, the panel shows a live tail of the structured event stream — phase boundaries, cache hits, action selections — one line per event. The status bar shows "TypeAgent: connected / 14 events/min." A stakeholder asks "why was that one slow?" — she clicks the slow row, jumps into J5 for the full trace, then back out to live mode.

#### Entry points

- Command palette: `TypeAgent Studio: Live Trace`.
- Status-bar item: "TypeAgent: connected" → click for panel.
- Auto-opens during a demo mode (if vscode-shell's existing demo-runner is active).

#### Touched primitives

- The same structured event stream that J5 consumes — but tailing instead of replaying.
- `vscode-shell`'s existing agent-server WS (one connection shared via `typeagent-core`).

#### In-flight work this journey intersects

- **The structured event stream.** J6 is the smallest viable consumer; it's a great forcing function for getting the API shape right.
- **PR #2341 (§12).** Live feedback events appear in the tail as they happen — the audience can literally see a 👎 being recorded.

#### Success criteria (MVP)

- Status-bar indicator shows connection state and a recent event rate.
- Live Trace panel shows a tail of structured events with at least: phase start/end, cache hit/miss, action selected, feedback recorded, collision detected.
- Click-through to J5 works for any row.

---

## 5. Cross-journey infrastructure (which journey forces which build)

Single primitives serve multiple journeys. To avoid double-building, map each cross-cutting piece to the journey that _forces_ it to exist, then list the dependents:

| Primitive                                                             | Forced by              | Reused by                                        |
| --------------------------------------------------------------------- | ---------------------- | ------------------------------------------------ |
| **Sandboxed dispatcher lifecycle** (Q2)                               | J1                     | All journeys                                     |
| **Federated corpus service**                                          | J2                     | J3, J4, J5                                       |
| **`replayCorpus()` engine primitive**                                 | J4                     | (J2 incrementally; J5 for single-trace replay)   |
| **Structured event stream**                                           | J4 (impact report)     | J5, J6                                           |
| **Feedback corpus integration** (PR #2341 wired into corpus + report) | J4                     | J2, J3, J5                                       |
| **Collision-event annotation surface** (§10)                          | J2 (inline diagnostic) | J4 (diff lens), J5 (trace annotation)            |
| **Trace viewer scaffolding**                                          | J5                     | J4 (drill-in), J6 (drill-in)                     |
| **Agent health check**                                                | J1 (final phase)       | J2/J3 (sanity check after edit), J4 (per-replay) |

This table is also the build dependency graph for Phase 5 (implementation plan).

---

## 6. What's deliberately _not_ in any MVP journey

To keep MVP focused, the following are explicitly **out of scope** and will be revisited post-MVP:

- **Multi-agent / multi-corpus simultaneous replay.** MVP demonstrates `player` against one corpus. The `code` 684-utterance corpus is the second-agent validation target — exercised after MVP feature-complete to prove federation scales.
- **Workflow authoring UI** beyond view-only rendering (Phase 2 / Q5).
- **MCP host role** for Studio (Phase 2 / Q8).
- **Marketplace publication** (Phase 2 / Q-P3 deferred).
- **Mass migration of 180+ `debug("typeagent:*")` sites** to structured events. New high-value sites emit both; the legacy stream is left alone.
- **Reasoning trace UI redesign.** Existing traces are surfaced in J5 read-only; turning them into a first-class authoring tool is post-MVP.
- **Cross-agent collision navigator.** The §10 system surfaces collisions for the active agent; cross-agent overlap detection is a follow-on capability.

---

## 7. Open items carried into Phase 3 (features) and Phase 4 (MVP slice)

These are decisions the journeys imply but don't fix. Phase 3 / 4 must resolve them:

1. **Corpus capture UX for `player`.** The MVP anchor has no corpus today (Q-P4). What is the developer interaction for building one — pure cache capture, hand authoring, both? Where does the captured file live (`corpus/` checked in vs `~/.typeagent/.../captures/`)? Pre-MVP work, blocks J4 demo.
2. **`replayCorpus()` engine surface.** Signature, transport (in-process vs WS), batching strategy. Forced by J4. Likely lives in `typeagent-core`.
3. **Structured event protocol shape.** Event types, payload schemas, transport, schema versioning. Forced by J4/J5/J6.
4. **Feedback re-rating from Trace Viewer (J5).** Is editing a rating from inside the trace allowed? Implementation-wise the dispatcher RPC supports it; UX-wise it may be confusing if the trace is from a different session than the current sandbox.
5. **Impact Report's "likely-bad change" definition.** The journey states the intent; the exact predicate (which mix of feedback rating, category, replay-miss state) is a tuning decision.
6. **Sandbox lifecycle UI.** Who restarts the sandbox? Auto on agent install? Manual control? Status indicator location?
7. **Agent health-check rule set.** What does Studio actually validate at the end of J1 phase 7? Manifest ↔ schema ↔ grammar ↔ handler ↔ provider — but the specific rules are TBD.

---

## 8. Validation (for this journey doc itself)

Before this file is "done," confirm with the user:

- [ ] The six journeys cover the actual dev workflows (no missing one, none feel artificial).
- [ ] The MVP depth label per journey is the right ambition (e.g., J3 stays "light" because `agr-language` already exists; J4 is "deep" because it's the headline).
- [ ] The MVP success criteria per journey are testable.
- [ ] J4's "validation gate" requirement (the Impact Report must agree with developer judgment on a labeled regression set) is acceptable as the MVP-complete check.
- [ ] `player` as the anchor agent does not break any journey (the journeys are agent-agnostic in their bones, but the demos all reference `player`).
- [ ] The seven open items in §7 are the right cuts to defer to Phase 3 / 4.

---

_End of Phase 3 journeys draft._
