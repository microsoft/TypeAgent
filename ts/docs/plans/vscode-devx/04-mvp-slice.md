# TypeAgent Studio — Phase 4: MVP Slice

> **Status:** Drafted 2026-05-14, after [03-features.md](./03-features.md).
>
> **Purpose:** Cut a vertical slice through the journeys and features that constitutes **the MVP**: the smallest deliverable that proves the compare-and-replay value proposition end-to-end against the `player` anchor agent, and lets a stranger stand up a new agent in the same workspace.
>
> **Slice principle:** _Every primitive in the slice must be touched by the demo path._ No primitives built "just because." If F0.5 (health check) is in MVP, the demo must exercise it.

---

## 1. The MVP, in one paragraph

A developer opens VS Code on the TypeAgent repo. They install the **TypeAgent Studio** extension pack. From the activity bar they start a sandboxed agent-server with `player` loaded. They open Schema Studio, load `player`'s federated corpus (in-repo seed + their own captures + remote feedback), filter to 👎 / `wrong-agent`, identify one missing schema variant, add it via a code-action, observe the inline collision diagnostic clear, and commit. They run **Replay corpus across versions** (working tree vs `HEAD~1`). The Impact Report opens with four panes; in the action-level pane they filter to "likely regression" and drill into one row. The Trace Viewer shows that trace in full, side-by-side with the prior version. They satisfy themselves the change is good, restore the sandbox to clean state, and the journey loops to the next iteration. In a separate flow, a brand-new developer runs **New Agent** and produces a working `thermostat` agent in the sandbox in one sitting — the same sandbox infrastructure, the same health-check engine, the same event stream.

That paragraph is the MVP demo script. Everything in this document exists to make it true.

---

## 2. What's in / what's out (re-stated against §10 of features)

### In the MVP slice

From §1 of features (cross-cutting): **F0.1–F0.10** — all ten cross-cutting features. They're cross-cutting because every journey needs them; cutting any drops a journey below demo quality.

From the per-journey lists:

| Journey | MVP features                           | Why these                                                                                                                            |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **J1**  | F1.1, F1.2, F1.3, F1.4, F1.5           | Wizard panel, conversational entry, install-into-sandbox, health gate, phase reconciliation. Without all five, J1 has visible holes. |
| **J2**  | F2.1, F2.2, F2.3, F2.4, F2.5, F2.6     | All six. F2.2 and F2.5 are the headline UX wins; F2.3 is the schema-edit affordance; F2.6 is the "feels live" requirement.           |
| **J3**  | F3.1, F3.2, F3.3, F3.4, F3.5           | All five. The agr-language refactor (F3.1) is unavoidable since F0.2/F0.3/F0.4 depend on it.                                         |
| **J4**  | F4.1, F4.2, F4.3, F4.4, F4.5, **F4.6** | All except F4.7 (CI hook). F4.6 (player corpus capture) is the pre-requisite that makes the demo runnable.                           |
| **J5**  | F5.1, F5.2, F5.3, F5.4                 | All except F5.5 (inline re-rating).                                                                                                  |
| **J6**  | F6.1, F6.2                             | All except F6.3 (demo-mode auto-open).                                                                                               |

### Explicitly excluded from MVP

- F4.7 CI hook, F5.5 inline feedback re-rating, F6.3 demo-mode auto-open.
- Everything in §10 of features (multi-agent replay, workflow authoring, MCP host, marketplace, debug() migration, etc.).
- **Multi-corpus, multi-agent simultaneous replay.** MVP is `player` only; `code`'s 684-utterance corpus is the _post-MVP_ validation that federation scales.

---

## 3. Acceptance criteria for "MVP done"

Five gates. All must pass.

### Gate A — Stand-up gate (J1)

A developer with no TypeAgent prior, given only the extension pack, the repo, and a working OpenAI/Azure key, produces a working sandbox agent (`thermostat` is the canonical script) that answers at least one of the example utterances they typed at PhraseGen. No manual `pnpm` or file edits during the run. Health-check passes.

### Gate B — Schema-improvement loop gate (J2)

Starting from the current `player` schema and a federated corpus of ≥ 200 utterances (in-repo seed + captures + ≥ 50 feedback-labelled), a developer identifies a missing schema variant, adds it, sees the per-utterance mapping update visibly within seconds, sees no false collision diagnostic, and commits. Total elapsed time ≤ 10 minutes for someone who knows the system.

### Gate C — Headline gate (J4) — _the validation gate_

The Impact Report, run with the default "likely regression" predicate (F4.4) on a **hand-labelled regression set for `player`**, agrees with developer judgment on ≥ 80% of rows. Defined "agree" = the row is labelled "red" exactly when the human labeller would call it a regression and "green" exactly when the human labeller would call it an improvement. Disagreements on equal-rows are not counted.

**This gate is the single hardest one.** It can fail because the predicate is wrong (tunable), because the corpus doesn't have enough labels (fixable by capturing more), or because the engine produces flaky `ActionDelta` rows under cache-miss conditions (an engine bug). All three failure modes have to be diagnostically distinguishable.

### Gate D — Drill-in gate (J5)

From any J4 red row, a developer reaches the Trace Viewer in one click, sees vA-vs-vB side-by-side, can click any grammar match step to land on the AGR line, click any action node to land on the schema variant, and click any cache node to inspect the cache entry. Replay-this-trace produces a fresh trace within a few seconds.

### Gate E — Live mirror gate (J6)

Live Trace tail keeps up with one developer typing at normal speed without backing up. Status-bar item shows correct connection state and a non-zero event rate. Clicking any row opens J5 for that requestId.

### Performance budgets (sub-gates)

- F0.3 event stream: 1k events/second sustained, p95 end-to-end latency ≤ 200 ms on a developer laptop.
- F4.1 replayCorpus: ≤ 60 s for the full player corpus at default miss policy.
- F5.1 trace viewer: open within 2 s for any requestId in the current sandbox session.

---

## 4. The slice itself — packages and where work lands

The MVP work distributes across four extensions + one shared package (mirroring the parallel-plan "TypeAgent Studio" pack):

| Package                                     | Purpose                                          | What MVP adds                                                                                                                                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`typeagent-core`** (new)                  | Shared engine library for all Studio extensions. | Sandbox lifecycle RPC (F0.1), corpus federation service (F0.2), event stream API (F0.3), feedback wrappers (F0.4), health rule engine (F0.5), collision wiring (F0.6), `replayCorpus()` engine (F4.1), onboarding snapshot/restore (F1.1 backend).            |
| **`typeagent-studio`** (new)                | Main extension. The activity-bar app.            | Sandbox tree (F0.1 UI), Corpora tree (F0.2 UI), Wizard webview (F1._), Schema Studio webview (F2.1, F2.2, F2.3, F2.5, F2.6), Impact Report webview (F4.2, F4.3, F4.4, F4.5), Trace Viewer webview (F5._), Live Trace webview (F6.\*), command palette wiring. |
| **`agr-language`** (existing, refactored)   | LSP + AGR debug panel.                           | Depend on `typeagent-core` (F3.1). New miss-cluster view (F3.3). New code lenses (F3.2). Cross-link to Schema Studio (F3.4). Auto-grammar diff (F3.5).                                                                                                        |
| **`vscode-shell`** (existing, refactored)   | Chat surface in VS Code.                         | Depend on `typeagent-core`. Connect to Studio sandbox by default (Studio sets it, vscode-shell consumes it). Capture-to-corpus action on bubbles (F4.6).                                                                                                      |
| **`packages/agents/onboarding`** (existing) | The 7-phase scaffolder.                          | Snapshot/restore RPCs (F1.1 backend). No UI changes; the wizard webview lives in `typeagent-studio`.                                                                                                                                                          |

**Webview consolidation:** Trace Viewer and Live Trace share one renderer module with two modes (`replay` vs `tail`). That gives us **5 webviews** (Wizard, Schema Studio, AGR debug panel — which lives in `agr-language` — Impact Report, Trace/Live).

---

## 5. The build dependency graph

Topological order of new engine primitives, derived from §8 of features. Each item depends only on the ones above it.

1. **F0.3 event stream API** — protocol shape, in-process transport, schema-versioning rules. Foundation. No dependencies.
2. **F0.1 sandbox lifecycle RPC** — process / in-memory dispatcher manager. Depends on F0.3 (emits sandbox lifecycle events).
3. **F0.2 corpus federation service** — JSONL schema (reuse PR #2341's), provenance, three source types. Depends on F0.3 (capture emits `feedback.recorded` etc., service consumes).
4. **F0.4 feedback wrappers** — thin RPC wrappers over PR #2341 endpoints, surfaced through `typeagent-core`. Depends on F0.2 for the corpus side.
5. **F0.5 health rule engine** — invariants + evidence + fix-hints. Depends on F0.1 (knows which agents are loaded) and on the schema/grammar parsers (already exist).
6. **F0.6 collision wiring** — connect §10 detectors' output to F0.3 events; map events back to source locations. Depends on F0.3, F0.1.
7. **F1.1 onboarding snapshot/restore (backend)** — the onboarding agent gains two new actions. Depends on F0.1 (runs in sandbox).
8. **F4.1 `replayCorpus()`** — dual-version dispatcher runner producing `ActionDelta[]`, streaming `replay.row` events. Depends on F0.1, F0.2, F0.3.

UI features can be built in parallel with the engine work once their engine dependency is at "stubbed but typed" stage.

---

## 6. Phases of the build (a sequencing proposal)

Five tracks of work. Within each track the order is sequential; across tracks the work can parallelize where data dependencies allow.

| Phase                                 | Tracks                                                                                                                                                                                                                                                                                          | Exit when                                                                                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P-0 Skeleton**                      | Create `typeagent-core` package, `typeagent-studio` extension scaffold, refactor `agr-language` / `vscode-shell` to dep on core (no behavior change).                                                                                                                                           | Extensions install side-by-side; smoke test of "command palette entry visible."                                                                                                               |
| **P-1 Foundations**                   | Build F0.3 → F0.1 → F0.2 → F0.4 → F0.5 → F0.6, in order. UI sides ride along: Sandbox tree, Corpora tree, status bar.                                                                                                                                                                           | A developer can manually start/stop the sandbox, see corpora and event log, see health pass/fail, get collision diagnostics on schema edits. **Gate A is now reachable as soon as F1 lands.** |
| **P-2 J1 vertical**                   | F1.1 snapshot/restore backend + wizard webview + F1.3 install action + F1.4 health gate + F1.5 reconciliation. Conversational entry (F1.2) is a thin route.                                                                                                                                     | Gate A passes with a stranger.                                                                                                                                                                |
| **P-3 J4 vertical** _(the long pole)_ | F4.6 player corpus capture path → F4.1 `replayCorpus()` engine → F4.2 launch dialog → F4.3 Impact Report (panes 1, 2, 4 first; pane 3 last because it's the new primitive) → F4.4 predicate → F4.5 export. In parallel, J5's trace-viewer module (F5.\*) so J4 drill-in works at MVP demo time. | Gate C passes against the hand-labelled regression set. Gate D passes.                                                                                                                        |
| **P-4 J2 + J3 verticals**             | Schema Studio (F2._) and agr-language enhancements (F3._) in parallel. Both depend only on P-1 foundations.                                                                                                                                                                                     | Gate B passes.                                                                                                                                                                                |
| **P-5 J6 vertical**                   | Live Trace tail (F6.1) + status bar (F6.2). Trivially small because it reuses the Trace Viewer renderer in tail mode.                                                                                                                                                                           | Gate E passes.                                                                                                                                                                                |
| **P-6 Validation & hardening**        | Run all five gates on a fresh laptop. Performance budgets. Polish.                                                                                                                                                                                                                              | Ready to dogfood.                                                                                                                                                                             |

**P-3 is the critical path.** It has the most novel engine work (`replayCorpus()`) and the only gate that can fail for tunable reasons (Gate C). All other tracks can compress; P-3 cannot.

---

## 7. Risk register

| Risk                                                                                           | Likelihood | Impact     | Mitigation                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gate C fails because corpus is too small / unlabelled.**                                     | High       | Critical   | F4.6 corpus capture is part of P-1 actually, not P-3. Start labelling on day one. Target ≥ 200 utterances, ≥ 50 labelled before P-3 ships.                                                                                                                       |
| **Gate C fails because predicate is wrong.**                                                   | Medium     | Manageable | F4.4 is configurable. During P-3 hardening, iterate the default predicate against the hand-labelled set until ≥ 80% agreement.                                                                                                                                   |
| **Replay-miss policy makes results flaky.**                                                    | Medium     | High       | F0.8 default = `needs-explanation`, which is deterministic. `live-LLM` mode is opt-in with cost warning. Gate C is evaluated with the deterministic policy.                                                                                                      |
| **Sandbox subprocess management is platform-flaky (Windows in particular).**                   | Medium     | High       | F0.1 starts with in-memory mode as a fallback; subprocess mode lights up second. Both shipped in MVP but in-memory is the default for the demo.                                                                                                                  |
| **agr-language refactor breaks the existing extension.**                                       | Medium     | Medium     | P-0 ships the refactor as a no-behavior-change PR with the full existing test suite green. New features (F3.2/F3.3) land in P-4 after the refactor is dogfooded for at least a week.                                                                             |
| **Onboarding snapshot/restore is harder than expected for phases 3–7.**                        | High       | Medium     | P-2 starts with snapshot of just phase 3 (SchemaGen) — the most common rewind point — and grows out. F1.5 reconciliation prompts can ask the developer rather than auto-merging when state is ambiguous.                                                         |
| **Webview proliferation slows perf or eats memory.**                                           | Low        | Medium     | Consolidation to 5 already planned. Lazy-load all webviews. Trace/Live shares a renderer.                                                                                                                                                                        |
| **F0.3 protocol churn breaks Studio after a TypeAgent core update.**                           | Medium     | High       | Schema-version every event payload. F0.3 surface includes `events.versions()` so Studio can refuse to start against an incompatible core.                                                                                                                        |
| **dblogging-default-on raises a privacy concern when running Studio with real personal data.** | Low        | High       | Studio's sandbox writes to its own profile dir (`~/.typeagent/profiles/<studio-instance>/`); user is informed at sandbox start that telemetry is on (the existing `@telemetry status` surface, plus a new status-bar indicator). Opt-out toggle in Sandbox tree. |

---

## 8. The demo script (what we actually show)

To make the slice concrete, here is the demo a Studio reviewer would walk after MVP completion. Each step references the features it exercises.

1. Open VS Code on the TypeAgent repo. Install the Studio pack. _(distribution path — out of scope here)_
2. Activity bar → Studio icon. Sandbox tree shows "stopped." → click **Start sandbox** with `player` selected. _(F0.1)_
3. Sandbox status bar turns green. Live Trace panel opens; events tail. _(F6.1, F6.2, F0.3)_
4. Open vscode-shell. Type "play some music." Response arrives. Click 👎 with category `bad-response`. _(F0.4, PR #2341)_
5. Switch to Studio → Schema Studio. Pick `player`. Filter chip → 👎 → category `bad-response`. The new row appears. _(F2.1, F2.5, F0.2, F0.4)_
6. Notice no schema variant matches the utterance shape. Right-click → "Suggest variant." Code action inserts a new `PlayAlbum` action variant in `playerSchema.ts`. _(F2.3)_
7. Schema Studio re-evaluates within a second; row now maps. _(F2.6)_
8. Notice the editor shows a collision diagnostic against an overlapping older variant. Apply quick-fix → diagnostic clears. _(F0.6, F2.4)_
9. From the source-control gutter → "Compare working tree vs HEAD against corpus." Launch dialog opens; defaults look right; click Run. _(F4.2)_
10. ~30 seconds later Impact Report opens. Pane 3 (action-level). Filter chip → "likely regression." Two rows. Click one. _(F4.1, F4.3, F4.4)_
11. Trace Viewer opens. Side-by-side vA vs vB. Click a grammar match step → jumps to the AGR line. Click an action node → jumps to the schema variant. _(F5.1, F5.3)_
12. Return to Impact Report → Export. Save the run. _(F4.5)_
13. _(Bonus path — Gate A.)_ Quit. New developer machine. `TypeAgent Studio: New Agent`. Type two paragraphs. Walk the seven phases. Install. Type "set the living room to 68" in vscode-shell. It works. _(F1._, F0.5)\*

If a Studio reviewer can walk that script without intervention, MVP is done.

---

## 9. Validation (for this MVP slice doc)

Before proceeding to Phase 5 (implementation plan), confirm:

- [ ] §3 acceptance gates A–E are the right gates. Especially Gate C's ≥ 80% threshold for Impact Report agreement against a hand-labelled regression set — that's the load-bearing claim.
- [ ] §4's five-package distribution matches the parallel-plan brand (TypeAgent Studio extension pack).
- [ ] §6's sequencing puts the critical-path work (P-3) where it can absorb the most risk.
- [ ] §7 risk register's top item (Gate C fails due to corpus size) is being mitigated _during_ P-1 (corpus capture starts day one), not deferred to P-3.
- [ ] §8 demo script's 13 steps are the ones we want reviewers to see — nothing missing, nothing performative.
- [ ] The MVP excludes (§2) are acceptable cuts. The biggest of these is **multi-agent replay** — `code` and its 684-utterance corpus are _post-MVP validation_, not part of the demo.

---

_End of Phase 4 MVP slice draft._
