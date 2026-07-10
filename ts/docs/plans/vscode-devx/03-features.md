# TypeAgent Studio — Phase 3: Features

> **Status:** Drafted 2026-05-14, after [02-journeys.md](./02-journeys.md).
>
> **Purpose:** Per-journey feature sketch at three layers — **editor surfaces**, **panels / webviews**, **commands & RPCs** — mapped back to inventory primitives ([01-inventory.md](./01-inventory.md)). This is _what we build_, not yet _in what order_ (Phase 4 sequences a vertical slice).
>
> **Convention:** Each feature has an ID (`F<journey>.<n>`) so Phase 4 and 5 can reference them directly. A feature is **MVP** if a ✅ box is checked; **post-MVP** otherwise.

---

## 0. The three layers

Every feature lives in one of three layers. Keeping them separate forces us to ask "is this UI a webview, or could it be a code lens?" early instead of late.

| Layer               | What lives there                                                                                                                    | Examples                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Editor**          | Anything that lives _on the file the developer is editing_: code lenses, hover, diagnostics, code actions, decorations, status bar. | Code lens on an AGR rule reporting corpus match count; diagnostic on a colliding schema variant. |
| **Panels**          | Webviews and tree views in Studio's activity bar.                                                                                   | Schema Studio, Impact Report, Trace Viewer, Live Trace tail.                                     |
| **Commands & RPCs** | Command-palette entries and the dispatcher / sandbox RPCs they invoke.                                                              | `TypeAgent Studio: Replay corpus across versions`; `replayCorpus()` RPC.                         |

A single capability (e.g. "find utterances missed by this AGR rule") often manifests on all three layers — a lens on the rule, a panel that lists them, a command that opens the panel.

---

## 1. Cross-cutting features (used by every journey)

These are the platform pieces the journeys all assume. Phase 4's MVP slice has to budget for them up front.

### F0.1 — Sandbox dispatcher lifecycle ✅ MVP

- **Editor:** Status bar item `TypeAgent: sandbox running (player loaded)` with click-to-toggle.
- **Panels:** Tree view "Sandbox" under Studio activity bar — shows loaded agents, last restart, current schema/grammar hashes per agent.
- **Commands:** `TypeAgent Studio: Start sandbox`, `Restart sandbox`, `Stop sandbox`, `Load agent into sandbox`, `Unload agent`.
- **RPCs (new, on typeagent-core):** `sandbox.start({ agents, mode: "subprocess"|"inmemory" })`, `sandbox.restart()`, `sandbox.loadAgent(path)`, `sandbox.unloadAgent(name)`, `sandbox.status()`.
- **Maps to:** Phase 2 / Q2 hybrid isolation.

### F0.2 — Federated corpus service ✅ MVP

- **Editor:** Code lens on `*Schema.ts` and `*.agr`: "Corpus: N utterances available."
- **Panels:** Tree view "Corpora" — three roots: in-repo (`corpus/<agent>.utterances.jsonl`), captures (`~/.typeagent/profiles/<studio>/captures/`), external sources (declared in `.typeagent/studio.json`). Each utterance shows provenance.
- **Commands:** `TypeAgent Studio: Open corpus for agent`, `Import corpus…`, `Add external corpus source`, `Capture this session to corpus`.
- **RPCs:** `corpus.list(agent)`, `corpus.load(agent, filters)`, `corpus.append(agent, entries)`, `corpus.exportJsonl(agent)`.
- **Maps to:** Phase 2 / parallel-plan corpus design. Reuses `@feedback export --format jsonl` schema verbatim.

### F0.3 — Structured event stream ✅ MVP

- **Editor:** —
- **Panels:** —
- **Commands:** `TypeAgent Studio: Open event log`, `Export event log…`.
- **RPCs:** `events.subscribe({filter})` (returns a stream), `events.query({since, filter})`, `events.versions()`.
- **Event types (MVP set):** `phase.start`, `phase.end`, `cache.hit`, `cache.miss`, `grammar.match.attempt`, `grammar.match.result`, `action.selected`, `action.executed`, `feedback.recorded` (PR #2341), `collision.detected` (§10), `reasoning.step`.
- **Maps to:** §13 / Q9-adjacent and §0 obs 8. Sits alongside `debug("typeagent:*")` — no migration in MVP.

### F0.4 — Feedback corpus integration ✅ MVP

- **Editor:** —
- **Panels:** Feedback filter chips wherever utterance lists appear (Schema Studio, J3 cluster view, Impact Report row filter).
- **Commands:** `TypeAgent Studio: Filter to 👎`, `… by category…`.
- **RPCs:** wraps existing dispatcher RPCs `recordUserFeedback`, `restoreAllHidden`, `flushHidden`, plus `@feedback list/top/filter/export/count` exposed as RPC-shaped methods.
- **Maps to:** PR #2341 (§12). dblogging-default-on means even Studio-internal demo runs feed the corpus.

### F0.5 — Agent health check ✅ MVP

- **Editor:** Diagnostics on the offending file(s) when manifest ↔ schema ↔ grammar ↔ handler ↔ provider are inconsistent.
- **Panels:** "Health" view in the Sandbox tree per loaded agent: green / yellow / red with rule breakdown.
- **Commands:** `TypeAgent Studio: Run health check`.
- **RPCs:** `health.check(agent)` → `{rule, status, evidence, fixHint}[]`.
- **Initial rule set (open item §7.7 in journeys):** TBD in Phase 4. Seed list: manifest agent name matches package, schema file referenced in manifest exists and parses, grammar file referenced exists and compiles, every schema action type has at least one grammar rule, handler exports `instantiate`, provider registers the agent, no duplicate action-type names across loaded agents.

### F0.6 — Collision-event annotation surface ✅ MVP

- **Editor:** Diagnostic on the offending schema or grammar line with category (overlap / shadow / ambiguity) and quick-fix actions (rename / disambiguate / accept).
- **Panels:** "Collisions" tab in Impact Report (diff lens 4) and inline annotations in Trace Viewer.
- **Commands:** `TypeAgent Studio: Show collisions for this file`.
- **RPCs:** subscribes to `collision.detected` events from F0.3.
- **Maps to:** §10 four detection points (load-time, schema-edit, grammar-edit, replay).

### F0.7 — Conversational entry to Studio ✅ MVP (light)

- **Editor:** —
- **Panels:** Persistent prompt in any Studio panel — "Ask TypeAgent about this…".
- **Commands:** Routes to `onboarding` and `schemaAuthor` agents based on context.
- **Maps to:** §11. MVP scope: existing conversational paths work; no new conversational agents.

### F0.8 — Replay-miss policy control ✅ MVP

- **Editor:** —
- **Panels:** Settings inline in J4 replay launch dialog: `needs-explanation (default) | live-LLM | strict-cache`. Shows estimated LLM call count + cost when `live-LLM` selected.
- **Commands:** Captured in the run config; remembered per workspace.
- **Maps to:** §3 of journeys.

### F0.9 — Workflow view-only rendering ✅ MVP (light)

- **Editor:** —
- **Panels:** Read-only workflow diagram in Trace Viewer when reasoning traces include workflow steps.
- **Maps to:** Phase 2 / Q5.

### F0.10 — Reasoning trace read-only surface ✅ MVP (light)

- **Editor:** —
- **Panels:** "Reasoning" tab in Trace Viewer (J5), correlated by requestId. Existing POC trace format rendered as-is; no redesign.
- **Maps to:** §6 exclusions in journeys.

---

## 2. J1 — Stand up a new agent

**Headline:** the wizard panel that hosts the `onboarding` agent's 7 phases.

### F1.1 — New Agent wizard panel ✅ MVP

- **Editor:** —
- **Panels:** Single webview hosting all 7 phases as revisitable tabs (Discovery / PhraseGen / SchemaGen / GrammarGen / Scaffolder / Testing / Packaging). Guided mode toggle defaults on. Per Phase 2 / Q-P2 each phase is revisitable but a guided default exists.
- **Commands:** `TypeAgent Studio: New Agent`.
- **RPCs:** wraps `onboarding` agent's existing phase actions; adds `onboarding.snapshot()` and `onboarding.restorePhase(name)` to support revisiting without state loss.

### F1.2 — Conversational entry ✅ MVP

- `@typeagent create an agent for X` in Copilot Chat or vscode-shell routes through `onboarding`. Same backing flow as F1.1.

### F1.3 — Install into sandbox action ✅ MVP

- "Install into sandbox" button at end of phase 7. Calls F0.1's `sandbox.loadAgent(path)`. No effect on dev's personal TypeAgent.

### F1.4 — Health-check gate ✅ MVP

- Phase 7 runs F0.5; failures block "Install into sandbox" until acknowledged. Failures link to the relevant phase tab for fix.

### F1.5 — Phase reconciliation prompts ✅ MVP

- Re-running phase 3 (SchemaGen) after phases 4–7 ran offers diff preview and explicit accept/reject; default keeps later-phase work and re-runs from the changed point.

---

## 3. J2 — Tune the schema against real utterances

### F2.1 — Schema Studio panel ✅ MVP

- **Panels:** Three-pane webview: left = corpus rows (via F0.2), right = `<name>Schema.ts` (read/scroll only; edits happen in real editor), center = per-utterance mapping `(utterance, matched typed action, args, source, feedback)`.
- **Commands:** `TypeAgent Studio: Schema Studio`.
- **RPCs:** `schemaStudio.mapUtterances(agent, corpusFilter)` — wraps the existing CLI logic from `examples/schemaStudio`. Returns rows; subscribes to schema file changes to re-evaluate.

### F2.2 — Code lens on action types ✅ MVP

- **Editor:** Lens on each TS action variant: "Matched by N corpus utterances; M unmatched." Click → opens Schema Studio focused on the relevant rows.

### F2.3 — "Suggest variant for un-typeable utterance" ✅ MVP

- **Editor:** Code action on schema file (and on un-typeable rows in F2.1).
- **RPCs:** Uses `schemaAuthor` LLM helper. Returns a suggested variant + variant name; developer accepts to insert into `<name>Schema.ts`.

### F2.4 — Inline collision diagnostic on schema edits ✅ MVP

- Via F0.6 — collisions surface as the developer types, not after a commit.

### F2.5 — Feedback filter chips ✅ MVP

- 👎-only, by category (`wrong-agent`, `didnt-understand`, `bad-response`, `other`), via F0.4.

### F2.6 — Live re-evaluation after schema edit ✅ MVP

- Single utterance re-mapping within a couple of seconds for incremental edits (no daemon restart). Full corpus re-map on demand.

---

## 4. J3 — Tune the grammar

### F3.1 — `agr-language` refactor to use typeagent-core ✅ MVP

- The existing extension consumes the federated corpus service (F0.2), structured event stream (F0.3), and feedback (F0.4) via `typeagent-core`. Keeps its current LSP + debug-panel capabilities unchanged.

### F3.2 — Code lens on AGR rules ✅ MVP

- **Editor:** Lens per rule: "matches N corpus utterances; targeted by M, missed M-N." Click → opens debug panel's miss-cluster view.

### F3.3 — Miss-cluster view ✅ MVP

- **Panels:** New tab in `agr-language` debug panel listing utterances targeting a rule's action but unmatched, clustered by surface form. Each cluster offers a suggested rule edit.

### F3.4 — Cross-link from Schema Studio ✅ MVP

- "Open AGR rule for this action" jump (and reverse: "Open schema variant for this rule").

### F3.5 — Auto-grammar from schema (diff-preview) ✅ MVP

- **Commands:** `TypeAgent Studio: Auto-grammar from schema`. Wraps `SchemaToGrammarGenerator` / `ClaudeGrammarGenerator`. Presents diff vs current `.agr`; developer accepts hunks.

---

## 5. J4 — Find a regression (compare-and-replay) — **headline**

### F4.1 — `replayCorpus()` engine primitive ✅ MVP

- **RPCs:** `replayCorpus({agent, corpus, versionA, versionB, missPolicy, batchSize}) → ReplayRunHandle`. Streams `replay.row` events; emits a final `replay.summary`.
- **Where it lives:** `typeagent-core`. Internally drives two sandbox dispatchers (or two configurations of one) to evaluate each utterance against vA and vB; produces an `ActionDelta` per utterance.
- **`ActionDelta` shape (draft):** `{ utterance, source, actionA, actionB, equal: bool, cacheStateA, cacheStateB, feedbackA?, feedbackB?, collisionsA[], collisionsB[], latencyA, latencyB }`.

### F4.2 — Replay launch dialog ✅ MVP

- **Commands:** `TypeAgent Studio: Replay corpus across versions` and `Compare working tree vs HEAD against corpus` (source-control gutter).
- **Panels:** Inline dialog: version A picker (git ref or working tree), version B picker (any git ref), corpus filter (agent / labels / source), miss-policy (F0.8), agent (defaults to `player` in MVP).

### F4.3 — Impact Report panel ✅ MVP

- **Panels:** Four-pane webview:
  - **Pane 1 — Structural diff** (`diffGrammars` output, existing).
  - **Pane 2 — Coverage delta** (`computeCoverage` before/after).
  - **Pane 3 — Action-level delta** _(new)_: virtualized table of `ActionDelta` rows, annotated with feedback labels. Filter chips: equal / different / new-match / lost-match / red / green; feedback category chips; collision-bearing rows.
  - **Pane 4 — Collisions delta** (rows from §10 detector).
- **Drill-in:** any row → opens J5's Trace Viewer for that requestId (vA and vB shown side-by-side).

### F4.4 — "Likely-regression" predicate ✅ MVP

- Default predicate (open item §7.5 in journeys; final form decided in Phase 4): row is "red" if `(feedbackA.rating == up && actionA != actionB) || (feedbackB?.rating == down)`. Configurable per workspace.

### F4.5 — Replay run export ✅ MVP

- Export the full `ActionDelta[]` as JSONL plus a summary markdown. Reuses F0.2's JSONL schema where applicable.

### F4.6 — Player corpus capture ✅ MVP (pre-requisite work)

- **Editor / Panels:** "Capture this session to corpus" action on vscode-shell session entries; bulk import from existing displayLog.json files; explicit "captured" provenance on each entry.
- **Where captures live:** `~/.typeagent/profiles/<studio>/captures/<agent>/`. Promotion to in-repo `corpus/<agent>.utterances.jsonl` is a separate explicit action (so we don't leak someone's session into a shared repo by accident).
- **Why MVP:** §7.1 of journeys — `player` has no corpus today; without this, J4 has nothing to demo.

### F4.7 — CI hook (CLI form of F4.1) ❌ post-MVP

- `typeagent-studio replay --agent player --corpus … --versionA --versionB --out report.json` for PR validation. Same primitive; not in MVP.

---

## 6. J5 — Debug a single failing trace

### F5.1 — Trace Viewer panel ✅ MVP

- **Panels:** Tree view of dispatch nodes for one requestId, sourced from F0.3 events. Per node: kind, timing, payload, source link (schema variant / AGR rule / cache entry).
- **Tabs along the side:** Events (default), Reasoning (F0.10), Feedback, Collisions.

### F5.2 — Entry points ✅ MVP

- From J4 row → "Open trace." From vscode-shell bubble → "Investigate this trace." Command palette → `Replay this trace`. Trace history tree (recent N from sandbox).

### F5.3 — Source jump from any node ✅ MVP

- Grammar match node → AGR file/line. Action node → schema variant. Cache node → construction cache entry.

### F5.4 — Replay-this-trace ✅ MVP

- **RPCs:** `trace.replay(requestId, {targetVersion})`. Returns a fresh trace; viewer shows side-by-side diff with the original.

### F5.5 — Inline feedback re-rating ❌ post-MVP

- Open item §7.4 in journeys. UX risk of confusing dev with cross-session edits. Keep view-only in MVP.

---

## 7. J6 — Observe a live session

### F6.1 — Live Trace panel ✅ MVP

- **Panels:** Tailing view of F0.3 events, one row per event. Filters by event type. Click any row → J5.

### F6.2 — Status-bar item ✅ MVP

- **Editor:** `TypeAgent: connected | N events/min`. Click → opens F6.1.

### F6.3 — Demo-mode auto-open ❌ post-MVP

- Reuses vscode-shell's existing demo-runner. Nice-to-have; not in MVP.

---

## 8. Feature → primitive map (build dependency)

Cross-reference of every feature to the inventory primitive(s) it depends on. Used by Phase 5 (implementation plan) to sequence work.

| Feature              | Inventory primitives                                                 | New primitive needed        |
| -------------------- | -------------------------------------------------------------------- | --------------------------- |
| F0.1 sandbox         | `defaultAgentProvider`, `dispatcher`, agent-server                   | sandbox lifecycle RPC       |
| F0.2 corpus          | `@feedback export`, displayLog.json schema                           | corpus federation service   |
| F0.3 events          | (none; sits alongside `debug()`)                                     | event stream API            |
| F0.4 feedback        | PR #2341 dispatcher RPCs, `@feedback *`                              | thin RPC wrappers           |
| F0.5 health          | `actionSchema` parser, `actionGrammar` compiler, `agentSdk` contract | health rule engine          |
| F0.6 collisions      | §10 detectors                                                        | event subscription wiring   |
| F0.7 conversational  | `onboarding`, `schemaAuthor`                                         | —                           |
| F0.8 miss policy     | F4.1                                                                 | —                           |
| F0.9 workflow view   | reasoning traces                                                     | —                           |
| F0.10 reasoning view | reasoning traces                                                     | —                           |
| F1.\*                | `onboarding` 7 phases, F0.1, F0.5                                    | onboarding snapshot/restore |
| F2.1 schema studio   | `examples/schemaStudio` CLI, `actionSchema`, `cache`, F0.2           | —                           |
| F2.2 lens            | `actionSchema` + F2.1 mapping                                        | —                           |
| F2.3 suggest         | `schemaAuthor`                                                       | —                           |
| F2.4 collisions      | F0.6                                                                 | —                           |
| F3.\*                | `agr-language`, `grammarTools`, F0.2, F0.3                           | —                           |
| F4.1 replayCorpus    | `cache.constructionMatch`, `actionGrammar.matchGrammar`, F0.1, F0.2  | `replayCorpus()`            |
| F4.3 impact          | F4.1, `diffGrammars`, `computeCoverage`, F0.6                        | Impact Report webview       |
| F4.6 capture         | displayLog.json, F0.2                                                | capture-to-corpus action    |
| F5.\*                | F0.3, `ProfileLogger`, reasoning traces                              | trace viewer webview        |
| F6.\*                | F0.3                                                                 | live tail webview           |

The unique new primitives requiring engine work:

1. **sandbox lifecycle RPC** (F0.1) — forces process management story.
2. **corpus federation service** (F0.2) — forces the corpus schema/provenance story.
3. **event stream API** (F0.3) — forces the structured-event protocol story.
4. **health rule engine** (F0.5) — forces the manifest/schema/grammar/handler invariants to be explicit.
5. **`replayCorpus()`** (F4.1) — forces the dual-version dispatcher story.
6. **onboarding snapshot/restore** (F1.1) — forces the wizard's revisitable-state story.

Everything else is wiring or UI on top of these six.

---

## 9. Surface count summary

| Layer                                                    | MVP feature count | Notes                                                                                                                                          |
| -------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor (lens / diag / decoration / status / code action) | 11                | Concentrated on schema, grammar, source-control gutter, and status bar.                                                                        |
| Panels (webviews / tree views)                           | 9                 | Sandbox tree, Corpora tree, Trace history tree, plus six webviews (Wizard, Schema Studio, AGR debug, Impact Report, Trace Viewer, Live Trace). |
| Commands & RPCs (palette + dispatcher endpoints)         | ~25               | About 1/3 are new RPCs in `typeagent-core`; the rest wrap existing capabilities.                                                               |

**Webview count concern:** six webviews is a lot. Phase 4 (MVP slice) should examine whether any can collapse — e.g. Trace Viewer and Live Trace are the same renderer in two modes (replay vs tail). Likely consolidation: **5 webviews** total.

---

## 10. Out of scope for any feature (re-stated for hard line)

From §6 of journeys, reiterated as a "do not build these in MVP" list:

- Multi-agent / multi-corpus simultaneous replay.
- Workflow authoring (only view-only F0.9).
- MCP host role.
- Marketplace publication.
- Migrating existing `debug()` sites.
- Reasoning-trace authoring UI.
- Cross-agent collision navigator.
- Inline feedback re-rating from Trace Viewer (F5.5).
- CI hook for `replayCorpus()` (F4.7).
- Demo-mode auto-open (F6.3).

---

## 11. Validation (for this features doc)

Before proceeding to Phase 4 (MVP slice), confirm:

- [ ] The three-layer split (editor / panels / commands+RPCs) is the right framing.
- [ ] The six new engine primitives (§8 bottom) are the right cuts — nothing missing, nothing redundant.
- [ ] The MVP / post-MVP split per feature matches your ambition.
- [ ] F4.6 (player corpus capture) belongs in MVP — without it, J4 cannot demo. If you disagree, J4 either drops to "light" depth or we pick a different anchor agent.
- [ ] The "5 webviews after consolidation" target is acceptable.
- [ ] The "likely regression" default predicate in F4.4 is the right starting point (it will be tuned during validation-gate work).

---

_End of Phase 3 features draft._
