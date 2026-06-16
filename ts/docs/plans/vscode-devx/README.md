# TypeAgent Studio — Planning Series

> A planning series (P-0 → P-6) for an integrated developer experience around TypeAgent: agent authoring, schema/grammar tuning, regression detection via compare-and-replay, trace investigation, and live observation — surfaced through both a VS Code extension and a `studio` agent over one headless core.
>
> **Center of gravity:** _compare schema/grammar versions against a corpus of real user utterances, see action-level impact, annotated with the feedback labels we already collect._
>
> **MVP anchor agent:** `player`.

---

## Read in order

| #   | Doc                                                      | What it answers                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [01-inventory.md](./01-inventory.md)                     | What exists today, gaps, in-flight work (collisions §10, MCP §11, feedback PR #2341 §12), and Phase 2 open-question resolutions (§13).                                                                                           |
| 2   | [02-journeys.md](./02-journeys.md)                       | Six personas, six journeys (J1–J6), MVP depth per journey, success criteria, cross-journey infrastructure.                                                                                                                       |
| 3   | [03-features.md](./03-features.md)                       | Per-journey features at three layers (editor / panels / commands+RPCs). Six new engine primitives. Five webviews.                                                                                                                |
| 4   | [04-mvp-slice.md](./04-mvp-slice.md)                     | The vertical slice that _is_ MVP. Five acceptance gates (A–E). Risk register. **13-step demo script** in §8.                                                                                                                     |
| 5   | [05-implementation-plan.md](./05-implementation-plan.md) | The **single build plan for both presenters** (UI + `studio` agent): package layout, API surfaces, transport choices, sequencing P-0 → P-6 (with agent phases S0–S5 mapped in), test strategy, 10 named open decisions (D1–D10). |

### Companion docs (architecture, agent-drivability, status)

| Doc                                  | What it answers                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [DESIGN.md](./DESIGN.md)             | Architecture; **§3.0** the guiding principle — headless core, thin presenters, three audiences.              |
| [USER-STORY.md](./USER-STORY.md)     | The authoring loop and the three interaction modes (human / AI-agent / hybrid).                              |
| [STUDIO-AGENT.md](./STUDIO-AGENT.md) | The `studio` agent **action-surface reference** (groups A–F, tiers, approval boundary). Phasing lives in 05. |
| [STATUS.md](./STATUS.md)             | What's built, known issues, and the ready-to-start next slices (pointing into the 05 §11 phasing).           |
| [QUICKSTART.md](./QUICKSTART.md)     | Build/test/run commands and where each piece lives.                                                          |

---

## Headline framings

- **J4 (Find a regression) is the headline journey.** Everything else either feeds it (J2/J3), zooms into one of its rows (J5), or mirrors it live (J6). J1 is the entry door that gets new agents into the system to be tuned.
- **The validation gate is Gate C** ([04-mvp-slice.md §3](./04-mvp-slice.md)): the Impact Report must agree with developer judgment on ≥ 80% of rows in a hand-labelled `player` regression set. Currently the only gate that can fail for tunable reasons.
- **`player` was chosen as the anchor over `code` / `list`** to force the federated-corpus capture path to MVP quality from day one. The player corpus does not exist today; building it (F4.6) starts in P-1, not P-3, per the risk register.
- **Five webviews after consolidation**, six new engine primitives, four extensions in the pack (`typeagent-core` shared library + `typeagent-studio` main extension + refactored `agr-language` and `vscode-shell`).
- **PR #2341 (user feedback, just merged) is load-bearing**: feedback labels are what turn "the report shows different rows" into "the report shows likely-bad changes." Without that signal, J4 is a curiosity, not a decision-grade tool.

---

## Decisions already locked

From [01-inventory.md §13](./01-inventory.md):

| #    | Decision                                                                                     |
| ---- | -------------------------------------------------------------------------------------------- |
| Q2   | Hybrid sandbox isolation: subprocess + inmemory mode, always under Studio's own profile dir. |
| Q5   | Workflows view-only in MVP.                                                                  |
| Q6   | Remote-sink reads (Cosmos/Mongo) included in MVP.                                            |
| Q8   | MCP host role deferred.                                                                      |
| Q9   | No new LSP.                                                                                  |
| Q10  | Any workspace; not pinned to the TypeAgent repo.                                             |
| Q11  | Shared session API via `typeagent-core`.                                                     |
| Q14  | No separate privacy gate; dblogging-default-on disclosed at sandbox start.                   |
| Q-P2 | Wizard phases revisitable with guided default.                                               |
| Q-P4 | `player` is the MVP anchor agent.                                                            |

---

## Decisions still open

Top items from [05-implementation-plan.md §13](./05-implementation-plan.md) (D1–D10), and 7 carried items from [02-journeys.md §7](./02-journeys.md):

- D1 transport (socket/pipe/WS)
- D7 exact `likely-bad change` predicate
- D10 Gate C threshold (currently 80%)
- §7.1 player corpus capture UX
- §7.7 health-check rule set (seed list in [05 §6.2](./05-implementation-plan.md))
- Q-P3 marketplace publication timing (product call, not engineering)

---

## Demo script

The 13-step demo that _is_ the MVP: [04-mvp-slice.md §8](./04-mvp-slice.md). If a reviewer can walk it without intervention, MVP is done.

---

## How to use this series

- **Engineering kickoff:** start with [05 §11 phasing](./05-implementation-plan.md) and [05 §13 open decisions](./05-implementation-plan.md). Lock D1, D2, D3, D8, D9 before P-1.
- **Product sign-off:** review [04 §3 gates](./04-mvp-slice.md) and [04 §7 risk register](./04-mvp-slice.md). Confirm Gate C threshold.
- **Design review:** [02-journeys.md](./02-journeys.md) personas and journey success criteria; [03-features.md §9](./03-features.md) surface count.
- **Onboarding a new contributor:** read in numeric order; budget about an hour total.

---

_Draft: 2026-05-14._
