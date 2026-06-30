# Corpus capture — design & plan

## Framing (important)

Corpus capture is an **agent-agnostic capability**: it turns a real interaction
session into reusable corpus entries for **whatever agent(s) the session
exercised**. It is _not_ player-specific. `player` is simply the first corpus we
need to populate, because Gate C is scored on it — but the capture mechanism has
nothing to do with `player` in particular. A single captured session naturally
yields entries bucketed **per agent** (the dispatcher records which agent handled
each request), so capturing one mixed session can seed several agents' corpora at
once.

## What already exists (do not rebuild)

The corpus **storage, model, federation, replay-input, and UI tree are already
built and tested.** Concretely:

- **Model** — `typeagent-core/src/corpus/types.ts`: `CorpusEntry { id, utterance,
  agent, source, provenance, expectedAction?, feedback?, tags? }`,
  `CorpusProvenance { sourceUri, capturedAt?, sessionId?, requestId? }`,
  `FeedbackLabel { rating, category?, comment?, recordedAt }`,
  `CorpusSource = "in-repo" | "captures" | "external" | "feedback"`.
- **Storage** — `corpus/fileCorpusService.ts`: `FileCorpusService` with
  `list` / `load` / `append` / `promote` / `exportJsonl`, federating in-repo
  (`<repoRoot>/corpus/<agent>.utterances.jsonl`), captures
  (`<profileDir>/captures/<agent>/<timestamp>.jsonl`), external, and feedback
  sources. `append()` already writes a timestamped JSONL capture file and stamps
  `source="captures"` + `capturedAt`. `promote()` already moves captured entries
  into the in-repo file.
- **JSONL I/O** — `corpus/jsonl.ts`, **id** — `corpus/id.ts`
  (`computeEntryId(utterance, agent, requestId)`).
- **Replay input** — `replay/engine.ts` `replayCorpus(options, deps)` consumes
  `CorpusEntry[]` via a `ReplayCorpusProvider { list(agent, filter) }`. So
  anything we capture is immediately replayable.
- **Extension UI** — `corpusTreeProvider.ts` / `corpusTreePresentation.ts` render
  a "Corpora" tree (roots: in-repo / captures / external / feedback). Commands
  exist for `refreshCorpora`, `recordFeedback`, `replayCorpus`,
  `addExternalCorpus`, `seedInRepoCorpus`.
- **Tests** — `typeagent-core/test/corpus.spec.ts` covers append / promote /
  export / federation / filtering / path-traversal.

## The data source

A dispatcher session writes `displayLog.json`
(`dispatcher/dispatcher/src/displayLog.ts`). Its entries already contain
everything a corpus entry needs, correlated by `requestId.requestId`:

- `UserRequestEntry { requestId, command }` → the **utterance** (`command`).
- `SetDisplayInfoEntry { requestId, source, action? }` → the resolved
  **action** (`action: TypeAgentAction | string[]`) and the dispatching
  **agent** (`source`).
- `UserFeedbackEntry { requestId, rating, category?, comment? }` → the
  **feedback** (append-only; latest entry per requestId wins).

So a single `displayLog.json` is a sufficient capture source — no new logging is
required (there is no separate DB-logging path today).

### Where `displayLog.json` lives (confirmed on disk)

- **User-data root** — `getUserDataDir()` (`helpers/userData.ts`) =
  `process.env.TYPEAGENT_USER_DATA_DIR ?? ~/.typeagent`.
- **Instance dir** — `getInstanceDir()` under that root; this is the dispatcher's
  `persistDir`.
- **The display log** — `<instanceDir>/displayLog.json`. Confirmed: the dispatcher
  loads it with `DisplayLog.load(persistDir)`
  (`context/commandHandlerContext.ts`) and writes it with a debounced `save()` to
  `path.join(persistDir, "displayLog.json")`.
- **Session dirs** — `<instanceDir>/sessions/<name>/` hold `data.json`,
  `constructions/`, `user_files/`, enumerable via `getInstanceSessionNames()` /
  `getInstanceSessionsDirPath()` (`explorer.ts`).

**Key constraint:** `displayLog.json` is a **single live file at the instance
root that reflects the _current_ session** — it is _not_ archived per session
(the `sessions/<name>/` dirs do not contain their own displayLog). So:

- "Capture this session" reads `<instanceDir>/displayLog.json` for the live
  session.
- Capturing arbitrary _historical_ sessions is not directly available from
  displayLog (no per-session archive). The bulk-import path therefore targets
  **explicit `displayLog.json` files the user points at**, and the already-wired
  **feedback** federated source covers labelled history independently.

## The gap (what to build)

The one missing link is a **capture pipeline**: read a session's
`displayLog.json`, correlate its entries into `CorpusEntry[]` bucketed per agent,
and hand them to the existing `FileCorpusService.append()`. Plus the command /
UI to invoke it. **No new storage or model is needed.**

## Design

### 1. Pure transform (core, fully unit-testable)

A pure function that turns display-log entries into corpus entries:

```ts
interface CaptureLogEntry {            // narrow structural shape core reads
    type: string;
    requestId?: { requestId: string };
    command?: string;                  // user-request
    source?: string;                   // set-display-info: the agent
    action?: unknown;                  // set-display-info: resolved action
    rating?: "up" | "down" | null;     // user-feedback
    category?: string;
    comment?: string;
    timestamp?: number;
}

function displayLogToCorpusEntries(
    entries: CaptureLogEntry[],
    opts: { sourceUri: string; sessionId?: string; agentFilter?: (agent: string) => boolean; now?: () => number },
): CorpusEntry[];
```

Behaviour:

- Group by `requestId.requestId`. For each request, take the utterance from the
  `user-request` entry, the action + agent from the latest `set-display-info`
  entry (with an `action`), and the feedback from the latest `user-feedback`
  entry.
- **Bucket by agent** (`source`). Drop requests with no resolvable agent or whose
  agent is a system/dispatcher pseudo-source (configurable `agentFilter`).
- Emit `CorpusEntry { id: computeEntryId(utterance, agent, requestId), utterance,
  agent, source: "captures", provenance: { sourceUri, capturedAt: now,
  sessionId, requestId }, expectedAction: action, feedback }`.
- Dedupe within the batch by `id`.

**Dependency-direction note.** The real `DisplayLogEntry` union lives in
`dispatcher/types`. `typeagent-core` must not depend on the dispatcher. So core
exposes the transform over the narrow `CaptureLogEntry` structural type above;
the **studio-service** (which may legitimately know the dispatcher types) maps a
real `displayLog.json` to that shape before calling the transform. This keeps the
dependency arrow pointing the right way and keeps the transform trivially
testable with plain objects.

### 2. Service orchestration (studio-service)

- `captureSessionToCorpus({ displayLogPath?, agents? }) → { perAgent: Record<string, number>, total }`
  — load `displayLog.json` (default `<instanceDir>/displayLog.json`, the live
  session; or an explicit path), map to `CaptureLogEntry[]`, run the transform,
  then `append(agent, entries)` per agent bucket via `FileCorpusService`.
- `importDisplayLogs({ paths | dir, agents? }) → { perAgent, total, files }` — the
  bulk form: capture each `displayLog.json` the user points at.
- The studio-service already runs per-workspace and can resolve the active
  `instanceDir` via the dispatcher helpers (`getInstanceDir()` /
  `getInstanceSessionsDirPath()`), so locating the live displayLog needs no new
  discovery code.

### 3. Extension UI

- Command **`typeagent-studio.captureSessionToCorpus`** — choose a session /
  displayLog (or "current"), capture, then a toast: "Captured N entries across
  {player, list}." Refresh the Corpora tree (the refresh command already exists).
- Command **`typeagent-studio.importCorpusFromLogs`** — pick a folder of session
  logs for the bulk path.
- Optional: a context action on a session/sandbox tree node ("Capture this
  session to corpus") and on a captured entry ("Promote to in-repo corpus",
  reusing the existing `promote()`).

### 4. Promotion (already exists)

Vetting and promotion to the shared in-repo corpus is already implemented
(`promote()` + `seedInRepoCorpus`). Captured entries stay private under
`captures/<agent>/` until an explicit promote, so a personal session is never
silently leaked into the shared repo corpus.

## Gate C tie-in

This is the unblock for **Gate C**: capture (or bulk-import) a real `player`
session → `captures/player/` → promote → `corpus/player.utterances.jsonl` →
`replayCorpus` → Impact Report → hand-label → measure ≥ 80% agreement. The
capture step is agent-agnostic; `player` is just the first corpus pushed through
the gate.

## Delivery slices

1. **Core pure transform + tests** — `displayLogToCorpusEntries` over the narrow
   `CaptureLogEntry` shape; unit tests for multi-agent bucketing, feedback
   latest-wins, missing-action skip, dedupe. (No I/O, no dispatcher dependency.)
2. **Service capture/import** — `captureSessionToCorpus` + `importDisplayLogs`
   over `FileCorpusService.append`, including the displayLog→`CaptureLogEntry`
   adapter and session-log discovery.
3. **Extension commands** — capture + bulk-import commands, summary toast, tree
   refresh.
4. **(Optional) tree context actions** — capture-from-session-node, promote a
   captured entry.
5. **End-to-end validation** — run a real/sample player session through capture →
   promote → replay, then feed Gate C labelling.

## Open questions

- **Agent filter:** which `source` values on `SetDisplayInfoEntry` are real agents
  vs system pseudo-sources to exclude (e.g. the dispatcher/system source)?
- **`expectedAction` shape:** store the full `TypeAgentAction` or a normalized
  subset (translator + action name + params)?
- **Historical capture:** since displayLog is live-only, is bulk import of
  user-supplied `displayLog.json` files plus the feedback federated source enough,
  or do we eventually want the dispatcher to archive a per-session displayLog?

_Resolved:_ whole-session capture (every turn, not feedback-only); session-log
location confirmed (`<instanceDir>/displayLog.json`, live session).
