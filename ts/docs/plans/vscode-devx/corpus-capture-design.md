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
  (`<repoRoot>/corpus/<agent>.utterances.jsonl`), external, and feedback
  sources. `append()` writes a timestamped JSONL file under
  `<profileDir>/captures/<agent>/` stamped `source="captures"` + `capturedAt`;
  this captures area is a private, transient staging spot used only while an
  import promotes entries, and is **not** part of the federated `list` view.
  `promote()` moves staged entries into the in-repo file and is the only write
  that touches it.
- **JSONL I/O** — `corpus/jsonl.ts`, **id** — `corpus/id.ts`
  (`computeEntryId(utterance, agent, requestId)`).
- **Replay input** — `replay/engine.ts` `replayCorpus(options, deps)` consumes
  `CorpusEntry[]` via a `ReplayCorpusProvider { list(agent, filter) }`. So
  anything we capture is immediately replayable.
- **Extension UI** — `corpusTreeProvider.ts` / `corpusTreePresentation.ts` render
  a "Corpora" tree (roots: in-repo / external, one row per backing file). Commands
  exist for `refreshCorpora`, `replayCorpus`, `addExternalCorpus`,
  `seedInRepoCorpus`.
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
interface CaptureLogEntry {
  // narrow structural shape core reads
  type: string;
  requestId?: { requestId: string };
  seq?: number; // log order, for tie-breaking
  command?: string; // user-request
  source?: string; // set-display-info: the agent
  actionIndex?: number; // set-display-info: position in a multi-action request
  action?: unknown; // set-display-info: resolved action
  rating?: "up" | "down" | null; // user-feedback ("null" = cleared)
  category?: string;
  comment?: string;
  timestamp?: number;
}

function displayLogToCorpusEntries(
  entries: CaptureLogEntry[],
  opts: {
    sourceUri: string;
    sessionId?: string;
    agentFilter?: (agent: string) => boolean;
    now?: () => number;
  },
): CorpusEntry[];
```

Behaviour:

- Group by `requestId.requestId`. For each request, take the utterance from the
  `user-request` entry, and the dispatching **agent** from the `source` field.
- **Action is a sequence, not a single value.** A single request can emit
  multiple `set-display-info` entries (`actionIndex` 0..N). Collect **all** of
  them that carry an `action`, ordered by `actionIndex` (falling back to `seq` /
  log order), into an ordered list. Represent `expectedAction` as that list when
  there is more than one action, and as the single action when there is exactly
  one — never silently keep only the last. (Replay caveat below.)
- **Feedback latest-wins, with clear semantics.** Take the latest
  `user-feedback` entry for the request. If its `rating` is `null` (the user
  cleared their rating), **omit `feedback` entirely** — `FeedbackLabel.rating`
  is `"up" | "down"` only and cannot represent a cleared rating.
- **Bucket by agent** (`source`). Drop requests with no resolvable agent or whose
  agent is rejected by `agentFilter`.
- Emit `CorpusEntry { id, utterance, agent, source: "captures", provenance:
{ sourceUri, capturedAt: now, sessionId, requestId }, expectedAction, feedback }`.
- **Id is logical, not request-scoped.** Use `computeEntryId(utterance, agent)`
  (requestId stays in `provenance` only). `RequestId.requestId` is not stable or
  globally unique across sessions, so keying the id on it would make re-capturing
  the same logical utterance produce duplicate, double-counted corpus rows.
- Dedupe within the batch by `id` (the service also dedupes against existing
  entries on append/import — see below).

**Replay-fidelity caveat (multi-action).** The grammar replay resolver currently
returns a single top action per side (`topMatchAction` → `results[0]`), so a
multi-action `expectedAction` list will not compare equal against a
single-action replay result. `actionsEqual` _can_ compare arrays structurally,
so the corpus model is ready; the gap is on the resolver side. Capture stores the
true sequence regardless; faithful multi-action replay is tracked as a separate
replay-engine improvement, not a reason to lose data at capture time.

**Dependency-direction note.** The real `DisplayLogEntry` union lives in
`dispatcher/types`. `typeagent-core` must not depend on the dispatcher. So core
exposes the transform over the narrow `CaptureLogEntry` structural type above;
the **studio-service** (which may legitimately know the dispatcher types) maps a
real `displayLog.json` to that shape before calling the transform. This keeps the
dependency arrow pointing the right way and keeps the transform trivially
testable with plain objects.

### 2. Service orchestration (studio-service)

- `captureSessionToCorpus({ displayLogPath?, agents? }) → { perAgent: Record<string, number>, skipped: Record<string, number>, total }`
  — load `displayLog.json` (default `<instanceDir>/displayLog.json`, the live
  session; or an explicit path), map to `CaptureLogEntry[]`, run the transform,
  then write per agent bucket via `FileCorpusService`.
- `importDisplayLogs({ paths | dir, agents? }) → { perAgent, skipped, total, files }`
  — the bulk form: capture each `displayLog.json` the user points at. This is the
  **Gate C critical-path entry point** (see slices).
- **Agent selection is an explicit allowlist, not a core heuristic.** The core
  transform's default `agentFilter` simply accepts any non-empty `source`; it
  does **not** hard-code a pseudo-source blacklist. The service passes an explicit
  `agents` allowlist (e.g. `["player"]` for Gate C) so a `dispatcher`/system
  source is excluded by selection, transparently, rather than by a hidden rule.
- **Append once per agent.** `FileCorpusService.append()` names its capture file
  by an ISO-millisecond timestamp, so two `append(agent, …)` calls in the same
  millisecond (common in bulk import or with an injected clock) collide. The
  service must **aggregate all entries for an agent and call `append` once per
  agent per run**.
- **Dedupe against existing.** `append()` does not dedupe; only `loadAll()`
  dedupes by `id`. Before appending, the service loads the agent's existing
  federated entries and drops captures whose logical `id` already exists, counting
  them in `skipped`, so re-importing the same log is idempotent.
- **Provenance of the raw log.** `append()` overwrites `provenance.sourceUri` with
  the captures-JSONL path, so the original `displayLog.json` path would be lost.
  The transform preserves it in `provenance.rawSourceUri` so entries staged in the
  private captures area remain traceable to their source log. This field is
  machine-local, so promotion into the shared in-repo file strips `rawSourceUri`
  and rewrites `sourceUri` to a repo-relative path, keeping the committed file
  portable and free of local paths. The absolute path is re-derived on read.
- The studio-service already runs per-workspace and can resolve the active
  `instanceDir` via the dispatcher helpers (`getInstanceDir()` /
  `getInstanceSessionsDirPath()`), so locating the live displayLog needs no new
  discovery code.

### 3. Extension UI

- Command **`typeagent-studio.importCorpusFromLogs`** — the **primary** capture
  affordance: pick one or more `displayLog.json` files (or a folder), capture with
  an explicit agent allowlist, then a toast: "Imported N entries across
  {player, list} into the shared in-repo corpus; skipped M duplicates." Refresh
  the Corpora tree (the refresh command already exists). Imported entries land
  directly in the shared `corpus/<agent>.utterances.jsonl` (append-then-promote),
  so there is no per-utterance staging step; the new/changed corpus files appear
  as ordinary working-tree changes the curator reviews and commits.
- Command **`typeagent-studio.captureSessionToCorpus`** — capture the **current**
  live session's displayLog. Secondary: the live log is a single mutable
  current-session file and `DisplayLog.load` swallows malformed JSON and returns
  an empty log, so this path must surface "captured 0 entries" clearly rather than
  silently succeeding. Prefer this only once the Studio↔live-dispatcher
  relationship is proven.

### 4. Promotion

`promote()` moves a set of staged entries (by logical id) into the shared
in-repo `corpus/<agent>.utterances.jsonl`, and is the only write that touches
that file. Import is append-then-promote: it stages fresh entries under
`captures/<agent>/` and promotes them in the same step, so the import command
lands straight in the shared corpus and leaves nothing behind. The captures area
is a private transient scratch space — it is never part of the federated view
and is not shown in the Corpora tree. The new/changed in-repo files surface as
ordinary working-tree changes the curator reviews and commits, so a personal
session is never silently leaked into the shared repo corpus.

### 5. Feedback is a request-scoped observation, not utterance ground truth

Feedback (thumbs up/down + optional category/comment) is a label about **one
observed run** — a specific `(utterance → resolved action)` result — not a durable
property of the utterance. This matches the shipped feedback mechanism and the
headline design:

- The rating is keyed **per `requestId`** and is **append-only, latest-wins per
  `requestId`** — a mutable observation that changes over time, not a fixed fact.
  Per-action detail is only reachable via the opt-in context bundle
  (`context.actions[]`); without it, the grain is the request.
- The compare-and-replay design consumes feedback **at replay time**: each
  action-level delta row is annotated with the latest feedback for that request,
  coloring a change as "you fixed a known-bad response" or "you broke a known-good
  one." The replay engine already carries this as `feedbackA` / `feedbackB` on the
  delta. Feedback annotates the **action a run produced**, correlated when the
  report is built.

**Why there is no per-utterance "expected action" ground truth.** Resolution is
non-deterministic: the same utterance can resolve to different actions across
runs (LLM translation, ranked candidates, cache state). So a rating is a judgment
of the action seen in that run, not of the utterance in the abstract. A 👍 on
action X and a later 👎 on action Y for the same utterance are two facts about two
actions, not a contradiction to be reconciled by recency. Collapsing them to a
single utterance-level label would be lossy and can be actively wrong. The design
never posits a fixed correct action per utterance; feedback stays mutable and
observation-scoped. (The replay compare basis is a live re-resolution on each
side, `actionsEqual(a.action, b.action)` — not a stored expected action.)

**Consequences (decisions):**

- **Feedback is not persisted into the committed in-repo corpus file.** The in-repo
  `corpus/<agent>.utterances.jsonl` is the curated, git-shared, stable set of test
  _inputs_; it holds the durable utterance definition only. Baking mutable,
  per-developer, request-scoped ratings into it would churn a committed file every
  time a rating flips and commit unreconciled cross-developer conflicts. Promotion
  therefore strips any `feedback` field before writing.
- **Utterance rows do not display a feedback rating.** A rating is not a property of
  the curated utterance, so the corpus tree does not stamp a thumbs icon onto
  file-backed entries or merge a live label onto them.
- **Feedback stays a live, session/observation-scoped signal**, surfaced for triage
  and consumed by the Impact Report at replay time. The default backend is
  in-memory (`InMemoryFeedbackBackend`); a durable store is a separate follow-up
  only if a use case needs labels to survive restart.

**Decision:** the standalone "Record feedback" command and the read-time
"Feedback" group in the Corpora tree are **retired**. They were a scaffold that
collected an utterance + rating with no `(request, response, action)` context,
so they could not carry the linkage that gives feedback its meaning. Feedback's
real home is the Impact Report at replay time, sourced from ratings on actual
response bubbles (each tied to a `requestId` → action). The core feedback
service, `feedback.recorded` events, and the capture-time feedback transform
stay in place so that per-bubble rating can be wired up later without rebuilding
the plumbing.

## Gate C tie-in

This is the unblock for **Gate C**: capture (or bulk-import) a real `player`
session → `captures/player/` → promote → `corpus/player.utterances.jsonl` →
`replayCorpus` → Impact Report → hand-label → measure ≥ 80% agreement. The
capture step is agent-agnostic; `player` is just the first corpus pushed through
the gate.

## Delivery slices

Ordered to reach **Gate C** as directly as possible — explicit displayLog import
is the critical path; live-session capture and tree polish come after.

1. **Core pure transform + tests** — `displayLogToCorpusEntries` over the narrow
   `CaptureLogEntry` shape. Tests for: multi-agent bucketing; **multi-action
   ordered sequence** (actionIndex 0..N, missing action at one index, out-of-order
   log); feedback latest-wins **including `rating: null` → omit**; missing-action
   skip; **logical-id stability** (same utterance/different requestIds dedupe);
   in-batch dedupe. (No I/O, no dispatcher dependency.)
2. **Service import (critical path)** — `importDisplayLogs` over
   `FileCorpusService`, including the displayLog→`CaptureLogEntry` adapter,
   per-agent single `append`, dedupe-against-existing, and raw-source provenance.
   This alone unblocks Gate C (import an existing `player` displayLog).
3. **Extension import command** — `importCorpusFromLogs` (explicit files/folder,
   agent allowlist), summary toast with skipped count, tree refresh.
4. **Live-session capture** — `captureSessionToCorpus` + its command, once the
   live-log relationship is proven; clear "0 entries" handling.
5. **(Optional) tree context actions** — promote a captured entry.
6. **End-to-end validation** — run a real/sample player session log through import
   → promote → replay, then feed Gate C labelling.

## Open questions

- **`expectedAction` shape:** store the full `TypeAgentAction` (sequence) or a
  normalized subset (translator + action name + params)? Capture stores the full
  ordered sequence; normalization for comparison is a replay-side concern.
- **Multi-action replay fidelity:** the resolver returns one top action per side
  today. Do we extend it to produce the full action sequence so multi-action
  corpus rows compare faithfully, or scope Gate C to single-action utterances
  first? (Replay-engine work, separate from capture.)
- **Historical capture:** since displayLog is live-only, is bulk import of
  user-supplied `displayLog.json` files plus the feedback federated source enough,
  or do we eventually want the dispatcher to archive a per-session displayLog?
- **Durable feedback store (follow-up):** the default feedback backend is
  in-memory, so labels are lost on restart. Where should feedback persist so
  Gate C labels survive — a dispatcher-backed backend, or a Studio-owned store?
  (Separate from capture; tracked here because feedback labels feed Gate C.)

_Resolved (design review, verified against code):_

- Whole-session capture (every turn, not feedback-only).
- Session-log location confirmed (`<instanceDir>/displayLog.json`, live session).
- Capture the **ordered multi-action sequence**, never just the last action.
- Latest feedback `rating: null` → **omit** feedback (no `FeedbackLabel`).
- **Logical id** `computeEntryId(utterance, agent)`; requestId in provenance only.
  The **feedback projector** (`toCorpusEntries`) should adopt the same logical id
  so feedback merges onto the matching captured entry instead of duplicating it.
- Feedback is a **label, not a funnel**: no auto-write into the utterance files;
  it stays a read-time federated source and reaches the shared set only via
  promotion, carried as the entry's `feedback` field.
- Agent selection is an explicit **allowlist** from the service; core's default
  filter accepts any non-empty `source` (no hard-coded blacklist).
- Service **aggregates per agent and appends once** (avoids the
  ISO-millisecond capture-file collision) and **dedupes against existing**
  entries (`append` itself does not dedupe).
- Preserve the raw `displayLog.json` path in provenance (`append` overwrites
  `sourceUri` with the captures-file path).
- Explicit displayLog **import** is the Gate C critical path; live-session
  capture is secondary.
