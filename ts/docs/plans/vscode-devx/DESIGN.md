# TypeAgent Studio — Design Overview

> A consolidated, human-readable design for **TypeAgent Studio**, the developer
> experience for authoring, tuning, and validating TypeAgent agents — surfaced
> both as a VS Code extension pack (for humans) and as a `studio` TypeAgent agent
> (for AI / conversational / hybrid callers) over one headless core.
>
> This document describes the final system. It is intended as the canonical
> introduction; the numbered planning docs in this folder remain as the deep
> references for engineering, design review, and product sign-off.

---

## 1. The problem in one paragraph

TypeAgent routes natural-language requests ("play some jazz", "set the living
room to 68 degrees") to typed actions on **application agents**. Two artifacts
control that routing for any agent: the **schema** (the TypeScript action
types) and the **grammar** (the `.agr` file with natural-language patterns
that match those types). When a developer changes either one, they're moving
the goalposts for every user utterance the system will ever see — and today
they have no decent way to know whether the change made things better or
worse for real traffic. There's no compare. There's no replay. There's no
per-utterance impact view. There are no labels saying "users hated this
answer." Schema and grammar tuning is closer to guessing than to engineering.

**TypeAgent Studio fixes that.** It's a VS Code extension pack that turns the
edit-schema / edit-grammar / find-out-later loop into an immediate,
evidence-backed development experience.

---

## 2. The headline value: find a regression before you ship it

The defining experience of TypeAgent Studio is the **compare-and-replay
loop**:

> A developer changes the player agent's schema and grammar on a feature
> branch. From the source-control gutter they run **Replay corpus across
> versions** with _working tree_ against _the previous commit_. Studio loads
> the federated player corpus — the in-repo seed, the developer's own
> captures, plus utterances labelled by users with thumbs-up or thumbs-down
> ratings. It replays each utterance against both versions in a sandboxed
> dispatcher. About twenty seconds later, an **Impact Report** opens with
> four panes: structural diff, coverage delta, **action-level delta**, and
> collisions delta. Each action-level row is annotated with the user-feedback
> label when one exists — a thumbs-down on the _old_ action with category
> "bad-response" shows green here ("you fixed a known bad response"); a
> thumbs-up on the _old_ action with a different _new_ action shows red
> ("you may have broken something users liked"). The developer filters to
> red rows, finds two, clicks one, and the Trace Viewer opens with the old
> and new versions of that one trace side-by-side.

This loop — _change schema or grammar, see action-level impact against real
utterances annotated with real feedback_ — is the **center of gravity** of
the entire design. Everything else either feeds it, zooms into one of its
rows, or mirrors it live.

---

## 3. The shape of the solution

### 3.0 Guiding principle — headless core, thin presenters, three audiences

> **Every Studio capability is a headless, typed core primitive; every surface
> over it (the VS Code UI, a `studio` TypeAgent agent, a CLI/MCP entry) is a
> thin presenter.** Design each capability for three audiences from day one:
> a **human** (mode A, the UI), an **AI agent** (mode B, consuming the typed
> result as data), and a **human+AI hybrid** (mode C, the agent proposes / the
> human approves).

This is not a future nicety — it is a constraint on _how_ each primitive is
built. Concretely:

- A capability's logic lives in `typeagent-core` (no VS Code dependency) and
  returns a **typed, documented result**; the UI renders that result, it does
  not _own_ the logic.
- Mutations expose a **`dryRun`** that returns the proposed diff/plan, so an
  agent (or a cautious human) can preview before applying.
- The same typed result an agent consumes is the one the webview renders — one
  source of truth, not two code paths.

See [`USER-STORY.md`](./USER-STORY.md) §5 (the three interaction modes),
[`STUDIO-AGENT.md`](./STUDIO-AGENT.md) (the agent surface that this principle
makes possible), and [`STATUS.md`](./STATUS.md) ("Interaction modes &
agent-drivability"). When implementing any new surface, **check it against this
principle before writing UI-only code.**

### 3.1 Four extensions and an agent, one shared library

| Package                | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`typeagent-core`**   | A pure-TypeScript engine library. No VS Code dependency. Hosts every cross-cutting primitive: sandbox lifecycle, corpus federation, structured event stream, feedback wrappers, health rules, collision wiring, replay engine, onboarding bridge. Its `runtime` module assembles these into the Studio runtime, which is **instantiated once, inside the `studio` agent** (see §3.5). The `studio` agent, command-line tools, and tests consume it directly. |
| **`typeagent-studio`** | The bespoke VS Code extension — the **human presenter**. The activity-bar app: tree views, webviews, status bar, commands. A thin **client of the agent-server**: it drives the `studio` agent's typed actions and renders the rich UI from the results — it does **not** host the runtime. This mirrors how `coda` is the rich VS Code client of the `code` agent.                                                                                          |
| **`agr-language`**     | The existing grammar-file (`.agr`) language server and debug panel, refactored to depend on `typeagent-core` so it shares the corpus, events, and feedback infrastructure. Gains a miss-cluster view, code lenses, and cross-links to schema.                                                                                                                                                                                                                |
| **`vscode-shell`**     | The existing chat surface — the **generic canvas**. Connects to the agent-server and can route requests to any agent (including `studio`). Gains Studio-sandbox awareness and a "capture this session to corpus" action on chat bubbles.                                                                                                                                                                                                                     |
| **`agents/studio`**    | A first-party TypeAgent agent — the **AI / conversational presenter** and the **host of the Studio runtime** (built on `typeagent-core`) inside the agent-server. Exposes the Studio loop as typed, dispatchable actions (auto-available over MCP). Every other surface — the `typeagent-studio` UI, the `vscode-shell` canvas, an AI orchestrator, the CLI — is a **client** of this one runtime. See [`STUDIO-AGENT.md`](./STUDIO-AGENT.md).               |

Together the four VS Code packages are the "TypeAgent Studio extension pack." A user installs the
pack; each component activates on demand.

### 3.2 Six engine primitives

Inside `typeagent-core`, six primitives carry the weight of the design.

1. **Sandbox lifecycle** — start, stop, and restart isolated agent-server
   instances (subprocess or in-memory). Studio never touches the developer's
   personal TypeAgent profile. Sandboxes always run under a Studio-owned
   profile directory, so experiments don't leak into everyday usage.
2. **Corpus federation** — three source types (in-repo
   `corpus/<agent>.utterances.jsonl`, per-user captures, and external sources
   declared in `.typeagent/studio.json`) federated into a single typed query
   surface, with provenance preserved on every entry.
3. **Structured event stream** — a typed event API covering the high-value
   sites in the dispatcher: phase boundaries, cache hits and misses, grammar
   match attempts and results, action selection and execution, feedback
   recording, collision detection, replay rows. Sits _alongside_ the existing
   `debug("typeagent:*")` traces — no migration. Schema-versioned.
4. **Health rule engine** — invariants over the chain `manifest → schema →
grammar → handler` (10 MVP rules). Each rule produces evidence and a
   fix hint. Catches the silent-runtime-failure class of bugs that today
   only surface when the dispatcher tries to load the agent. (Agent discovery
   in Studio is filesystem-only; the dispatcher's own `defaultAgentProvider`
   registration is what loads an agent, and is checked at load time, not by a
   health rule.)
5. **Replay engine** — the long pole. Takes an agent, a corpus, two version
   specs (a git ref or working tree on each side), and a miss policy. Spins
   up two transient sandboxes, evaluates each utterance against both
   versions, streams a per-utterance delta. The headline experience does not
   exist without this primitive.
6. **Onboarding bridge** — the existing onboarding agent already orchestrates
   seven phases (Discovery → PhraseGen → SchemaGen → GrammarGen → Scaffolder
   → Testing → Packaging). The bridge adds revisitable phase state so the
   wizard can move forward and backward without losing work, with explicit
   reconciliation prompts when a re-run would invalidate downstream phases.

A seventh piece — collision wiring — is not a new engine, just a subscription
that turns collision-detection events into editor diagnostics with quick
fixes.

### 3.3 Five webviews

Webviews are expensive (performance, memory, build complexity), so the
design keeps the count low and consolidates where possible. The Trace Viewer
and Live Trace are a single renderer module with two modes (replay vs tail).

1. **Wizard** — hosts the onboarding agent's seven phases as revisitable tabs.
2. **Schema Studio** — three-pane corpus / schema / mapping view.
3. **AGR debug panel** — lives in `agr-language`; gains a miss-cluster view.
4. **Impact Report** — four-pane diff (structural, coverage, action-level,
   collisions). The headline UI.
5. **Trace / Live** — single renderer; replay mode for one trace, tail mode
   for the live event stream.

Plus three tree views (Sandboxes, Corpora, Trace history) and a status-bar
indicator.

### 3.4 What lives where on the screen

Every feature lives in one of three layers, kept strictly separate so we
don't build a webview when a code lens would do:

- **Editor surfaces** — code lenses, hover, diagnostics, code actions,
  decorations, status bar. Anything _on the file the developer is editing_.
  Examples: a lens on each grammar rule reporting "matched by 4 corpus
  utterances; 15 utterances target this action but miss"; a collision
  diagnostic on a colliding schema variant.
- **Panels** — webviews and tree views in Studio's activity bar. Examples:
  Schema Studio, Impact Report, Trace Viewer, Sandbox tree.
- **Commands and RPCs** — command-palette entries and the engine endpoints
  they invoke.

Most capabilities show up on all three layers — a lens, a panel, a command —
because that's how a developer naturally encounters them.

### 3.5 Where the runtime runs — one runtime in the `studio` agent

The §3.0 principle says capability logic is a headless core primitive with thin
presenters. This section pins down the consequence the rest of the system
already follows: **the Studio runtime is instantiated once, inside the `studio`
agent in the agent-server — not separately inside each UI.**

This matches how TypeAgent is built everywhere else:

- **Capability = an agent in the agent-server.** Every capability (`code`,
  `calendar`, `onboarding`, …) is an agent reached through the dispatcher.
  Studio is no exception: the `studio` agent owns the runtime.
- **VS Code = a thin client of the agent-server.** `vscode-shell` is the generic
  canvas (connects via an agent-server bridge, routes to any agent). `coda` is a
  rich, bespoke client of the `code` agent: the **`code` agent hosts a channel;
  `coda` renders/executes**. The relationship we adopt is the direct analogue:

  > **`studio` : `typeagent-studio` :: `code` : `coda`** — the agent holds the
  > capability and a channel; the extension is the rich client/view.

Concretely:

- The `studio` agent constructs the runtime (`@typeagent/core/runtime`) once.
- The `typeagent-studio` extension does **not** build its own runtime. It
  connects to the agent-server, drives the agent's typed actions, and renders
  the rich UI (trees, Impact Report webview, status bar) from the results.
- An AI orchestrator (MCP), the CLI, and the `vscode-shell` canvas are peers of
  the extension — all clients of the same single runtime, so they never diverge
  on repo root, sandbox set, or corpus state.

**The new design surface this introduces** (vs. today's chat agents, which only
render `ActionResult` display content): the rich views need **typed results and
an event stream**, not rendered markdown. The precedent is exactly `code↔coda` —
an agent exposing a structured channel to its companion extension. Studio uses
the same shape: results flow client←agent; live events (health changed, replay
rows, trace tail) flow agent→client.

> **Transitional note.** The extension today still builds an in-process runtime
> via `createStudioRuntime`. That is a bootstrap; it is migrated to an
> agent-server client + the typed result/event channel as the `studio` agent's
> action surface grows (see [`STUDIO-AGENT.md`](./STUDIO-AGENT.md) and the
> implementation plan's phasing).

---

## 4. Architecture in a single picture

```
   Presenters (clients) ─ all drive the same runtime, none host it:

   ┌─────────────────────┬────────────────────┬──────────────────────┐
   │ typeagent-studio     │ vscode-shell        │ AI orchestrator (MCP)│
   │ rich VS Code UI:     │ generic chat        │ · CLI                │
   │ trees · webviews ·   │ canvas (any agent)  │                      │
   │ status bar           │                     │                      │
   └──────────┬───────────┴──────────┬──────────┴───────────┬──────────┘
              │   agent-server connection (RPC + typed result/event channel)
              ▼                       ▼                       ▼
   ┌──────────────────────────── agent-server ─────────────────────────┐
   │  dispatcher + agents                                              │
   │  ┌──────────────────────── studio agent ───────────────────────┐ │
   │  │ dispatchable actions A–F  +  the Studio runtime, built on    │ │
   │  │ @typeagent/core: sandbox · corpus · events · feedback ·      │ │
   │  │ health · collisions · replay · onboardingBridge              │ │
   │  └───────────────────────────────┬──────────────────────────────┘ │
   └──────────────────────────────────┼─────────────────────────────────┘
                                       │  spins up (in-memory or IPC)
                                       ▼
                           ┌──────────────────────┐
                           │  Sandboxed dispatcher │
                           │  (agents under the    │
                           │  Studio profile dir)  │
                           └──────────────────────┘
```

`@typeagent/core` is the shared engine **library**; the runtime **instance**
lives in the `studio` agent, and every presenter is a client of it (§3.5). The
sandboxed dispatcher runs the user's actual agents. The Studio profile directory
is **always separate** from the developer's personal TypeAgent profile.

---

## 5. Cross-cutting assumptions

These hold for every feature in the system.

- **Sandbox isolation is non-negotiable.** Every Studio session uses its own
  sandboxed agent-server. Captures, display logs, constructions, and
  collision events all land in the Studio profile directory.
- **Feedback labels are load-bearing.** TypeAgent already collects per-bubble
  thumbs-up / thumbs-down ratings with categories (`wrong-agent`,
  `didnt-understand`, `bad-response`, `other`) and free-text comments. The
  Impact Report uses these labels to separate "different" from "different
  _and judged by humans to be worse_" — the difference between a curiosity
  and a decision-grade tool.
- **Collisions are first-class.** When two grammar rules or two schema
  variants overlap in conflicting ways, that's a collision. Detection runs
  at four points (load-time, schema edit, grammar edit, replay) and Studio
  surfaces the resulting events inline in the editor and as a pane in the
  Impact Report.
- **Replay-miss policy is developer-controlled** per replay run. Three
  modes: _needs-explanation_ (the deterministic default — a cache miss
  becomes a row annotation, not an LLM call), _live-LLM_ (slow, costs
  tokens, shows estimate before firing), and _strict-cache_ (fastest, lossy
  — misses are simply omitted from the report).
- **Telemetry is on by default** and disclosed at sandbox start, with an
  opt-out toggle in the Sandboxes tree.

---

## 6. The six developer journeys

Six personas, six journeys, one workbench. One developer typically wears
multiple hats; the personas are roles, not people.

### Stand up a new agent

> Aïda wants an agent for a smart-home thermostat. She runs **New Agent**
> from the command palette, types two paragraphs describing what the agent
> does, and walks the seven onboarding phases — Discovery, PhraseGen,
> SchemaGen, GrammarGen, Scaffolder, Testing, Packaging. When SchemaGen
> looks wrong she jumps back to PhraseGen, fixes it, re-runs SchemaGen —
> _the later phases keep their state_. At the end she clicks **Install into
> sandbox**. The sandboxed dispatcher restarts with `thermostat` loaded.
> She types "set the living room to 68" in the chat panel. It works.

A developer with zero TypeAgent prior produces a working agent without
manual `pnpm` commands or hand-edited config files. The health check at the
end of the wizard catches the kinds of inconsistency (schema referenced but
missing, action type with no grammar rule, handler not exporting
`instantiate`) that today only surface as opaque runtime failures.

### Tune the schema against real utterances

> Bruno owns the player agent's schema. He opens **Schema Studio**. Three
> panes: the federated player corpus on the left, `playerSchema.ts` on the
> right, and a per-utterance mapping in the centre showing which action
> each utterance currently routes to. He filters to thumbs-down with
> category `wrong-agent`. One cluster reveals a missing `PlayAlbum` variant.
> He extracts an action shape via a code action; the schema updates;
> Schema Studio re-evaluates the affected rows live. The collision detector
> fires inline because `PlayAlbum` overlaps `PlayTrack`; he applies the
> quick-fix, the diagnostic clears, he commits.

The federated corpus loads with feedback labels attached. Per-utterance
mappings refresh within a couple of seconds on a schema edit — no daemon
restart. Collisions surface _as the developer types_, not after commit.

### Tune the grammar against utterance variations

> Casey owns `playerSchema.agr`. The debug panel — the same one
> `agr-language` already provides, now backed by Studio's federated corpus
> — clusters the corpus by intent. The cluster "play music by artist" has
> 19 utterances; her current rule matches 4. A code lens on the rule says
> "matches 4; targeted by 19; missed 15." She opens the miss-cluster view,
> accepts two suggested rule edits, re-runs match. 18 hit. The hold-out is
> a typo; she leaves it.

The existing `agr-language` extension keeps every capability it has today.
Studio just gives it the same corpus and event stream the rest of the
workbench uses. New: a miss-cluster view, code lenses on rules, cross-links
to and from Schema Studio, and an "auto-grammar from schema" diff view that
wraps the existing schema-to-grammar generator.

### Find a regression — the headline

This is the loop described at the top of this document. From the
source-control gutter or the command palette, the developer kicks off a
replay across two versions (working tree vs a git ref, or any two refs),
gets the four-pane Impact Report, filters to "likely-bad change," drills
into individual rows, and decides whether to ship.

The Impact Report's panes:

1. **Structural diff** — what changed in the grammar at the rule level.
2. **Coverage delta** — coverage before vs after.
3. **Action-level delta** — every utterance where the two versions
   produced different action JSON, annotated with the latest feedback label
   per request id when one exists. This is the new primitive.
4. **Collisions delta** — any new action collisions the new version
   introduces.

Every row drills into the Trace Viewer for that one trace, side-by-side.

### Debug a single failing trace

> Eli arrives in the **Trace Viewer** from a red row in the Impact Report,
> or by right-clicking a thumbs-down message in the chat panel. The viewer
> renders the full dispatch tree for that one request: prompt → grammar
> match attempts (with which rules matched and missed) → cache hit/miss →
> translation phase (with LLM calls if any) → action selection → execution
> → result. Every node carries timing. Collision events for that trace are
> inline. Reasoning trace steps are correlated by request id. Eli clicks a
> grammar miss node and jumps to the grammar line that _should_ have
> matched and didn't.

Click any node, jump to source — grammar rule, schema variant, cache entry.
"Replay this trace" produces a fresh trace within a few seconds for the
target version.

### Observe a live session

> Frances opens Studio for a demo. The status bar shows the connection
> state and event rate. The Live Trace panel tails the structured event
> stream, one row per event. Filters by event type. Click any row → opens
> that trace in the Trace Viewer.

Same renderer as the per-trace view, just in tail mode. Keeps up with
normal-speed typing without backing up.

---

## 7. The path through the workbench

The journeys aren't independent — they compose. A typical week of work
looks like this:

1. **Author or pick an agent** to work on. New agents come in through the
   wizard; existing ones are loaded into the sandbox from the Sandboxes
   tree.
2. **Capture some real usage.** Talk to the agent in the chat panel; thumb
   up/down the responses. Anything captured this way enters the federated
   corpus tagged with provenance.
3. **Spot a problem class.** Schema Studio with a thumbs-down filter shows
   what users hated; the grammar miss-cluster view shows what they tried
   but couldn't say.
4. **Make a change.** Schema edits get inline collision diagnostics and
   live-mapping refresh; grammar edits get rule-level coverage feedback.
5. **Replay against real utterances.** From the source-control gutter, run
   the change against the corpus on the previous commit. The Impact Report
   shows what moved.
6. **Drill into anything suspicious.** Red rows in the Impact Report open
   the Trace Viewer, side-by-side with the previous version's trace.
7. **Ship or iterate.** If the report agrees with judgment, commit. If
   not, jump back to step 4.

The structured event stream is the connective tissue: every step in this
loop emits events with stable request and run identifiers, which is why
the Impact Report can drill into a specific trace and the Trace Viewer can
correlate reasoning steps with grammar matches with cache outcomes.

---

## 8. The ultimate goal

**Make schema and grammar changes a decision-grade activity instead of a
guessing game.** A developer edits a grammar file, hits _compare against
last week_, and gets a verdict — _this change improves 12 utterances,
breaks 3, and 2 of those 3 had user thumbs-down already so they were
already broken; ship it._ A new contributor opens VS Code, runs **New
Agent**, and produces something that works in one sitting without ever
touching `package.json`. A live debugging session shows what the system is
actually doing the moment it does it, with a click-through to the line of
grammar that owns the behaviour.

The compare-and-replay loop is the load-bearing experience; everything else
in the workbench either feeds it, zooms into one of its rows, or mirrors it
live. The ultimate goal is to make that loop boring — fast, reliable, and
something a developer reaches for without thinking, the way they currently
reach for the test runner.

---

## 9. Glossary

| Term                        | Meaning                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action collision**        | A user utterance is matched by two or more schema variants or grammar rules in conflicting ways. Detected at four points: agent load, schema edit, grammar edit, replay.                                   |
| **Action-level delta**      | One row of replay output describing one utterance, the actions the two versions produced for it, whether they're equal, the cache state on each side, the feedback label if any, and any collision events. |
| **AGR file**                | A `.agr` grammar source file. Compiled into a runtime grammar by the action-grammar compiler.                                                                                                              |
| **Anchor agent**            | The agent the workbench is built around for the initial release. The `player` agent.                                                                                                                       |
| **Center of gravity**       | The compare-and-replay loop. Compare schema or grammar versions against a corpus, see action-level impact, annotated with feedback labels.                                                                 |
| **Federated corpus**        | Three source types — in-repo, per-user captures, external — plus user-feedback entries, queryable as one.                                                                                                  |
| **Impact Report**           | The four-pane regression-finding webview: structural diff, coverage delta, action-level delta, collisions delta.                                                                                           |
| **Miss policy**             | What replay does on a cache miss. _Needs-explanation_ (the default — annotate the row, don't call the LLM), _live-LLM_ (call the LLM, costs tokens), or _strict-cache_ (skip the row entirely).            |
| **Sandbox**                 | An isolated agent-server instance Studio runs experiments in. Subprocess or in-memory. Always under the Studio-owned profile directory.                                                                    |
| **Schema Studio**           | The schema-tuning webview: corpus on the left, schema on the right, per-utterance mapping in the centre.                                                                                                   |
| **Structured event stream** | The typed event API the workbench reads from. Sits alongside the existing `debug("typeagent:*")` traces.                                                                                                   |
| **`typeagent-core`**        | The shared engine library. No VS Code dependency.                                                                                                                                                          |
| **`typeagent-studio`**      | The main VS Code extension.                                                                                                                                                                                |

---

## 10. Further reading

This document consolidates the five-part planning series. For deeper detail
on any topic, the source docs remain canonical:

| Doc                                                        | What it covers                                                                                                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`README.md`](./README.md)                                 | Series index, locked and open decisions, demo-script reference.                                                                                                                  |
| [`01-inventory.md`](./01-inventory.md)                     | What exists today: every TypeAgent package's surface relevant to Studio, in-flight work, open-question resolutions.                                                              |
| [`02-journeys.md`](./02-journeys.md)                       | The six personas and journeys in full, with success criteria per journey and cross-journey infrastructure.                                                                       |
| [`03-features.md`](./03-features.md)                       | Per-journey feature sketch at three layers (editor / panels / commands). The feature-to-primitive map.                                                                           |
| [`04-mvp-slice.md`](./04-mvp-slice.md)                     | The vertical slice that defines the first release. Acceptance gates, risk register, demo script.                                                                                 |
| [`05-implementation-plan.md`](./05-implementation-plan.md) | The single build plan for both presenters: workspace layout, API type surfaces, transport choices, sequencing (P-0…P-6 with agent phases S0–S5 mapped in), named open decisions. |
| [`USER-STORY.md`](./USER-STORY.md)                         | The authoring loop and the three interaction modes (human / AI-agent / hybrid).                                                                                                  |
| [`STUDIO-AGENT.md`](./STUDIO-AGENT.md)                     | The `studio` agent action-surface reference (groups A–F, tiers, approval boundary).                                                                                              |
| [`STATUS.md`](./STATUS.md)                                 | What's built, known issues, and the ready-to-start next slices.                                                                                                                  |

---

_End of consolidated design._
