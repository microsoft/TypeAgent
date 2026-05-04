# UI Capture — autonomous UI Automation onboarding

This subsystem turns a Windows desktop app into a TypeAgent-replayable action set by **driving the app autonomously and observing what it does**. Given an app's AUMID (or executable path), it produces a `discoveredActions.json` file containing user-meaningful actions with parameters and step-by-step playback recipes that can be replayed against a fresh instance of the app.

It's the alternative to API-based onboarding (`crawlDocUrl`, `parseOpenApiSpec`, `crawlCliHelp`): when the app has no public API surface but does have a UI, we crawl the UI directly via Microsoft's UI Automation framework.

## Pipeline overview

```
                ┌─ phase 0: snapshot baseline (UWP folders / registry / etc.)
                │
                ▼
          ┌─────────────┐    ┌─────────────────┐    ┌───────────────────┐
   AUMID ─►│  helper.exe │ ─► │  explore loop   │ ─► │  state graph      │
          │  (UIA via   │    │  (LLM oracle    │    │  states.jsonl +   │
          │   FlaUI)    │    │   picks moves)  │    │  transitions.jsonl│
          └─────────────┘    └─────────────────┘    └─────────┬─────────┘
                                                              │
                                                              ▼
                                                    ┌───────────────────┐
                                                    │  synthesis        │
                                                    │  (neutral classify│
                                                    │   → chunk         │
                                                    │   → cluster       │
                                                    │   → synthesize    │
                                                    │   → validate)     │
                                                    └─────────┬─────────┘
                                                              │
                                                              ▼
                                                    discoveredActions.json
                ▲                                       (with playback recipes)
                │
                └─ phase N: snapshot restore  ◄──── playback executor
                                                    can replay against
                                                    a fresh app instance
```

## Components

### Helper (`dotnet/uiAutomationHelper/`, C#)

A long-lived child process that exposes a JSON-RPC stdio surface backed by **FlaUI / UIA3**. The TS side (`HelperClient`) drives it. Why a separate process: UIA's COM apartment + Windows-only types are easier to handle in .NET than via Node N-API, and isolating the helper means a UIA crash doesn't take down the explorer.

Methods (one-line summaries — see `helperClient.ts` for full types):

| Surface | Methods |
|---|---|
| Lifecycle | `app.launch / attach / list / kill` |
| Capture | `tree.dump`, `tree.fingerprint`, `screenshot` |
| Drive | `do.invoke / toggle / setValue / select / expand / scroll / focus / click / sendKeys` |
| Find | `find` (with optional polling timeout) |
| Idle | `events.idle` (debounce on UIA focus events) |
| Record | `events.subscribe / unsubscribe` (server-pushed `event.fired` notifications) |
| Snapshot | `snapshot.capture / restore / delete` (folder copy + replace-not-merge) |
| Health | `health.ping` |

Selectors are a custom XPath-like DSL: `/Window[Name="Clock"][ClassName="ApplicationFrameWindow"]/Window[Name="Clock"][ClassName="Windows.UI.Core.CoreWindow"]/Custom[AutomationId="NavView"]/...`

Capture-time the helper picks the most stable identifier in priority order (AutomationId → Name + ClassName → ClassName → bare type) and resolves the path as a UIA descendant chain.

### Explorer (`explorer.ts` + `llmOracle.ts`)

Deterministic outer loop with a **pluggable `DecisionOracle`**. Per iteration:

1. `events.idle` (wait for UIA to settle)
2. `tree.dump` + `tree.fingerprint` → register state (or dedupe against existing)
3. Compute frontier (`frontier.ts`): every actionable, on-screen control gets a FrontierItem with available verbs (`invoke`, `toggle`, `setValue`, `select`, `expand`, `scroll`, …) and a destructive heuristic
4. Oracle decides: `act{frontierId, verb, value, expectedDelta, rationale}` | `stop` | `restore`
5. Execute the chosen verb against the chosen selector
6. Re-capture, append a transition (`source: "agent"`)
7. Persist `states.jsonl` + `transitions.jsonl` + `states/state-NNN.json` incrementally — runs are crash-recoverable

Budget knobs: `maxIterations` / `maxWallClockMs` / `maxStates` / `convergenceThreshold` (iterations since last new state).

The default `LlmOracle` uses **GPT-5** via TypeChat with a structured output schema (`exploreLlmSchema.ts`). The system prompt instructs breadth-over-depth exploration, popup/modal dismissal, avoidance of destructive actions, and committing to multi-step task completion. Prompt-caching-friendly structure: system prompt + goal stay constant; per-turn input is the current state's frontier + recent history.

A `StubOracle` exists for tests — it picks deterministically without calling an LLM.

### Synthesis (`synthesizer.ts`)

Five-stage pipeline that converts the raw graph into discovered actions:

1. **Neutral classification** — one GPT-5 call. For each captured state, judge: is this a settled rest point (user could start a new task) or mid-flow (modal, wizard, animation)? Modals / popups / flyouts / "Save"-bearing states are hard rules: NEVER neutral.

2. **Chunking** — deterministic. Split the transition log at neutral-state boundaries. A chunk is a path from one neutral state to the next neutral state; mid-flow transitions stay together inside one chunk.

3. **Clustering** — one GPT-5 call covering all chunks. Group by user-meaningful intent. Strict rules:
   - Aggressively merge multi-step task flows. `open dialog → fill fields → click Save` is ONE intent, not three.
   - Parameterize by variation. Same selector pattern with different values across chunks → same cluster.
   - Toggle-aware. The same Play/Pause button being clicked alternately is two clusters (`startStopwatch` and `pauseStopwatch`), not one cluster of nine clicks.
   - Don't emit fragments. No `setNameField` cluster — that's a sub-step of `createAlarm`.

4. **Per-cluster synthesis** — one GPT-5 call per cluster. Build the canonical playback by taking the LONGEST chunk in the cluster (so we don't drop intermediate steps), then for each step: if values vary across chunks → `valueRef "${paramName}"`, else `valueLiteral`. Detect destructive intents (delete/remove/reset/clear).

5. **Validation pass** — one GPT-5 call. Re-read the full action set and flag fragments / duplicates / broken / ambiguous actions. If duplicates are found (e.g., three `navigateToTabAlarm`/`Timer`/`Clock` actions doing the same thing differently), emit a `MergeRecommendation` with a proposed combined name (`navigateToTab`) and a parameter (`tab: "alarm"|"timer"|"clock"|...`). Apply merges automatically.

The output is a `discoveredActions.json` with the same outer shape that `crawlDocUrl` etc. produce, plus a `playback` field that's specific to the UI-capture path:

```jsonc
{
  "actionName": "createAlarm",
  "description": "Create a new alarm with a specified name and time.",
  "parameters": [
    { "name": "name",    "type": "string", "examples": ["Morning Alarm"] },
    { "name": "minutes", "type": "number", "examples": [30] }
  ],
  "playback": [
    { "selector": "/.../Button[AutomationId=\"AddAlarmButton\"]", "verb": "invoke" },
    { "selector": "/.../Edit[ClassName=\"TextBox\"]",            "verb": "setValue", "valueRef": "${name}" },
    { "selector": "/.../Custom[AutomationId=\"MinutePicker\"]",  "verb": "setValue", "valueRef": "${minutes}" },
    { "selector": "/.../Button[AutomationId=\"PrimaryButton\"]", "verb": "invoke" }
  ],
  "preconditions":  { "neutralState": "alarmTab", "description": "On the Alarm tab" },
  "postconditions": { "description": "New alarm appears in the alarm list" },
  "destructive": false
}
```

### Playback executor (`playbackExecutor.ts`)

Generic. Takes a `SynthesizedAction` + `params: Record<string, ...>` + helper client → executes the playback. Resolves `valueRef` against `params`, dispatches each step's verb to the appropriate `do.*` RPC, waits for UIA idle between steps that mutate structure (`invoke` / `select`), and returns a per-step success/failure log.

The executor is the same machinery used by both:
- The explorer's per-iteration action execution (via `runExploration`)
- A future runtime agent that exposes the discovered actions to TypeAgent

So whatever the explorer captured during the crawl is by construction replayable at runtime.

### Snapshot policy (`snapshotPolicy.ts`)

Per-integration safety net so a crawl that creates alarms / timers / cities can be reverted. Auto-detects UWP storage via `Get-AppxPackage`-derived `PackageFamilyName`, producing a candidate `SnapshotPolicy`:

```jsonc
{
  "version": 1,
  "integrationName": "windowsClock",
  "detectionStatus": "auto-candidate",
  "processIdentity": { "aumid": "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App" },
  "state": [
    { "kind": "folder", "path": "%LOCALAPPDATA%\\Packages\\Microsoft.WindowsAlarms_8wekyb3d8bbwe\\LocalState",   "recursive": true },
    { "kind": "folder", "path": "%LOCALAPPDATA%\\Packages\\Microsoft.WindowsAlarms_8wekyb3d8bbwe\\Settings",     "recursive": true },
    { "kind": "folder", "path": "%LOCALAPPDATA%\\Packages\\Microsoft.WindowsAlarms_8wekyb3d8bbwe\\RoamingState", "recursive": true }
  ]
}
```

Capture: kill the process if any source needs file locks released, then copy each source. Restore: kill the process, **delete** the target paths (replace-not-merge so files added during the crawl actually disappear), then copy the snapshot back.

The user is expected to review the auto-detected policy before approving it (`detectionStatus: "user-confirmed"`). A `markStateless` option is available for apps with no persisted state.

### Dynamic-controls calibration (`dynamicControls.ts`)

Some UIA controls change value without any user input — clock faces, running timer text, animations. If those leak into the state fingerprint, every fingerprint is unique and dedup breaks.

A calibration pass takes 3 tree dumps spaced 3 seconds apart with no input, diffs by selector, and emits `DynamicControlRule[]` flagging which controls' `value` / `name` / `toggleState` are unstable. The fingerprint computer (in the C# helper) skips those properties when matched.

Rules accumulate over time — the explorer can mark new dynamic controls as it observes drift it didn't explicitly cause (`reason: "explore-drift"`).

### Record mode (`recorder.ts`)

A separate path, mostly for **augmenting** an autonomous crawl with user-driven gestures the LLM didn't think to try. Subscribe to UIA's `InvokedEvent` / `PropertyChangedEvent` / `StructureChangedEvent` on a target window, and every event becomes a `transitions.jsonl` line.

Caveat: UIA's `InvokedEvent` doesn't propagate to in-process listeners for UWP apps under same-process synthetic-input invocation — `StructureChangedEvent` works but `InvokedEvent` only reliably fires for true user-driven events from outside the helper's process.

## On-disk layout per integration

```
~/.typeagent/onboarding/<integrationName>/
  snapshotPolicy.json                ← persisted from inferSnapshotPolicy + user approval
  dynamicControls.json               ← from calibrateDynamicControls + accumulating drift
  discoveredActions.json             ← canonical merged action set (input to phraseGen / runtime)
  snapshots/<id>/                    ← baseline + per-state if state-keyed strategy used
    manifest.json
    sources/<n>/                     ← captured folder contents
  recordings/<sessionId>/
    transitions.jsonl                ← from record mode
  runs/<runId>/                      ← one per exploration run
    states.jsonl                     ← state metadata index
    transitions.jsonl                ← edge log
    states/state-NNN.json            ← full TreeNode per state
    screenshots/state-NNN.png        ← optional
    discoveredActions.json           ← THIS RUN's contribution (merged into the workspace one)
    synthesisReport.md               ← human review, fed into the approve-actions phase
    metrics.json                     ← iteration count, walltime, stop reason, etc.
```

## Running a crawl

The shipping smoke tests under `test/` exercise each phase:

| Smoke | What it does |
|---|---|
| `clockSmoke.ts` | helper basics: launch → tree.dump → screenshot → invoke → kill (slice 1+2) |
| `snapshotSmoke.ts` | infer + capture + dirty + restore round-trip on a synthetic state dir (slice 3) |
| `calibrateSmoke.ts` | dynamic-controls calibration on a running stopwatch (slice 4) |
| `recorderSmoke.ts` | event subscription + JSONL recording (slice 5) |
| `exploreSmoke.ts` | autonomous explore loop with the deterministic StubOracle (slice 6a) |
| `llmExploreSmoke.ts` | autonomous explore loop with the LLM oracle (slice 6b) |
| `synthesizeSmoke.ts` | explore + synthesize → discoveredActions.json (slice 7) |
| `clockCrawl.ts` / `clockFullCrawl.ts` | full crawl with snapshot baseline + restore at end |
| `clockAgentDemo.ts` | replay a crawled action with new parameters + verify in the UI |
| `resynthesize.ts` | re-run synthesis on an existing `runs/<runId>/` without re-crawling |

Run any of them with `node packages/agents/onboarding/dist/uiCapture/test/<name>.js` after `pnpm --filter onboarding-agent run build`.

For a real crawl, env vars `AZURE_OPENAI_API_KEY_GPT_5` + `AZURE_OPENAI_ENDPOINT_GPT_5` must be set in `ts/.env`. Note that aiclient's env reading short-circuits on its empty-string default and doesn't fall back from `_GPT_5`-suffixed vars to base vars, so for non-default settings (timeouts etc.) the suffixed variant must also be set explicitly. The smoke tests handle this in their preamble.

## Quality observations from the Clock crawl

The pipeline produces real, replay-ready actions, but a few quality patterns are worth knowing:

- **GPT-5 is the difference.** The same crawl data goes from "12 fragmented actions" with an older model to "7 well-shaped actions" with GPT-5 + tightened prompts + validation. The reasoning model is doing structural work that smaller models can't.
- **Single-chunk clusters can't parameterize.** If only one chunk in the cluster has `setValue "New York"`, the synthesizer can't guess that the city should be a parameter. A second crawl that exercises the same intent with a different city fixes it. The validator flags these (`ambiguous` verdict, "consider parameterizing X").
- **Modal-name selectors can decay mid-flow.** Some UWP Group containers embed running state into their `Name` (e.g., `Stopwatch, Paused, 12 seconds 23 centiseconds`). Selectors built on those Names go stale immediately when the state changes. The current selector grammar handles this by adding ClassName disambiguation when no AutomationId is present, but ancestors with dynamic names remain a real issue.
- **UWP InvokedEvent doesn't fire in-process.** The autonomous loop doesn't depend on this (it re-dumps the tree after each action), but record-mode against a same-process driver only catches StructureChanged events.
- **Snapshot-restore is critical.** Without the baseline, every crawl leaves alarms / timers / cities behind. Make sure `snapshotPolicy.detectionStatus === "user-confirmed"` before any non-trivial run.

## Adding a new integration

For a UWP app with a Microsoft AUMID and a recognizable English UI, expect:

1. `inferSnapshotPolicy({ aumid })` → review the candidate folders, set `detectionStatus: "user-confirmed"`
2. Optional: `calibrateDynamicControls()` if the app has live time / progress / animation
3. `runExploration({ goal: "...task-oriented goal...", budget: { maxIterations: 25–60 } })` with the LLM oracle
4. `synthesize({ runDir, integrationName, workspaceDir })` — applies merge-into-workspace
5. Inspect `discoveredActions.json` and `synthesisReport.md`
6. If gaps: re-run `runExploration` with a *focused* goal naming only the missing area; synthesis merges automatically. Per-tab focused crawls produce much cleaner output than one mega-crawl.

For non-UWP apps: snapshot auto-detection won't find folders, so the user fills in the policy manually (or sets `markStateless` if there's no persisted state).
