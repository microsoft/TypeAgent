# TypeAgent Studio — User Story & Interaction Model

> **Purpose:** An onboarding-friendly narrative of _who uses TypeAgent Studio,
> what the agent-authoring loop actually is, and how a developer, an AI agent,
> or a combination of both would drive these tools._ It complements the formal
> persona/journey breakdown in [`02-journeys.md`](./02-journeys.md) and the
> architecture in [`DESIGN.md`](./DESIGN.md); read this first for the "why," then
> those for the detail.

## 1. What you're authoring

A TypeAgent **agent** is a small plugin the dispatcher routes natural-language
requests to. It is four coupled artifacts plus a registration:

| Artifact                 | Role                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `<name>Manifest.json`    | Metadata: emoji, description, and pointers to the schema/grammar.                      |
| `<name>Schema.ts`        | The typed **action surface** — what the agent can do, expressed as TypeScript types.   |
| `<name>Schema.agr`       | The **grammar** — natural-language phrasings that map to those actions without an LLM. |
| `<name>ActionHandler.ts` | `instantiate(): AppAgent`; executes an already-validated, typed action.                |
| `defaultAgentProvider`   | `data/config.json` registration so the dispatcher discovers and loads the agent.       |

The flow at runtime:

```
User input → Grammar match (fast path) / LLM translation (fallback)
           → typed Action → Dispatcher → Agent handler → ActionResult
```

The **core authoring loop** is therefore a question the developer asks over and
over:

> _"I changed the schema/grammar — does it still map real user utterances to the
> right typed action, and did I make anything better or worse?"_

The "real utterances" are the agent's **corpus**: an in-repo seed
(`corpus/<agent>.utterances.jsonl`), per-session **captures** from the sandbox,
and utterances **labelled** by users with 👍 / 👎 feedback. Everything in Studio
exists to make that loop fast, safe, and judgeable.

## 2. Who walks the loop (personas)

From [`02-journeys.md`](./02-journeys.md); one developer usually wears several
hats.

| #   | Persona                  | Cares about                                                 |
| --- | ------------------------ | ----------------------------------------------------------- |
| P1  | Agent Author             | Standing up a brand-new agent.                              |
| P2  | Schema Designer          | The typed action surface (`<name>Schema.ts`).               |
| P3  | Grammar Tuner            | The phrasings (`<name>Schema.agr`).                         |
| P4  | **Quality / Regression** | _"Did this change make things better or worse?"_ ← headline |
| P5  | Trace Investigator       | _"This one utterance went wrong — why?"_                    |
| P6  | Live Observer            | Demos, review, watching the system run.                     |

The MVP center of gravity is **compare-and-replay** (P4): change schema/grammar,
then see _action-level_ impact against the corpus, annotated with the
feedback labels we already collect.

## 3. A concrete end-to-end story

> **Aïda builds a `thermostat` agent, tunes it, and ships a change safely.**
>
> 1. **Author (J1).** She runs **New Agent**, describes the agent in plain
>    English, and the `onboarding` agent runs seven revisitable phases —
>    Discovery → PhraseGen → SchemaGen → GrammarGen → Scaffolder → Testing →
>    Packaging. She clicks **Install into sandbox**, types _"set the living room
>    to 68"_ in the shell, and it works. No hand-copied files, no `pnpm`
>    incantations.
> 2. **Tune the schema (J2).** Real captures arrive. She loads the federated
>    corpus, filters to 👎 utterances, and finds a missing `SetSchedule` action.
>    She adds it; a collision with `SetTemperature` surfaces _inline_ before she
>    commits.
> 3. **Tune the grammar (J3).** _"make it warmer"_ misses. She adds phrasings to
>    the `.agr` and confirms coverage went up.
> 4. **Find regressions (J4 — the payoff).** She replays the whole corpus,
>    _working tree_ vs _HEAD_. The **Impact Report** shows action-level deltas
>    annotated with feedback: green where she fixed a known-bad response, red
>    where she may have broken something users liked.
> 5. **Investigate (J5).** A red row → the full dispatch trace → the exact
>    grammar line that mis-matched.
> 6. **Ship.** The health gate passes; she commits.

## 4. Current state vs. the story

The **primitives** beneath steps 1–4 exist in `typeagent-core` today — sandbox
lifecycle, file-backed health rules, corpus federation, feedback capture,
the NFA collision scanner, and a `replayCorpus` compare engine — and the Studio
surfaces make steps 1–3 usable (Sandboxes / Corpora / Collisions trees, a health
status bar, agent discovery, grammar building, seeding/adding corpora).

**The payoff is the gap.** The step-4 **Impact Report webview does not exist
yet** (there is no webview infrastructure at all), and replay currently uses an
_identity_ resolver rather than a real two-version build/dispatch. Closing that
is the long pole. See [`STATUS.md`](./STATUS.md) for the live matrix.

## 5. Three interaction modes

The same authoring loop can be driven three ways. Each places different demands
on the tooling, and naming them helps us prioritize.

### A. Human-driven (today's design)

The developer clicks through tree views and (eventually) webviews, reading
diffs and the Impact Report. This mode is optimized for **judgment** —
deciding _better vs. worse_, which is inherently human. The UI is the product.

### B. AI-agent-driven

An autonomous coding agent (e.g. GitHub Copilot, or a TypeAgent agent itself)
drives the **same primitives headlessly**: scaffold via the onboarding bridge,
edit schema/grammar, run `replayCorpus`, read the **structured event stream**
and **`ActionDelta`** results _as data_, decide, and iterate. This mode needs
the engine surfaces to be **machine-consumable** — typed results, stable JSON
report shapes, deterministic exit conditions — not just rendered views. Most
core primitives already return structured data; the gaps are a headless / CLI
entry point and stable, documented result contracts.

### C. Hybrid (likely the sweet spot)

The human sets intent — _"cover these twenty utterances; do not regress the 👍
set"_ — and the AI agent does the mechanical loop: add action variants, re-run
replay, propose grammar edits, summarize the Impact Report. The human reviews
and approves. This needs **both** a clean UI **and** the same operations exposed
as callable, idempotent primitives, sharing **one source of truth** (the event
stream + the federated corpus) so the human and the agent always see the same
state.

### Why this matters for prioritization

The structured event stream and the typed `replayCorpus` / health / collision
results are not merely UI plumbing — they are **the API an AI agent would
drive**. Investing in stable, machine-readable core contracts serves modes A, B,
and C simultaneously: the webview renders them for humans, and an agent consumes
the same shapes. A reasonable design rule going forward:

> Every Studio capability should have a **headless core primitive** with a typed
> result, and the UI should be a thin presenter over it.

This is already the pattern in the codebase (vscode-free presentation modules +
thin VS Code adapters); extending it to a headless entry point is what unlocks
modes B and C.

## 6. Open questions

- **Where does the AI agent run?** In-editor (Copilot driving Studio commands),
  as a TypeAgent agent (the `onboarding` agent already routes conversationally),
  or a CLI in CI? Each implies a different headless surface.
- **What is the approval boundary in hybrid mode?** Which steps may the agent
  perform autonomously (add a phrasing, re-run replay) vs. which require human
  sign-off (commit, change a 👍-validated action)?
- **What is the minimum machine-readable contract** for the Impact Report so an
  agent can act on it before the webview exists? (A typed `ActionDelta[]` +
  summary is likely enough to start mode B/C without any UI.)

These don't need answers to keep shipping the human-driven path, but they should
shape how we build the long-pole replay/Impact-Report work so it's drivable by
an agent from day one.
