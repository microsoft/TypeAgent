# UI Capture — autonomous UI Automation onboarding (experimental)

> **Status: Experimental.** This UI-crawling approach is under active development. Selectors, helper RPC surface, synthesis prompts, and on-disk artifact shapes are not yet stable and may change without notice. Use it for evaluation and feedback, not as a production onboarding path.

This subsystem turns a Windows desktop app into a TypeAgent-replayable action set by **driving the app autonomously and observing what it does**. Given an app's AUMID (or executable path), it produces a `discoveredActions.json` file containing user-meaningful actions with parameters and step-by-step playback recipes that can be replayed against a fresh instance of the app.

It's the experimental alternative to API-based onboarding (`crawlDocUrl`, `parseOpenApiSpec`, `crawlCliHelp`): when the app has no public API surface but does have a UI, we crawl the UI directly via Microsoft's UI Automation framework.

## Status (2026-05-05)

**Working end-to-end through TypeAgent.** The full pipeline ships — helper, exploration, snapshot capture/restore, dynamic-controls calibration, record mode, synthesis with merge-into-workspace, validation pass, vision-driven reconnaissance, playback executor, scaffolder for runtime agents, and dispatcher integration.

Verified on Windows Clock with a 4-tab focused-crawl run:
- 35 candidate actions surfaced by vision recon
- 4 per-tab crawls (alarm, stopwatch, worldclock, focus) merged into 14 actions in `discoveredActions.json`
- Scaffolded into `packages/agents/windowsClock/`, registered in dispatcher
- `run request "in windows clock, set an alarm for 8:30 named morning"` → real "morning" alarm at 8:30 AM in Clock's tree

**What's still left (by priority):**

1. **createAlarm assumes the right tab is already active.** Synthesis correctly extracted the alarm-creation flow but discarded the tab-navigate prefix (it became its own `navigateToAlarmTab` action). Multi-step user requests through TypeAgent need to chain `navigateToAlarmTab` → `createAlarm`. Real fix: the runtime handler should auto-call `navigateToTab` matching the action's `tabOrSection` if the app isn't already there. Synthesizer could also inject the prefix step explicitly.
2. **Toggle boolean parameter examples are nonsense.** Auto-merged actions like `setStopwatchRunning(running: boolean)` get `examples: ['stopwatch']` instead of `[true, false]` — `applyMergeRecommendations` falls back to `collectExamples` which derives from the action-name suffix. Recipes still execute correctly because the boolean isn't referenced in the 1-step toggle playback, but the schema example values are misleading. Fix: pass `[true, false]` for boolean enum params during merge.
3. **Dispatcher construction cache misroutes common phrasings.** Phrases like *"create an alarm"* hit the onboarding-agent's `scaffoldAgent`, *"go to X"* hits `excel.navigateToCell`, *"switch to"* hits `player.selectDevice`. Workaround during testing: include "windows clock" in the request to force fresh translation. Real fix: clear the construction cache after adding a new agent OR write explicit grammar (`.agr`) for windowsClock so its phrases populate the cache with the right routing.
4. **TypeAgent integration via the scaffolder is now the canonical path.** Synthesizer prompts haven't been iterated against the recon-driven richer input — some sub-step actions (`nameAlarm`, `setAlarmTime`) emitted by recon should roll up into one `createAlarm(name, hour, minute)`. The current synthesis pass mostly handles this but a focused review is warranted.
5. **Selector decay through dynamic ancestors** (e.g., `Group[Name="Stopwatch, Paused, 12 seconds"]` ancestors invalidating once the stopwatch starts). `Selectors.BuildSegment` adds ClassName for disambiguation when AutomationId is missing, but a Group with ONLY a dynamic Name can't be salvaged that way. Future work: a selector-relative resolver that searches descendants from the nearest stable ancestor. Showed up in the multi-tab crawl as the only repeated failure (`recordLap` and `setStopwatchRunning` had stale selectors after the stopwatch started ticking).
6. **Selector fallback for action playback.** Single-identifier selectors break when an app version changes a Name or AutomationId. A multi-identifier selector format (record AutomationId AND Name AND ClassName at capture; resolver tries them in order) would harden replay.
7. **Helper bundling for shipped agents.** The runtime agent currently resolves the helper binary via a repo-relative dev path. For an agent that ships independently, the helper exe needs to be bundled into the agent's `bin/` and the resolver updated.

## Pipeline overview

```
            ┌─ phase 0: snapshot baseline (UWP folders / registry / etc.)
            │
            ▼                                  optional vision-LLM phase:
       ┌────────┐    ┌────────────────┐        per-tab survey or iterative
AUMID ►│ helper │ ─► │ reconnaissance │ ─► ExpectedAction[] (TODO list)
       │        │    │ (vision LLM)   │           │
       └────────┘    └────────────────┘           ▼
            │                            ┌──────────────────┐
            └─────────────────────────► │  explore loop    │
                                         │  (LLM oracle —   │
                                         │  drives the TODO │
                                         │  list, observes) │
                                         └────────┬─────────┘
                                                  ▼
                                         state graph (states.jsonl +
                                         transitions.jsonl + per-state
                                         TreeNode JSON)
                                                  │
                                                  ▼
                                         ┌──────────────────────┐
                                         │  synthesis (GPT-5)   │
                                         │  neutral-classify →  │
                                         │  chunk → cluster →   │
                                         │  synthesize →        │
                                         │  validate (auto-     │
                                         │  merge duplicates)   │
                                         └────────┬─────────────┘
                                                  ▼
                                         discoveredActions.json
            ▲                            (parameters + playback recipes,
            │                             merged into workspace-level file)
            │                                     │
            └─ phase N: snapshot restore   ◄──────┤
                                                  ▼
                                         playback executor replays any
                                         action with new parameter values
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

### Reconnaissance (`tabReconnaissance.ts`, `iterativeReconnaissance.ts`)

Optional but highly effective: send screenshots + filtered control trees to a vision-capable LLM and have it enumerate the actions each tab/screen supports BEFORE running the autonomous explorer. The output (`ExpectedAction[]`) becomes a numbered TODO list that's fed into the explore loop's goal — much more deterministic coverage than free-form exploration.

Two flavors:

- **`tabReconnaissance.reconnoiterApp`** — deterministic tab discovery (largest cluster of sibling ListItems with SelectionItem pattern), then ONE vision call per tab. Fast (~1–2 min), shallow (only sees top-level tab content).

- **`iterativeReconnaissance.iterativeReconnoiter`** — multi-turn loop. Per turn the vision LLM sees the current screenshot + filtered tree + already-discovered list, returns `newDiscoveries[]` plus a `click` / `back` / `done` decision. **Drills INTO modals/dialogs** to enumerate their fields, then clicks Cancel to back out. Way richer — Clock test with 20 turns produced 34 distinct actions across 5 tabs including secondary features (`keepTimerOnTop`, `linkSpotify`, `repeatAlarm` with days-of-week enum, `setAlarmSound` with sound enum). Correctly flagged `resetStopwatch` as destructive.

Vision model selection: `getReconModel()` defaults to **GPT-v** (the dedicated vision deployment in this Azure config). GPT-5 deployments here returned "API version not supported" for `image_url` content; GPT-4o uses a `/openai/v1/...` URL shape that aiclient doesn't construct correctly. GPT-v on the standard `/openai/deployments/...` path works directly.

TypeChat wiring for vision: image content goes in `promptHistory` as a prior user message; the schema-bearing text prompt goes via `translate(request)` so TypeChat's standard "respond with this JSON schema" wrapper is appended. The markdown agent uses the same pattern.

`renderIterativeReconAsGoal(recon)` turns the discovered list into a TODO-style goal string for the explore loop. The explorer then drives each action concretely (with the recon's example parameter values), producing one chunk per intent — clustering and synthesis become easier downstream.

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
| `clockIterativeRecon.ts` | iterative vision recon only (fast iteration on the recon prompt) |
| `clockReconCrawl.ts` | recon → goal-from-recon → crawl → synthesize → restore (the "best" pipeline) |

Run any of them with `node packages/agents/onboarding/dist/uiCapture/test/<name>.js` after `pnpm --filter onboarding-agent run build`.

For a real crawl, env vars `AZURE_OPENAI_API_KEY_GPT_5` + `AZURE_OPENAI_ENDPOINT_GPT_5` must be set in `ts/.env`. Note that aiclient's env reading short-circuits on its empty-string default and doesn't fall back from `_GPT_5`-suffixed vars to base vars, so for non-default settings (timeouts etc.) the suffixed variant must also be set explicitly. The smoke tests handle this in their preamble.

## Quality observations from the Clock crawl

The pipeline produces real, replay-ready actions, but a few quality patterns are worth knowing:

- **GPT-5 is the difference for synthesis.** The same crawl data goes from "12 fragmented actions" with the default model to "7 well-shaped actions" with GPT-5 + tightened prompts + validation. The reasoning model is doing structural work that smaller models can't.
- **Vision recon is the difference for coverage.** Free-form explore alone catches ~7-8 actions because the LLM oracle gravitates to obvious primary buttons. Vision-driven iterative recon caught 34 actions on Clock by drilling into Add-X dialogs and noticing secondary features (`keepTimerOnTop`, `linkSpotify`, `repeatAlarm` enum, etc.). Recon is now the recommended starting point.
- **Single-chunk clusters can't parameterize.** If only one chunk in the cluster has `setValue "New York"`, the synthesizer can't guess that the city should be a parameter. A second crawl that exercises the same intent with a different city fixes it. The validator flags these (`ambiguous` verdict, "consider parameterizing X").
- **Modal-name selectors can decay mid-flow.** Some UWP Group containers embed running state into their `Name` (e.g., `Stopwatch, Paused, 12 seconds 23 centiseconds`). Selectors built on those Names go stale immediately when the state changes. The current selector grammar handles this by adding ClassName disambiguation when no AutomationId is present, but ancestors with dynamic names remain a real issue.
- **UWP InvokedEvent doesn't fire in-process.** The autonomous loop doesn't depend on this (it re-dumps the tree after each action), but record-mode against a same-process driver only catches StructureChanged events.
- **Snapshot-restore is critical.** Without the baseline, every crawl leaves alarms / timers / cities behind. Make sure `snapshotPolicy.detectionStatus === "user-confirmed"` before any non-trivial run.
- **API-version + URL-shape gotchas in aiclient.** GPT-5 and GPT-v deployments work via standard Azure paths. GPT-4o uses `/openai/v1/chat/completions` (Responses-API style) which aiclient doesn't construct correctly — request returns "API version not supported." Stick to GPT-5 for synthesis and GPT-v for vision; revisit if we need GPT-4o specifically.
- **Endpoint-suffixed env vars don't fall back.** aiclient's `getEnvSetting` short-circuits on its empty-string default and doesn't fall back from `_GPT_5`-suffixed vars to base vars when an endpoint suffix is set. Smoke tests have to set BOTH `AZURE_OPENAI_MAX_TIMEOUT` and `AZURE_OPENAI_MAX_TIMEOUT_GPT_5` (and `_GPT_v`) explicitly.

## Adding a new integration

For a UWP app with a Microsoft AUMID and a recognizable English UI, the recommended sequence:

1. `inferSnapshotPolicy({ aumid })` → review the candidate folders, set `detectionStatus: "user-confirmed"`
2. Optional: `calibrateDynamicControls()` if the app has live time / progress / animation that would otherwise pollute the state fingerprint
3. **`iterativeReconnoiter({ appHint, maxIterations: 20–25 })`** — vision LLM enumerates actions per tab including modals. This is the new step that dramatically lifts coverage.
4. `runExploration({ goal: renderIterativeReconAsGoal(recon), budget: { maxIterations: 30–60 } })` — the explorer drives the recon's TODO list; its LLM oracle picks moves to complete each action.
5. `synthesize({ runDir, integrationName, workspaceDir })` — neutral classify → chunk → cluster → synthesize → validate; merges into the workspace-level `discoveredActions.json`.
6. Inspect `discoveredActions.json` and `synthesisReport.md`. If validation flagged duplicates / fragments, the merge step already auto-fixed obvious ones; the rest are notes for human review.
7. If gaps: re-run `runExploration` with a *focused* goal naming only the missing area; synthesis merges automatically. Per-tab focused crawls produce cleaner output than one mega-crawl.

The `clockReconCrawl.ts` smoke runs this whole sequence end-to-end against Windows Clock — read it as a reference implementation.

For non-UWP apps: snapshot auto-detection won't find folders, so the user fills in the policy manually (or sets `markStateless` if there's no persisted state). Reconnaissance + exploration work the same way.
