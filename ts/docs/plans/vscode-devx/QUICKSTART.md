# TypeAgent Studio — Quickstart

> A practical guide for reviewing what's currently built. Updated as work
> progresses.
>
> For the design overview see [`DESIGN.md`](./DESIGN.md). For deep references
> see [`README.md`](./README.md) and the numbered planning docs in this
> folder.

---

## 1. Prerequisites

- **Node ≥ 22**, **pnpm ≥ 10**
- An OpenAI or Azure key in `ts/config.local.yaml` (see `config.sample.yaml`)
- VS Code

## 2. Build

From the repo root:

```pwsh
cd ts
pnpm i
pnpm --filter "@typeagent/core..." build      # core + its workspace deps
pnpm --filter typeagent-studio build          # the extension
```

The first build is the long one; subsequent rebuilds are incremental.

> If `typeagent-studio` tests later complain about `MODULE_NOT_FOUND` for
> `@typeagent/core`, rebuild core first — the studio package resolves
> `@typeagent/core/*` to `./dist/*.js`.

## 3. Run the tests

```pwsh
pnpm --filter "@typeagent/core" test          # → 120 passed
pnpm --filter typeagent-studio test:local     # → 91 passed
```

Both suites should be fully green. If they aren't, stop and investigate
before launching the extension — most things downstream depend on these.

## 4. Launch the extension in a dev VS Code

Open the repo in VS Code. There's a pre-configured launch config:

1. Run / Debug → pick **"Run TypeAgent Studio Extension"**
2. Press **F5**

This opens an Extension Development Host window with `typeagent-studio`
loaded. The pre-launch task builds the extension automatically.

In the dev window, click the **TypeAgent Studio** icon (a beaker) in the
activity bar.

---

## 5. What to try, in order

Roughly smallest-to-headline. Each item below is something that exists today
on this branch and is worth a click-through to review.

### 5.1 The Sandboxes view

The activity-bar app opens with a **Sandboxes** tree.

- Click the `+` (Start sandbox) in the view title. A row appears with a
  generated id and `running` state.
- Right-click the running row → **Load agent**. Pick `player`. The agent
  appears as a child row with a health badge and (real) schema/grammar
  hashes.
- Right-click the agent row → **Unload agent**.
- Right-click the sandbox row → **Restart** or **Stop**.

This exercises the sandbox-lifecycle primitive end-to-end: events fire on
each action and the tree refreshes itself off those events.

### 5.2 The Event Log view

While doing the steps above, open the **Event Log** view. Each
sandbox-lifecycle action emits a structured event you should see appear
live (icon + timestamp + agent). Hover any row for the full payload tooltip.

The view is a bounded ring (newest 200). Use **Clear** in the title bar to
reset.

### 5.3 The Health status bar

Bottom-right of the editor, a status-bar item shows the worst-case health
across all loaded agents. Load an agent that's intentionally broken (or
just observe with `player`) and watch the badge color update. Click it to
focus the Sandboxes view.

### 5.4 The Corpora view

The **Corpora** tree shows agents that currently have a corpus view.
Once `player` is loaded, expand it to see entries grouped by source
(`in-repo`, `captures`, `external`, `feedback`).

In-repo entries are read from `corpus/<agent>.utterances.jsonl` if such a
file exists. (At time of writing, `player` doesn't have an in-repo corpus
yet — see §7 below.)

### 5.5 Recording feedback

In the Corpora view title bar, click **Record feedback**. A guided flow
collects:

1. Thumbs up / down
2. The utterance the feedback is about
3. (Optional) agent
4. (Optional) category — for negative ratings: `wrong-agent`,
   `didnt-understand`, `bad-response`, `other`
5. (Optional) free-text comment

After recording, watch the Event Log — a `feedback.recorded` event
appears. If you supplied an utterance, it federates into the Corpora view
under that agent's `feedback` source.

### 5.6 The Collisions view

The **Collisions** view title bar offers **Scan grammars for collisions**.
This runs the real NFA overlap engine against every loaded agent's
compiled grammar.

- Run a scan with `player` loaded; expect a long list of detected
  overlaps (~100+).
- Each row shows the collision kind (overlap / shadow / ambiguity), a
  participant summary, and the detection point.
- Expand a row for participants (agent action types with file + line) and
  exemplar utterances.
- **Click a participant** to jump to its grammar source — the authored
  `.agr` file when present, otherwise the compiled `.ag.json`.

### 5.7 Replay corpus (the headline-but-incomplete experience)

In the Corpora view title bar, click **Replay corpus**.

- Pick a loaded agent.
- The runtime replays the agent's federated corpus through the replay
  engine, evaluating each utterance against versions A and B and
  classifying each row as **equal**, **changed**, **new match**, or
  **lost match**.
- A summary headline shows when the run finishes.
- When differences exist, a quick-pick of rows opens — icon, utterance,
  per-version cache state, and latency.

> **What's missing today:** the result is a quick-pick, not a webview.
> The Impact Report (the four-pane diff visualization that is the
> headline UI in [`DESIGN.md`](./DESIGN.md) §6) is not yet built. See §7.
>
> The default version-A vs version-B resolver is also currently an
> *identity* resolver — every utterance routes the same way on both
> sides, so the all-equal baseline is what you'll see. Real per-version
> build/dispatch is a future piece.

### 5.8 Onboarding (J1) — the wizard backend

The wizard webview itself isn't built yet, but the entire onboarding
*backend* is wired through commands:

- `TypeAgent Studio: Start onboarding session` — kicks off the seven-phase
  flow (Discovery, PhraseGen, SchemaGen, GrammarGen, Scaffolder, Testing,
  Packaging).
- `TypeAgent Studio: Run onboarding phase` / `Run remaining onboarding phases`
- `TypeAgent Studio: Show onboarding snapshot`
- `TypeAgent Studio: Restore onboarding phase` (re-runs marks downstream
  phases stale)
- `TypeAgent Studio: Rerun stale onboarding phases`
- `TypeAgent Studio: Install latest onboarding session to sandbox` (with
  packaging health gate)
- `TypeAgent Studio: Export onboarding artifact...` (summary, health
  snapshot, settings snapshot, packaging health report, or diagnostics
  bundle)

This is a lot of surface — most of it is operational scaffolding around
the install / health-gate / artifact-export flow, exercised through the
command palette today and intended to be hosted in a webview later.

---

## 6. Where to look in the source

If you want to read code, the highest-signal entry points:

| Area | Path | Notes |
|---|---|---|
| Engine library | `ts/packages/typeagent-core/src/` | Eight subdirs, one per primitive: `sandbox/`, `corpus/`, `events/`, `feedback/`, `health/`, `collisions/`, `replay/`, `onboardingBridge/`. Each has `types.ts` + a service implementation. |
| Replay engine | `ts/packages/typeagent-core/src/replay/engine.ts` | `replayCorpus()` itself — dependency-injected, ~330 lines, unit-tested. |
| Collision scan | `ts/packages/typeagent-core/src/collisions/scanner.ts` | The real NFA overlap pass. |
| Health rules | `ts/packages/typeagent-core/src/health/service.ts` | The 11 MVP rules. |
| Studio extension | `ts/packages/typeagent-studio/src/` | `extension.ts` is the activation entry; `commands.ts` wires the command palette; everything ending in `*Provider.ts` is a tree-data provider; everything ending in `*Presentation.ts` is the unit-testable formatting/shaping. |
| Tests | `ts/packages/typeagent-core/test/` and `ts/packages/typeagent-studio/src/test/` | The `*.spec.ts` files are good as a tour of the expected behaviour. |

The presentation/provider split (`*Presentation.ts` vs `*Provider.ts`) is
worth knowing about: the presentation modules are vscode-free and
unit-testable; the providers are thin VS Code adapters. When something
behaves wrong, the presentation layer is usually where to look first.

## 7. What is NOT yet built

So you don't go hunting for things that aren't there:

- **Impact Report webview** — the four-pane diff that is the headline UI.
  Replay engine works, but its output today is a quick-pick.
- **Schema Studio webview** — corpus / schema / mapping three-pane view.
- **Trace Viewer webview** — per-trace dispatch tree.
- **Live Trace webview** — tailed event stream rendering.
- **Wizard webview** — the seven onboarding phases as revisitable tabs.
  Only the backend commands exist.
- **`agr-language` refactor** — still standalone, not yet on
  `@typeagent/core`.
- **`vscode-shell` capture-to-corpus** — chat-bubble action to capture an
  utterance into the corpus. Not built; the corpus federation primitive
  is generic but no shell-side hook exists.
- **Per-version replay build/dispatch** — replay uses an identity
  resolver today. Building each side from a git ref and running it in a
  transient sandbox is future work.
- **Player corpus** — there's no `corpus/player.utterances.jsonl` yet, so
  the Corpora view is sparse without manual feedback recording.

These are the things [`DESIGN.md`](./DESIGN.md) describes as the final
system; this list will shrink as work proceeds.

---

## 8. Updating this guide

This is a living document. As features land or behaviour changes, edit
the corresponding section here and commit alongside the code change. The
goal is that anyone picking up the branch can run through §5 top to
bottom and have a faithful tour of what works.

If a feature graduates from §7 ("not built") into §5 ("here's how to try
it"), move it. If §5 grows past about 10 items, split it by webview.
