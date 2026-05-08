# Soft Rollout: TypeAgent Collision Detection

## Context

The `dev/robgruen/action_collision` branch ships the full collision-detection
system (four detection points, four resolution strategies, telemetry ring
buffer, NFA-product-construction static scanner with concrete witnesses) but
**every detection point defaults to `detect: false`**. In a stock session the
runtime path is byte-identical to legacy behavior — the infrastructure is
present but never exercised. We can't tell whether collisions are rare or
endemic, whether `score-rank` differs from `first-match` in practice, or
whether `user-clarify` would help or annoy users.

This plan describes a soft rollout to the **TypeAgent dev team (3–10
people)** who **manually opt in per detection point**. Defaults stay OFF;
tester behavior is the experiment surface. Each experiment ships with
explicit success/abort criteria and a one-step rollback (config-only, no
rebuild). Telemetry feeds into the **existing DocumentDB pipeline** plus a
local JSONL fallback for offline triage.

## Current state (one-paragraph snapshot)

- **Detection points:** 3 of 4 wired and complete (`static`, `grammarMatch`,
  `llmSelect`); `fuzzy` is wired statically but the runtime hook is absent
  and the only shipped scorer is `PlaceholderScorer` which returns 0.
- **Strategies:** all 4 implemented (`first-match`, `score-rank`, `priority`,
  `user-clarify`); `pause-and-prompt` for `MultipleAction` auto-degrades.
- **Static NFA scanner:** `@grammar collisions [--json <path>]` and the
  standalone `analyze-grammar-collisions` CLI both ship. Latest scan: **103
  cross-agent collisions** across 27 schemas.
- **Config persistence:** `~/.typeagent/profiles/<profile>/sessions/<name>/data.json`
  → `settings.collision`. One-time read at session load. Hand-edit + restart
  works; no hot reload. `session.updateSettings(...)` writes back and
  reapplies in-memory.
- **Local telemetry today:** in-memory 50-event ring buffer in
  `CommandHandlerContext.collisionEvents` + `DEBUG=typeagent:dispatcher:collision`
  log lines. Not durable across session exit; no shell command surfaces it.
- **Remote telemetry already exists:** `packages/telemetry/src/logger/cosmosDBLoggerSink.ts`
  uploads to Cosmos `telemetrydb / dispatcherlogs` via `LogEvent` blobs
  (generic `eventName` + `eventData`). Gated by `@config log db on|off`,
  default OFF, env var `COSMOSDB_CONNECTION_STRING`. Auto-disables on auth
  errors. **The collision system does not yet emit into this pipeline** —
  but the extension point is one call to `logger.logEvent("collision", ...)`
  inside `emitCollisionEvent`.
- **Runtime config flip path today:** none from the shell (no `@config
  collision`). Edit JSON, restart. M1 below removes that constraint.

## Tooling milestones (gate Phase 1)

These ship before any user-facing experiment runs.

- [ ] **M1. `@config collision <point> [detect|strategy] <value>`** — runtime
      flip via `session.updateSettings`, which already persists to
      `data.json` and re-applies in-memory. Mirrors existing `@config agent`
      / `@config log db` patterns. Covers all 4 detection points + 4
      strategies + `priorityOrder` + `telemetry.emit`. Without this, every
      tester opt-in requires hand-editing JSON + restart.
      _Touches:_ [`configCommandHandlers.ts`](ts/packages/dispatcher/dispatcher/src/context/system/handlers/configCommandHandlers.ts),
      [`session.ts`](ts/packages/dispatcher/dispatcher/src/context/session.ts).

- [ ] **M2. Enrich `CollisionEvent` shape.** The existing event captures
      `kind` (detection point), `strategy`, `candidates`, `chosen`,
      `elapsedMs`, `request`, `note`, `timestamp`. For experiment analysis
      we need to add — once, before logging lands, so we don't schema-
      migrate later:
      - `firstMatchCandidate?: CollisionCandidate` — the candidate
        `first-match` would have picked. Lets every Cosmos query answer
        "did the experiment strategy pick differently than legacy?" without
        re-running anything offline.
      - `classifier?: "distinctActions" | "tiedHeuristics" | undefined` —
        only meaningful for `kind="grammarMatch"`; records which classifier
        flagged the collision.
      - `candidates[].matchedCount?`, `nonOptionalCount?`,
        `wildcardCharCount?`, `priorityRank?` — heuristic counters per
        candidate so offline analysis can recompute alternative rankings
        without replay. (Today only an optional `score` is captured.)
      - `requestId?: string` — correlation key tying multiple events from
        the same user request (e.g. a `grammarMatch` collision followed by
        a `user-clarify` follow-up event).
      - `experimentId?: string` — copy of `collision.telemetry.experimentId`
        from session config (new field). Lets testers tag a window of
        events (`E2.1-2026-05-12`) for clean attribution; defaults unset.
      - `sessionId: string` — copy of the dispatcher session name so per-
        tester analysis can filter on it without joining other tables.
      _Touches:_ [`collisionTelemetry.ts`](ts/packages/dispatcher/dispatcher/src/context/collisionTelemetry.ts)
      (type + emit), [`session.ts`](ts/packages/dispatcher/dispatcher/src/context/session.ts)
      (add `experimentId` to `CollisionConfig.telemetry`), and the four
      detection-point call sites that build `candidates` (need to pass the
      heuristic counters and `firstMatchCandidate`):
      [`matchCollision.ts`](ts/packages/dispatcher/dispatcher/src/translation/matchCollision.ts),
      [`translateRequest.ts`](ts/packages/dispatcher/dispatcher/src/translation/translateRequest.ts),
      [`appAgentManager.ts`](ts/packages/dispatcher/dispatcher/src/context/appAgentManager.ts),
      [`fuzzyCollision.ts`](ts/packages/dispatcher/dispatcher/src/translation/fuzzyCollision.ts).

- [ ] **M3. Hook `emitCollisionEvent` into the existing telemetry logger.**
      Add one call in
      [`collisionTelemetry.ts`](ts/packages/dispatcher/dispatcher/src/context/collisionTelemetry.ts):
      `logger.logEvent("collision", stamped)` alongside the existing ring-
      buffer append. Reuses the `Logger` already plumbed via
      [`commandHandlerContext.ts`](ts/packages/dispatcher/dispatcher/src/context/commandHandlerContext.ts)
      lines 369–406 (Cosmos / Mongo dual-sink, auto-fallback, batch upload).
      Gated by **the existing `dblogging` flag** (`@config log db on`)
      AND `collision.telemetry.emit`. No new database schema; events land
      in `dispatcherlogs` with `eventName: "collision"` and the enriched
      payload from M2.
      _Touches:_ [`collisionTelemetry.ts`](ts/packages/dispatcher/dispatcher/src/context/collisionTelemetry.ts).

- [ ] **M4. Per-session local JSONL append.** Same `emitCollisionEvent`
      call site also writes to
      `~/.typeagent/profiles/<profile>/sessions/<name>/collision-events.jsonl`
      so testers without DB credentials still capture data, and so we have
      a fallback if Cosmos is misconfigured. One-line append per event;
      gated by `collision.telemetry.emit`. (We don't gate on `dblogging` —
      JSONL is the always-on local record; DB upload is the optional
      uploaded copy.)
      _Touches:_ [`collisionTelemetry.ts`](ts/packages/dispatcher/dispatcher/src/context/collisionTelemetry.ts).

- [ ] **M5. `@collision events [--limit N] [--kind <point>]`** — read recent
      events from the current session's JSONL or the in-memory ring buffer.
      Lets a tester confirm in-flight that detection is firing without
      shelling out to a file. `--kind` filters to one detection point so
      you can isolate the experiment in progress.
      _Touches:_ new handler in
      [`grammarCommandHandlers.ts`](ts/packages/dispatcher/dispatcher/src/context/system/handlers/grammarCommandHandlers.ts)
      or a sibling `collisionCommandHandlers.ts`.

**Optional but recommended (not blocking):**

- An `analyze-collision-events` CLI in
  `packages/actionGrammar/src/generation/` that aggregates per-tester
  JSONL files for offline analysis. Mirrors the `analyze-grammar-collisions`
  pattern. Useful when DB access is awkward.

## Tester opt-in protocol

Defaults stay OFF. Each tester runs:

```
@config log db on                       # start uploading telemetry
@config collision telemetry emit on     # start recording collision events
@config collision <point> detect on     # opt in to one detection point
                                        # (typically `grammarMatch` or `llmSelect`)
```

To roll back at any point:

```
@config collision <point> detect off    # stop the active experiment
```

Each tester opts into **one experiment at a time** so attribution stays
clean. We don't run multiple strategy experiments concurrently on the same
tester.

## Phase 1 — Observability (no behavior change)

For each detection point, set `detect: true` and keep `strategy: "first-match"`.
Outcomes are byte-identical to legacy behavior; only telemetry changes.
Goal: establish baseline collision rates per detection point in real
traffic.

| ID    | Experiment                              | Config diff                                                                                              | Status  | Started | Notes |
| ----- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------- | ------- | ----- |
| E1.1  | `static` detection, warn-only           | `static.detect=true`, `static.strategy="warn"`, `telemetry.emit=true`, `dblogging=true`                  | planned |         |       |
| E1.2  | `grammarMatch` detection, no re-routing | `grammarMatch.detect=true`, `grammarMatch.strategy="first-match"`                                        | planned |         |       |
| E1.3  | `llmSelect` detection, no re-routing    | `llmSelect.detect=true`, `llmSelect.strategy="first-match"`                                              | planned |         |       |
| E1.4  | `fuzzy.staticEnabled` baseline          | `fuzzy.staticEnabled=true` (still `PlaceholderScorer` → vacuous; deferred until F1 lands)                | blocked |         | blocked on F1 |

**Run cadence:** sequence E1.1 → E1.2 → E1.3, ~1 week each, multiple
testers in parallel. E1.4 parked until Phase 3 / F1.

**Measurements (per experiment, queried from Cosmos):**

- Events per N user requests (collision rate per detection point)
- p50 / p99 detection-call-site latency
- Distinct schema-pairs that show up — does the runtime set match the
  static scanner's 103?
- Any user-visible failures (sanity check that `first-match` truly preserves
  legacy behavior; if not, we have a deeper bug)

**Success criteria to ship to Phase 2:** baseline rate measured, p99
latency overhead < 5ms on the cache path, zero user-visible regressions.

**Abort criteria:** any user-visible regression, telemetry overhead > 10%
of request time, Cosmos sink hitting auth-error auto-disable consistently.

**Rollback:** `@config collision <point> detect off`. Effective immediately.

## Phase 2 — Strategy A/B (behavior changes)

One detection point at a time, conservative strategy first. Each tester
pins to one strategy for the experiment week. Telemetry records the
candidates so post-hoc analysis can answer "how often did the new strategy
pick differently than `first-match` would have?" by comparing the
heuristically-first candidate against `chosen`.

| ID    | Experiment                       | Config diff                                                | Risk     | Status  |
| ----- | -------------------------------- | ---------------------------------------------------------- | -------- | ------- |
| E2.1  | `grammarMatch` → `score-rank`    | `grammarMatch.strategy="score-rank"`                       | low      | planned |
| E2.2  | `llmSelect` → `score-rank`       | `llmSelect.strategy="score-rank"`                          | low      | planned |
| E2.3  | `grammarMatch` → `priority`      | `grammarMatch.strategy="priority"`, set `priorityOrder`    | medium   | planned |
| E2.4  | `llmSelect` → `priority`         | `llmSelect.strategy="priority"`                            | medium   | planned |
| E2.5  | `grammarMatch` → `user-clarify`  | `grammarMatch.strategy="user-clarify"`                     | high     | planned |
| E2.6  | `llmSelect` → `user-clarify`     | `llmSelect.strategy="user-clarify"`                        | high     | planned |

**Risk reasoning:**

- `score-rank` is deterministic re-ranking using existing match metadata;
  no UX change beyond the picked candidate.
- `priority` requires the operator to pick a sensible ordering; surprising
  results possible if the order is wrong, but no UX disruption.
- `user-clarify` synthesizes a clarification action — visible UX, can loop
  if the user keeps selecting an ambiguous candidate (see _Cross-cutting_).

**Success criteria per experiment:** divergence from `first-match` is
measurable (≥ 5% of collision events resolve differently) AND either
(a) categorically reduces user-visible misroutes (eyeball + tester reports),
or (b) for `user-clarify`, the user reaches the right action in ≤2 round-
trips ≥80% of the time.

**Abort criteria:** misroute rate increases, clarify-loop entered (same
collision repeats within 3 round-trips), tester drops out citing friction.

**Rollback:** `@config collision <point> strategy first-match`.

## Phase 3 — Fuzzy (blocked on scorer)

Sequential; code lands before experiments run.

- [ ] **F1.** Real `ActionEmbeddingScorer` — wraps the multi-vector
      similarity engine built in **Phase 5 / S1** (see below) so the
      fuzzy detection point can call into it directly.  Replaces
      `PlaceholderScorer` as the default when `scorer: "actionEmbedding"`
      is set.  Blocked on S1.
      _Touches:_ [`fuzzyCollision.ts`](ts/packages/dispatcher/dispatcher/src/translation/fuzzyCollision.ts).
- [ ] **F2.** Wire runtime fuzzy hook — `isFuzzyCollisionForMatch()` exists
      but has zero call sites. Add the post-resolver call site in
      [`matchCollision.ts`](ts/packages/dispatcher/dispatcher/src/translation/matchCollision.ts)
      gated on `fuzzy.runtimeEnabled`.
- [ ] **F3.** Threshold calibration — current `0.85` is a placeholder. Use
      a labeled pair set of known-similar and known-dissimilar agent-action
      pairs. Sweep the threshold and measure precision/recall.
- [ ] **F4.** On-disk fuzzy matrix cache — once F1 lands, the static
      pairwise scan is non-trivial; cache the matrix in the agent cache
      directory keyed by agent-action set hash so it doesn't re-run on
      every dispatcher boot.
- [ ] **F5.** Re-run Phase 1 (E1.4) and Phase 2 ladders for `fuzzy`.

## Phase 4 — Static NFA collision triage (parallel track)

Independent of the runtime experiments. Uses the JSON output of the static
scanner.

- [ ] **T1.** Generate baseline: `analyze-grammar-collisions --dir packages/agents
      --out collisions-baseline.json`. Commit to repo as the reference set.
- [ ] **T2.** Categorize the 103 collisions:
  - **Tier 1 (real bugs, fix first):** short witness + concrete (no
    placeholders) + matched actions diverge in a way the user would notice.
  - **Tier 2 (likely false positives):** witness contains placeholder
    tokens — type-only overlap, may not actually surface at runtime.
  - **Tier 3 (deliberate / by-design):** vampire test agent, etc.
- [ ] **T3.** Tune `.agr` files for Tier 1 collisions (add disambiguating
      prefixes, narrow wildcards, etc.). Re-scan, diff JSON, confirm
      reduction.
- [ ] **T4.** CI gate: run `analyze-grammar-collisions` and `jq`-check that
      Tier 1 collision count doesn't regress past `collisions-baseline.json`.

## Phase 5 — Semantic action collision discovery (parallel track)

Surfaces collisions that the grammar / NFA path can't see — actions that
are semantically the same kind of operation (`browser.openWebPage` ⟷
`desktop.openFile` ⟷ `archives.expand`) even when their `.agr` patterns
don't overlap.  Output of this phase becomes the engine for the F1
milestone above; until S1 lands, fuzzy detection is inert.

Sequential — each milestone uses the artifacts of the previous one.

- [x] **S1. `@collision similar` — multi-vector cross-schema similarity (semantic neighborhoods).** _Demoted from "find dispatch collisions" — see findings below._  Embeds each loaded action under multiple independent vectors (desc / params / nameShape / agentContext / agentAndAction), runs pairwise scoring across cross-schema pairs under one of six named strategies, and clusters via complete-linkage agglomeration.  HTML cluster view, `--json` export, score-distribution histogram.
      _Status:_ shipped (S1 → S1.2 → `@collision probe`).
      _What it answers:_ "Which actions are the same kind of operation, regardless of agent?" — a **semantic-neighborhoods** scanner.
      _What it does NOT answer:_ "Which actions actually compete at the dispatcher's routing path?"  Validated empirically against the toggle clusters: 12 hand-crafted probes ran through `@collision probe`; 11 of 12 routed to the expected target as top-1 — the cross-agent embedding cluster was a semantic neighborhood, not a dispatch collision.  The competitors that matter are within-agent siblings, which `@collision similar` skips by design (cross-schema-only).
      _Useful for:_ surfacing naming inconsistencies, finding duplicate-purpose actions across the agent set, action-tuning candidates.  Keep as is, but stop framing it as the rollout's primary collision tool.

- [ ] **S1b. Within-schema sibling analysis.** Add `--within-schema`
      mode to `@collision similar` that runs the same multi-vector
      analysis on action pairs *within* each agent.  Per the today's-
      findings, runtime ambiguity comes from sibling pairs like
      (`ConnectWifi`, `EnableWifi`, `DisconnectWifi`) or
      (`EnableFilterKeys`, `EnableStickyKeys`).  Same engine, different
      filter; small change.

- [x] **S2. LLM-synthesized phrase corpus per action — multi-model.**
      _Done._  See findings below.

      Original spec follows for reference:
      For each loaded action, prompt **every available chat model** (via
      `aiclient.getChatModelNames()`) to generate **3 phrases each**
      using a **diversity prompt** ("one short imperative, one
      conversational/polite, one casual/abbreviated").  Multiple models
      add phrasing variance — different LLMs converge on different
      defaults; merging across models broadens the surface.  Output:
      one corpus JSON with per-phrase source attribution
      (`{schemaName, actionName, phrases: [{text, model}]}`), deduped
      by lowercased text.
      Cache key: `(modelName, actionShapeHash)` — only regenerate when
      either the model list or the action's shape changes.  Cache lives
      under the dispatcher's instance dir alongside other agent caches.
      Implementation: a `corpus-runner.mjs` script (sibling to
      `probe-runner.mjs`) that spins up a read-only dispatcher and
      drives the model calls with concurrency 8 — at ~1000 actions × 4
      models × 3 phrases, full run is ~40 min wall-clock.
      Sample first (one or two agents end-to-end), then scale.
      _Touches:_ new `packages/cli/scripts/corpus-runner.mjs`, uses
      existing model client + cache directory.

- [x] **S3. Replay the corpus through the semantic ranker.**
      _Done._  Implemented as
      [`packages/cli/scripts/probe-corpus-runner.mjs`](ts/packages/cli/scripts/probe-corpus-runner.mjs)
      (calls `agents.semanticSearchActionSchema` directly rather than going
      through `@collision probe`'s HTML output).  Reanalyzed with a
      prefix-aware matcher in
      [`reanalyze-probe-results.mjs`](ts/packages/cli/scripts/reanalyze-probe-results.mjs)
      to fold out type-name-vs-enum-name false misroutes.

      **Future work:** ship a "feed events to the JSONL/Cosmos pipeline
      with `kind: "fuzzy"`" mode so probe-corpus runs surface in
      `@collision events` and the Phase 1 Cosmos queries.  Today the
      script just writes a local JSON.

## S2/S3 calibration findings (baseline before any corrective action)

**Corpus** ([`corpus-runner.mjs`](ts/packages/cli/scripts/corpus-runner.mjs)
output, run 2026-05-07): 489 actions across 65 schemas (1 schema —
`mcpfilesystem` — failed to load and was skipped).  Three working
OpenAI-family models (`GPT_4_1`, `GPT_5`, `GPT_5_NANO`).  Each (action,
model) call asks for 3 phrases in distinct styles (imperative,
conversational, casual).  **4392 raw model outputs → 4258 unique
phrases (96.9% dedup keep-rate)** = high stylistic variance.  Run time
~25 min at concurrency 8.

`GPT_4_O` and `GPT_4_O_MINI` are broken in this checkout (stale API
version pin / wrong API key) and would add more variance once fixed.

**Probe replay** ([`probe-corpus-runner.mjs`](ts/packages/cli/scripts/probe-corpus-runner.mjs)
on the corpus, delta=0.05, top=5):

| Verdict   | Count | %      | Meaning                                                 |
| --------- | ----- | ------ | ------------------------------------------------------- |
| CLEAN     | 419   | 9.8%   | top-1 correct AND Δ to #2 ≥ 0.05                        |
| TIGHT     | 1983  | 46.6%  | top-1 correct but Δ < 0.05 (`llmSelect` would flag)     |
| MISROUTE  | 1856  | 43.6%  | top-1 wrong                                             |

**Misroute split: 55% cross-agent, 45% within-agent.**  Both buckets
are big enough to matter.

**Per-style:** terse phrasing wrecks routing.

| Style          | CLEAN | TIGHT | MISROUTE |
| -------------- | ----- | ----- | -------- |
| imperative     | 16.5% | 49.0% | 33.7%    |
| conversational | 9.6%  | 53.7% | 36.6%    |
| casual         | 5.5%  | 35.0% | 59.5%    |

**Per-source-model:** GPT_5_NANO produces the most-routable phrasings.
Probably because nano outputs are shorter and more imperative on
average — closer to the action description voice — which the ranker
can pin down.

| Model        | CLEAN | TIGHT | MISROUTE |
| ------------ | ----- | ----- | -------- |
| GPT_5_NANO   | 13.5% | 49.0% | 38.0%    |
| GPT_4_1      | 9.4%  | 45.6% | 45.5%    |
| GPT_5        | 8.9%  | 46.3% | 45.6%    |

### Five misroute patterns the data exposes

The signal isn't uniform — it concentrates in five distinct categories,
each calling for a different fix.

- **A. Cross-agent semantic hubs.**  One generic action absorbs phrases
  meant for siblings across multiple agents.  The exemplar:
  `desktop.SetVolumeAction` is the universal sink for any volume-related
  phrase generated for `player.setVolume`, `player.setMaxVolume`,
  `player.changeVolume`, `localPlayer.setVolume`, `localPlayer.changeVolume`,
  and even `desktop.AdjustVolume` (5 of the top-30 misroute edges).
  This is the canonical "open bbc" case at scale.
  _Fix candidate:_ tighten descriptions ("set system audio volume" not
  just "set volume"), or add `priorityOrder` so music agents win when
  both match.

- **B. Within-agent disambiguation hubs.**  One action absorbs phrases
  meant for siblings *inside the same agent*.  `player.PlayArtistAction`
  steals from `playTrack` (9×), `playGenre` (8×), `addSongsToPlaylist`
  (7×); `list.GetListAction` steals from `createList` (7×) and others.
  These don't show up in `@collision similar`'s output at all because
  it filters cross-schema-only — exactly the gap S1b was reframed for.
  _Fix candidate:_ tighten the hub action's description to be more
  specific; add example utterances to siblings' descriptions.

- **C. Near-duplicate agents.**  `localPlayer` (local file player) and
  `player` (Spotify) cover the same conceptual surface; phrases
  generated for one routinely route to the other.  `localPlayer.shuffle
  → player.ShuffleAction` (8×), `localPlayer.mute → desktop.MuteVolumeAction`
  (9×), several volume edges.
  _Fix candidate:_ document the agent boundary explicitly in agent
  descriptions ("local file" vs "Spotify"); or accept the collision and
  use `priorityOrder` to bias the more common case.

- **D. Engineered collisions firing as designed.**  `vampire.createCalendarEvent
  → calendar.ScheduleEventAction` (7×), `vampire.revive → player.PlayArtistAction`
  (7×).  Vampire is doing what it was designed to do — these aren't
  bugs, they're the test fixtures detecting collisions correctly.

- **E. Naming-hygiene noise.**  TypeScript type names sometimes carry
  prefixes the action description doesn't (`code.code-editor.saveAllFiles`
  → `EditorActionSaveAllFiles` ×9; similar for other `EditorAction*`
  types).  Routing is *correct* — the embedder just doesn't realize
  it because the type-name and the description don't share vocabulary.
  _Fix candidate:_ rename the types to drop the `EditorAction` prefix.
  Pure refactor, doesn't change runtime behavior.

### Cleanest actions (calibration anchors)

These set the bar for what good disambiguation looks like.  Common
pattern: distinctive vocabulary + no within-agent siblings competing.

```
desktop.Debug                                       9 CLEAN
desktop.desktop-taskbar.DisplayTaskbarOnAllMonitors 8 CLEAN
desktop.desktop-taskbar.ShowBadgesOnTaskbar         8 CLEAN
code.code-display.showOutputPanel                   8 CLEAN
desktop.desktop-personalization.ApplyColorToTitleBar 7 CLEAN
desktop.desktop-taskbar.DisplaySecondsInSystrayClock 7 CLEAN
onboarding.listIntegrations                         7 CLEAN
desktop.ListThemes                                  7 CLEAN
```

### What this means for Phase 1 / Phase 2 baseline

The 9.8% / 46.6% / 43.6% split is the **before-corrective-action
baseline** for the rollout's empirical questions.  Expectations:

- **Phase 1 / E1.3 (`llmSelect.detect=on`)**: with the current
  scoreDeltaThreshold of 0.05, 56.4% of phrases would emit a collision
  event (TIGHT + MISROUTE).  That's a high event rate; if the
  experiment ratio holds for real traffic, the JSONL/Cosmos pipeline
  will see ~1 collision per ~1.8 user requests.  Plan capacity
  accordingly.
- **Phase 2 / E2.x (strategy A/B)**: the divergence rate (chosen ≠
  `firstMatchCandidate`) under non-`first-match` strategies will be at
  least 56.4% — strategies have something to act on.  If Phase 2
  measures divergence well below that, the strategies aren't
  triggering.

- [ ] **S4. Cross-pollinate with real-world telemetry.** The collision
      events JSONL accumulating from Phase 1 has actual user requests in
      its `request` field.  Feed those through the same probe path as
      S3 to extend the synthetic corpus with real phrasing.  The
      synthetic-vs-real divergence is itself a calibration signal.

- [ ] **S5. Wire S1 as the `actionEmbedding` scorer (= F1).** Once S1's
      similarity scores are stable, replace `PlaceholderScorer` in
      [`fuzzyCollision.ts`](ts/packages/dispatcher/dispatcher/src/translation/fuzzyCollision.ts)
      with a thin adapter calling into the S1 engine.  This unblocks
      Phase 1 / E1.4 and Phase 3 / F2-F4.

## Cross-cutting items (track but don't block phases)

- [ ] **Clarify-loop bias** — when user picks an agent in response to
      `ClarifyMultipleAgentMatches`, the same collision can repeat next
      round-trip. Mitigation noted in dispatcher README. Address before
      E2.5/E2.6 if it bites.
- [ ] **`pause-and-prompt` for `MultipleAction`** — auto-degrades today.
      Address only if Phase 2 shows users frequently hit `MultipleAction` +
      `user-clarify`.
- [ ] **`@grammar collisions runtime`** — surface the `lastStaticCollisions`
      snapshot from `commandHandlerContext`. M4 (`@collision events`)
      covers the more useful per-event ring buffer.

## Cosmos query reference

Events upload to `telemetrydb` / `dispatcherlogs` with `eventName: "collision"`.
Sample queries to drive experiment analysis:

```sql
-- 1. Collision rate per (detection point, strategy) — last 7 days
SELECT c.event.kind, c.event.strategy, COUNT(1) AS events
FROM   c
WHERE  c.eventName = "collision"
  AND  c.timestamp > DateTimeAdd("dd", -7, GetCurrentDateTime())
GROUP  BY c.event.kind, c.event.strategy

-- 2. Latency distribution per detection point
SELECT c.event.kind, c.event.elapsedMs
FROM   c
WHERE  c.eventName = "collision"
  AND  c.event.kind = "grammarMatch"
  AND  c.timestamp > DateTimeAdd("dd", -7, GetCurrentDateTime())
-- Roll up p50/p99 in the analysis layer (Cosmos lacks PERCENTILE_CONT).

-- 3. Strategy divergence — how often did the chosen candidate differ from
--    what first-match would have picked?  M2's `firstMatchCandidate` field
--    makes this a one-row check per event.
SELECT
    c.event.kind,
    c.event.strategy,
    c.event.experimentId,
    SUM(
      CASE
        WHEN c.event.chosen.schemaName  = c.event.firstMatchCandidate.schemaName
         AND c.event.chosen.actionName = c.event.firstMatchCandidate.actionName
        THEN 0 ELSE 1
      END
    ) AS diverged,
    COUNT(1) AS total
FROM c
WHERE c.eventName = "collision"
  AND c.event.strategy != "first-match"
  AND c.event.chosen != null
  AND c.timestamp > DateTimeAdd("dd", -7, GetCurrentDateTime())
GROUP BY c.event.kind, c.event.strategy, c.event.experimentId

-- 4. Distinct schema-pairs surfacing in the runtime — compare against
--    analyze-grammar-collisions --out collisions-baseline.json
SELECT DISTINCT
    c.event.candidates[0].schemaName AS schemaA,
    c.event.candidates[1].schemaName AS schemaB
FROM c
WHERE c.eventName = "collision"
  AND ARRAY_LENGTH(c.event.candidates) >= 2

-- 5. Per-tester / per-experiment summary — useful for our 3–10 dev-team
--    rollout where each tester opts in via @config and may pin a different
--    strategy for the experiment week.
SELECT
    c.event.sessionId,
    c.event.experimentId,
    c.event.kind,
    c.event.strategy,
    COUNT(1) AS events
FROM c
WHERE c.eventName = "collision"
  AND c.timestamp > DateTimeAdd("dd", -14, GetCurrentDateTime())
GROUP BY c.event.sessionId, c.event.experimentId, c.event.kind, c.event.strategy

-- 6. Classifier breakdown for grammarMatch — which classifier flagged it?
--    Helps decide whether to default to distinctActions or tiedHeuristics.
SELECT c.event.classifier, COUNT(1) AS events
FROM   c
WHERE  c.eventName = "collision"
  AND  c.event.kind = "grammarMatch"
GROUP  BY c.event.classifier
```

These run in the Azure portal Cosmos Data Explorer or via the Cosmos SDK
in a small offline analysis script. No in-repo query/dashboard tooling
exists today; if cross-experiment dashboards become a recurring need,
that's a follow-up CLI.

## Experiment card template

Each experiment row above expands into a detailed card when activated. Add
the card inline to this doc under the matching row.

```
### E1.2 — grammarMatch detection, no re-routing

Hypothesis: cache-path collisions occur on >1% of natural-language requests
once detection is on; the runtime set is a subset of the agent pairs
surfaced by the static NFA scanner.

Config diff (delta from defaults):
  collision.grammarMatch.detect = true
  collision.grammarMatch.strategy = "first-match"   # no behavior change
  collision.telemetry.emit = true
  dblogging = true

What we measure (Cosmos query #1, #2):
  - count(events where kind="grammarMatch") / count(total user requests)
  - per-event: schemaA, schemaB, request, elapsedMs
  - p99 elapsedMs at the detection call site

Success criteria: rate measured, p99 < 5ms; can promote to E2.1.
Abort criteria:    user-visible regression, p99 > 50ms.

Rollback: @config collision grammarMatch detect off

Status: planned | running | complete | aborted
Started: <date>
Ended:   <date>
Result:  <one-line summary, link to Cosmos query result or JSONL>
Notes:   <surprises, follow-ups, links to events of interest>
```

## Verification (how we know each milestone landed)

- **M1 (`@config collision`):** `@config collision grammarMatch detect on`
  in a fresh shell session; verify `data.json` mutated; restart; verify
  setting persisted; verify `@config` echoes the current value back.
- **M2 (enriched event shape):** unit-test that `emitCollisionEvent`
  produces an event with all of `kind`, `strategy`, `firstMatchCandidate`,
  `classifier` (when grammarMatch), per-candidate heuristic counters,
  `requestId`, `sessionId`, and (when set) `experimentId`. Update
  `collisionTelemetry.spec.ts` to cover the new fields. Trigger from each
  of the four detection-point call sites and assert the call site
  populates the right counters.
- **M3 (DocumentDB upload):** trigger a known collision via the vampire
  test agent + a colliding utterance; verify a document with
  `eventName: "collision"` and the enriched payload appears in the
  `dispatcherlogs` collection within ~2 seconds (sink batches at 1s).
- **M4 (local JSONL):** same trigger; verify
  `collision-events.jsonl` exists in the session dir, contains a single
  line with all enriched fields populated.
- **M5 (`@collision events`):** after M3/M4, run `@collision events --limit 5`
  in the shell; verify it surfaces the events.
- **Phase 1 readiness:** all M1–M5 verified; unit tests in
  `collisionMatch.spec.ts` / `collisionTelemetry.spec.ts` still green.
- **Per-experiment:** experiment is "complete" when its card has Started,
  Ended, Result populated and the JSONL or Cosmos evidence linked.

## Critical files reference (for execution)

- Engine: [`grammarCollisionScanner.ts`](ts/packages/actionGrammar/src/grammarCollisionScanner.ts),
  [`nfaIntersection.ts`](ts/packages/actionGrammar/src/nfaIntersection.ts)
- Detection wiring: [`appAgentManager.ts`](ts/packages/dispatcher/dispatcher/src/context/appAgentManager.ts),
  [`matchCollision.ts`](ts/packages/dispatcher/dispatcher/src/translation/matchCollision.ts),
  [`translateRequest.ts`](ts/packages/dispatcher/dispatcher/src/translation/translateRequest.ts),
  [`fuzzyCollision.ts`](ts/packages/dispatcher/dispatcher/src/translation/fuzzyCollision.ts)
- Config + persistence: [`session.ts`](ts/packages/dispatcher/dispatcher/src/context/session.ts)
- Local telemetry: [`collisionTelemetry.ts`](ts/packages/dispatcher/dispatcher/src/context/collisionTelemetry.ts)
- Remote telemetry pipeline:
  [`telemetry/src/logger/cosmosDBLoggerSink.ts`](ts/packages/telemetry/src/logger/cosmosDBLoggerSink.ts),
  [`telemetry/src/logger/databaseLoggerSink.ts`](ts/packages/telemetry/src/logger/databaseLoggerSink.ts),
  [`telemetry/src/logger/logger.ts`](ts/packages/telemetry/src/logger/logger.ts);
  wired in
  [`commandHandlerContext.ts`](ts/packages/dispatcher/dispatcher/src/context/commandHandlerContext.ts)
  lines 369–406.
- Existing handlers (M1, M4 patterns): [`configCommandHandlers.ts`](ts/packages/dispatcher/dispatcher/src/context/system/handlers/configCommandHandlers.ts)
  (`@config log db` lives at lines 1590–1596),
  [`grammarCommandHandlers.ts`](ts/packages/dispatcher/dispatcher/src/context/system/handlers/grammarCommandHandlers.ts).
- Tests: [`collisionMatch.spec.ts`](ts/packages/dispatcher/dispatcher/test/collisionMatch.spec.ts),
  [`collisionFuzzy.spec.ts`](ts/packages/dispatcher/dispatcher/test/collisionFuzzy.spec.ts),
  [`collisionTelemetry.spec.ts`](ts/packages/dispatcher/dispatcher/test/collisionTelemetry.spec.ts),
  [`nfaIntersection.spec.ts`](ts/packages/actionGrammar/test/nfaIntersection.spec.ts).

## Phase 1 kick-off (immediate actions)

The plan moves into the repo as the canonical record (so testers can read
the same document, and PRs can reference experiment IDs). Proposed path:
**`ts/docs/architecture/collision-rollout.md`** — alongside the existing
`dispatcher.md` it cross-references.

First execution-mode steps after this plan is approved:

1. **Check in the plan.** Copy
   `~/.claude/plans/let-s-develop-a-plan-soft-robin.md` →
   `ts/docs/architecture/collision-rollout.md`. Cross-link from the
   "Action Collision Detection" section of the dispatcher README and the
   architecture doc's TODO bullets so it's discoverable. Commit on
   `dev/robgruen/action_collision`.
2. **M1 — `@config collision`.** Add the handler in
   `configCommandHandlers.ts` mirroring `@config log db` and
   `@config agent` patterns. Subcommands:
   - `@config collision <point> detect <on|off>`
   - `@config collision <point> strategy <name>`
   - `@config collision priority <comma,separated,agents>`
   - `@config collision telemetry [emit|debugLog|experimentId] <value>`
   - `@config collision` (no args → echo current config)
   Add unit coverage to the existing dispatcher test suite.
3. **M2 — Enrich `CollisionEvent`.** Update the type and the four
   detection-point call sites to populate `firstMatchCandidate`,
   `classifier`, per-candidate heuristic counters, `requestId`,
   `experimentId`, `sessionId`. Update `collisionTelemetry.spec.ts` to
   cover the new fields.
4. **M3 — Hook the logger.** One-line addition in `emitCollisionEvent` to
   call `logger.logEvent("collision", stamped)`; gate on `dblogging`
   AND `collision.telemetry.emit`.
5. **M4 — JSONL export.** Append every emitted event to
   `<sessionDir>/collision-events.jsonl`.
6. **M5 — `@collision events`.** New handler reading recent events from
   the ring buffer (or JSONL if buffer is empty).
7. **Validate end-to-end.** Enable vampire agent + `@config collision
   grammarMatch detect on` + `@config log db on`; trigger a known
   colliding utterance; confirm the event lands in (a) the ring buffer
   via `@collision events`, (b) the local JSONL, and (c) the
   `dispatcherlogs` Cosmos collection.
8. **E1.1.** Recruit first tester (likely the author); run E1.1 (`static`
   warn-only) for one week; record results in the experiment card.

Each numbered step is a small commit. After step 7, the platform is ready
to onboard testers and Phase 1 experiments E1.2 / E1.3 can run in
parallel across the dev team.

## Update protocol

This document is the canonical record of the rollout. As experiments run:

- Flip status in the table from `planned` → `running` → `complete` /
  `aborted`.
- Add the expanded experiment card under the row when activated; fill in
  Started, Ended, Result, Notes as it runs.
- Capture surprises in **Notes** even if the experiment "succeeds" —
  unexpected agent pairs, latency spikes, telemetry gaps. These feed the
  next experiment's hypothesis.
- If a phase produces evidence that an item in _Cross-cutting_ is biting
  (e.g. clarify-loop), promote it to a numbered experiment in the next
  phase.
- The plan is mutable. Reorder, add, drop experiments based on data.
