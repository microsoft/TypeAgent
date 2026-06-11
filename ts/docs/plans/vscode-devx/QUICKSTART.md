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

## 3. Run the extension

> **Open VS Code at `ts/`, not at the repo root.** The runtime resolves
> the agent loader against your first workspace folder and looks for
> `packages/agents/<name>` inside it. If you open the workspace at the
> repo root, the loader searches `<repo-root>/packages/agents/…` which
> doesn't exist — agents will show health `unknown` with empty
> schema/grammar hashes. Open the workspace at `<repo-root>/ts` to
> resolve correctly.

Two ways: a debug session (fastest for poking at code) or a real install
(closer to how a user will experience it).

### 3.1 As a debug session (F5)

Open the repo in VS Code. There's a pre-configured launch config:

1. Run / Debug → pick **"Run TypeAgent Studio Extension"**
2. Press **F5**

This opens an Extension Development Host window with `typeagent-studio`
loaded. The pre-launch task builds the extension automatically. Reloads
on rebuild; breakpoints work.

### 3.2 As an installed extension

Package and install into your real VS Code:

```pwsh
pnpm --filter typeagent-studio deploy:local
```

This builds a `.vsix` into `dist-pub/` and runs `code --install-extension`.
Reload your VS Code window afterwards. To uninstall later:
`code --uninstall-extension typeagent.typeagent-studio`.

Use `pnpm --filter typeagent-studio package` if you want the `.vsix`
without installing.

---

## 4. What to try, in order

Roughly smallest-to-headline. Each item below is something that exists today
and is worth a click-through to review.

### 4.1 The Sandboxes view

The activity-bar app opens with a **Sandboxes** tree.

- Click the `+` (Start sandbox) in the view title. A row appears with a
  generated id and `running` state.
- Each running sandbox row has inline icons at the right: **Load agent**
  (`+`), **Restart**, **Stop**. Click **Load agent** and pick `player`.
  The agent appears as a child row with a health badge and (real)
  schema/grammar hashes.
- Each agent row has an inline **Unload agent** (trash) icon.
- Stopped sandbox rows show an inline **Start** icon.

This exercises the sandbox-lifecycle primitive end-to-end: events fire on
each action and the tree refreshes itself off those events.

### 4.2 The Event Log view

While doing the steps above, open the **Event Log** view. Each
sandbox-lifecycle action emits a structured event you should see appear
live (icon + timestamp + agent). Hover any row for the full payload tooltip.

The view is a bounded ring (newest 200). Use **Clear** in the title bar to
reset.

### 4.3 The Health status bar

Bottom-right of the editor, a status-bar item shows the worst-case health
across all loaded agents. Load an agent that's intentionally broken (or
just observe with `player`) and watch the badge color update. Click it to
focus the Sandboxes view.

### 4.4 The Corpora view

The **Corpora** tree shows agents that currently have a corpus view.
Once `player` is loaded, expand it to see entries grouped by source
(`in-repo`, `captures`, `external`, `feedback`).

In-repo entries are read from `corpus/<agent>.utterances.jsonl` if such a
file exists. (At time of writing, `player` doesn't have an in-repo corpus
yet — see §6 below.)

### 4.5 Recording feedback

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

### 4.6 The Collisions view

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

### 4.7 Replay corpus (the headline-but-incomplete experience)

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
> headline UI described in [`DESIGN.md`](./DESIGN.md)) is not yet built.
> See §6.
>
> The default version-A vs version-B resolver is also currently an
> _identity_ resolver — every utterance routes the same way on both
> sides, so the all-equal baseline is what you'll see. Real per-version
> build/dispatch is a future piece.

### 4.8 Onboarding — the wizard backend

The wizard webview itself isn't built yet, but the entire onboarding
_backend_ is wired through commands:

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

## 5. Where to look in the source

If you want to read code, the highest-signal entry points:

| Area             | Path                                                                            | Notes                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engine library   | `ts/packages/typeagent-core/src/`                                               | Eight subdirs, one per primitive: `sandbox/`, `corpus/`, `events/`, `feedback/`, `health/`, `collisions/`, `replay/`, `onboardingBridge/`. Each has `types.ts` + a service implementation.                                     |
| Replay engine    | `ts/packages/typeagent-core/src/replay/engine.ts`                               | `replayCorpus()` itself — dependency-injected, ~330 lines, unit-tested.                                                                                                                                                        |
| Collision scan   | `ts/packages/typeagent-core/src/collisions/scanner.ts`                          | The real NFA overlap pass.                                                                                                                                                                                                     |
| Health rules     | `ts/packages/typeagent-core/src/health/service.ts`                              | The 10 MVP rules.                                                                                                                                                                                                              |
| Studio extension | `ts/packages/typeagent-studio/src/`                                             | `extension.ts` is the activation entry; `commands.ts` wires the command palette; everything ending in `*Provider.ts` is a tree-data provider; everything ending in `*Presentation.ts` is the unit-testable formatting/shaping. |
| Tests            | `ts/packages/typeagent-core/test/` and `ts/packages/typeagent-studio/src/test/` | The `*.spec.ts` files are good as a tour of the expected behaviour.                                                                                                                                                            |

The presentation/provider split (`*Presentation.ts` vs `*Provider.ts`) is
worth knowing about: the presentation modules are vscode-free and
unit-testable; the providers are thin VS Code adapters. When something
behaves wrong, the presentation layer is usually where to look first.

## 6. What is NOT yet built

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

## 7. Updating this guide

This is a living document. As features land or behaviour changes, edit
the corresponding section here and commit alongside the code change. The
goal is that anyone picking up this work can run through §4 top to
bottom and have a faithful tour of what works.

If a feature graduates from §6 ("not built") into §4 ("here's how to try
it"), move it. If §4 grows past about 10 items, split it by webview.
