# Update Coordination — Deferred Log

> Running log of gate **review findings** and **test gaps** that were deliberately
> **not addressed** during implementation of the
> [UPDATE_COORDINATION_EXECUTION_PLAN.md](./UPDATE_COORDINATION_EXECUTION_PLAN.md),
> each with an explicit rationale for declining.
>
> Distinct from [UPDATE_COORDINATION_DECISIONS_LOG.md](./UPDATE_COORDINATION_DECISIONS_LOG.md):
> that log records design-level choices **made** during implementation; this log records
> gate findings / test gaps **not addressed**.

## How to use

- Add an entry the moment you decide to decline a gate finding or leave a test gap.
- Cross-reference the milestone + gate round and the design section it relates to.
- Keep entries short and give a concrete rationale.

## Entry format

```
### YYYY-MM-DD — <short title>
- **Milestone / gate round:** M_ / (review|test-gap) round _
- **Finding / gap:** what was raised.
- **Decision:** deferred / declined.
- **Rationale:** why it is safe to not address now.
- **Follow-up:** issue link / TODO location, or "none".
```

---

## Entries

### 2025-XX-XX — Feed-driven prune tests stand in via `path`-record `installRoot`

- **Milestone / gate round:** M1 / test-gap round 1
- **Finding / gap:** A fully realistic prune-on-swap / prune-after-uninstall test would drive a real feed materialize through `createDefaultInstalledAgentSource`, but that factory does not forward a `feedDeps`/`npmInstall` seam, so a feed install cannot be mocked through the source. Only the `path` source is reachable, and its records have no `installRoot`.
- **Decision:** Deferred the seam; used a stand-in instead.
- **Rationale:** The GC prune branches are exercised by seeding a `path` record with a hand-set `installRoot` plus a real on-disk root, then running `update`/`uninstall` (`installSourcesInstalledProvider.spec.ts`: "update prunes the old version's install root after the swap", "uninstall prunes the agent's install root once drained"). Feed-level materialize + distinct-root behavior is covered directly in `installSourcesFeed.spec.ts`. Adding a `feedDeps` injection seam is production surface not needed for M1.
- **Follow-up:** If a later milestone needs end-to-end feed→update coverage, add a `feedDeps` param to `createDefaultInstalledAgentSource` (or export `pruneAgentRoot` for a direct unit test).

### 2025-XX-XX — Failed materialize leaves its partial root for the startup sweep

- **Milestone / gate round:** M1 / review round 1 (NIT)
- **Finding / gap:** When `feedSource.materialize` throws, the just-created `installDir/agents/<root>` dir survives (empty/partial) until the next startup orphan sweep, rather than being `rmSync`'d eagerly on the error path.
- **Decision:** Declined eager cleanup.
- **Rationale:** This matches the logged design intent (decisions log: "the startup orphan sweep is the backstop"). The partial root is never persisted to a record, is never resolved, and is reclaimed on next startup; eager cleanup adds an error-path branch for no correctness gain. The prior root and shared `installDir` are already proven intact by the clean-abort test.
- **Follow-up:** none.

### 2025-XX-XX — Direct (non-drain) prune branches left unexercised

- **Milestone / gate round:** M1 / test-gap round 2 (LOW)
- **Finding / gap:** In `update`/`uninstall`, the prune runs through the `startDrain(...).then` path because startup seeds every record as an `active` entry. The `else` branches that prune directly (no active entry to drain) are not hit by the prune tests.
- **Decision:** Deferred.
- **Rationale:** Reaching an inactive-entry state at prune time requires contriving a record with no live entry, which does not occur in the normal seed→install→op flow; the branch is a trivial defensive fallback (same `pruneAgentRoot` call, best-effort). The primary drained path is fully covered. Low regression risk.
- **Follow-up:** none.

### 2025-XX-XX — Sibling connecting concurrently with an in-flight drain can leak the drained agent

- **Milestone / gate round:** M2 / review round 2 (MEDIUM, PRE-EXISTING — not an M2 regression)
- **Finding / gap:** A session `S` that is mid-`connect()` can end up still hosting an agent that was uninstalled/updated by another session. `connect(S)` adds `S` to `clients` synchronously, then registers its initial providers via `await installAppProvider(...)` NOT wrapped in `S`'s `commandLock`. During that await another session's `uninstall`/`update` → `startDrain` snapshots `clients` (now includes `S`) and enqueues `S.removeProvider(X)`; `S`'s applicator can run that remove (lock is free during init) before `X` is actually registered, so `removeAgent('X')` no-ops, then init registers `X`. Net: `X` stays loaded on `S` while gone everywhere else; `reconcileKnownAgents` records it as known rather than healing it.
- **Decision:** Deferred (out of M2 scope).
- **Rationale:** The sibling fan-out enqueue predates M2; M2 only added the ISSUING session to the enqueue path, and the issuing session is fully initialized and holds its own `commandLock` for the current `@package` command, so its enqueued op runs strictly after that command — race-free. The only susceptible party is a DIFFERENT session mid-`connect()`, which existed before M2. The M3 refcount barrier + `replaceProvider` rework is the natural place to close it (init adds and fan-out removes should share one FIFO order, or the initial registration should run under the session's `commandLock`).
- **Follow-up:** Revisit during M3 (§5.6/§5.7): run `connect()`'s initial provider registration under the session's `commandLock`, or enqueue the initial adds through the same applicator so init adds and fan-out removes share one FIFO order.

### 2025-XX-XX — `dropConfig` true/false not asserted at the source (fan-out) level

- **Milestone / gate round:** M2 / test-gap round 2 (LOW)
- **Finding / gap:** The fan-out tests' `recordingHost.removeProvider` ignores its 3rd arg, so nothing at the source level pins that `uninstall` fans out `dropConfig=true` (clear each session's enable preference) while `update` fans out `dropConfig=false` (preserve it across a version bump). The applicator side is covered by `appAgentHost.spec.ts` "threads notify/dropConfig through".
- **Decision:** Deferred.
- **Rationale:** This is a Model B enable-preference behavior (M1 scope) orthogonal to M2's deadlock-freedom / exactly-once / name-leak guarantees. A regression would silently wipe/preserve a per-session preference but cannot break the coordination invariants this milestone establishes. The plumbing (`startDrain(..., dropConfig, ...)`) is a direct pass-through with no branching.
- **Follow-up:** Add a `dropConfig` capture to the fan-out `recordingHost` and assert `uninstall→true` / `update→false` when Model B config coverage is revisited.

### 2025-XX-XX — verify-0 straggler PARK branch (`getRefCount > 0`) unexercised

- **Milestone / gate round:** M3 / test-gap round 1 (HIGH, by-design limitation)
- **Finding / gap:** `maybeComplete`'s `!verifyZero` branch — all hosts quiesced
  but the shared old provider still reports a nonzero refcount, so the barrier
  parks (no `onComplete`, no coexistence) — is never hit by tests. Every fake
  host's `removeProvider` is a no-op that never loads/unloads the source's real
  provider, so `getRefCount` is always 0 and `verifyZero` trivially passes.
  Exercising the nonzero branch needs a seam to inject a controllable
  `getRefCount` (or a real in-process load) as the barrier's `oldProvider`.
- **Decision:** Deferred to M4.
- **Rationale:** The verify-0 gate itself is a 3-line explicit check reviewed
  correct in M3's correctness gate (round 1), and its refcount source is
  unit-tested directly (`npm provider refcount` in `provider.spec.ts`). In M3 a
  parked barrier is a dead-end until M4 (§5.3) adds the timeout/abort that bounds
  and recovers it — M4 must introduce a refcount/park control seam anyway, which
  is the natural home for the straggler-park test (park → timeout → rollback).
- **Follow-up:** In M4, add the injection seam and test: all hosts quiesce +
  refcount stays > 0 ⇒ barrier stays parked (entry still `removing`, name hidden,
  no v2 add, `whenReady` unresolved) until the M4 timeout fires and rolls back.

### 2025-XX-XX — Leaf-op invariant (§5.7) enforced by convention, not at runtime

- **Milestone / gate round:** M3 / review round 2 (LOW)
- **Finding / gap:** Nothing at runtime prevents `applyAdd`/`applyRemove` (the
  teardown/startup legs of a `replace` op) from reacquiring the command lock or
  dispatching a command; the leaf-op rule is a comment. Same as the pre-existing
  `addProvider`/`removeProvider` legs.
- **Decision:** Deferred (accept convention + test-side coverage).
- **Rationale:** A runtime guard (e.g. a re-entrancy flag on the command lock)
  is a cross-cutting change beyond M3's scope, and the single-slot applicator
  would self-deadlock if a leg re-acquired it — the "one command-lock section,
  no interleave" applicator test would fail loudly, so the invariant is
  effectively pinned by construction.
- **Follow-up:** Consider a re-entrancy assertion if a future leg grows a nested
  lock acquisition.

### 2025-XX-XX — Indefinite park when a straggler never releases its refcount

- **Milestone / gate round:** M3 / review round 1 (Finding C — by design)
- **Finding / gap:** If a session's old-version refcount never reaches 0 (a wedged
  unload), every other session stays parked on `whenReady` holding its command
  lock with no time bound — a whole-session freeze.
- **Decision:** Deferred to M4 (explicitly the §5.3 responsibility).
- **Rationale:** Bounding + rolling back the park is the entire purpose of M4
  (timeouts, out-of-band cancel, auto-rollback keeping v1). M3 correctly prefers
  a safe indefinite park (no coexistence) over an unsafe forced completion.
- **Follow-up:** M4 (§5.3): per-phase timeout + `abortSignal` cancel + rollback.

### 2025-XX-XX — RESOLVED: `dropConfig` true/false now asserted at the source level

- **Milestone / gate round:** M3 / test-gap round 1 (closes the M2-deferred item)
- **Resolution:** The M2 deferred item ("`dropConfig` true/false not asserted at
  the source (fan-out) level") is now covered by a source test ("threads
  dropConfig=true for uninstall and false for update to every remove leg (Model
  B)") using a dedicated recording host that captures the remove leg's 3rd arg.
- **Follow-up:** none.

### 2025-XX-XX — STILL OPEN: session connecting mid-`removing` update misses v2

- **Milestone / gate round:** M3 / review round 1 (Finding B — pre-existing)
- **Finding / gap:** `startReplace` snapshots its target set (`clients ∪ issuing`)
  at start; a session that `connect()`s AFTER that, while the entry is `removing`,
  is not a barrier target and — because update completion adds v2 only via the
  parked hosts' add-legs (no separate fan-out on completion) — never receives v2
  until it reconnects. `activeProviders()` also excludes a `removing` name, so the
  late joiner sees neither v1 nor v2. Same root as the M2-deferred connect-vs-
  drain race.
- **Decision:** Still deferred (not an M3 regression; not a no-coexistence
  violation — already-connected sessions are correct).
- **Rationale:** Closing it cleanly means unifying `connect()`'s initial
  registration and the barrier fan-out under one FIFO / the session command lock,
  a larger change than M3's teardown/swap core. M3 was scoped to the correctness
  core (one lock section + verify-0), which it delivers.
- **Follow-up:** Address in M4/M5: either run `connect()` initial registration
  under the session command lock, or have update-completion fan v2 out to any
  session that joined after `startReplace`.

### 2025-XX-XX — DEFERRED: full pre-launch `v2` startability probe

- **Milestone / gate round:** M4 / §5.3
- **Finding / gap:** The default `verifyStart` only reads `v2`'s manifest
  (`getAppAgentManifest`); it does not fork/launch `v2` to prove it actually
  starts. A `v2` that resolves its manifest but crashes on load still commits, and
  the crash surfaces later as a normal load failure (not an update rollback).
- **Decision:** Deferred. A full pre-launch probe would fork a process per update
  purely to verify startability (see decisions log).
- **Follow-up:** Optionally add an opt-in forking `verifyStart` for feed sources
  where cold-start failures are likelier; the seam already exists
  (`updateCoordination.verifyStart`).

### 2025-XX-XX — DEFERRED: user-facing cancel UX + longer-lived abort source

- **Milestone / gate round:** M4 / §4.2, §5.3 (surfaced in M4 review round 1)
- **Finding / gap:** The abort→rollback path is wired and tested with a
  caller-owned `AbortController`, but `@package update` threads
  `context.abortSignal` — the PER-COMMAND signal, which is torn down the instant
  the handler returns "update started". So today nothing can fire it once the swap
  is actually running; the API-level cancel is reachable only programmatically.
- **Decision:** Deferred (consistent with the design's §4.2 UX deferral). Source-
  side abort semantics are complete and locked by tests.
- **Follow-up:** The cancel UX must supply a LONGER-LIVED abort source — e.g. a
  registry of in-flight update controllers keyed by agent name that a future
  "cancel update" affordance aborts — rather than the per-command signal.

### 2025-XX-XX — DEFERRED: wedged-straggler `v2` install dir + phase-3 GC backstop

- **Milestone / gate round:** M4 / §5.3, §5.5 (surfaced in M4 review round 1)
- **Finding / gap:** Phase 3 (`releasing`) has no timer: a host whose add leg
  hangs forever leaves `settling` non-empty, so `finalizeGc` (the prune) never
  runs and a superseded install root lingers. The outcome is already committed and
  every reachable session is serving correctly; only the GC is skipped.
- **Decision:** Deferred — the Milestone 1 startup orphan sweep is the backstop
  (it removes any install root not referenced by the current record).
- **Follow-up:** None required; revisit only if lingering dirs prove costly.

### 2025-XX-XX — DEFERRED: verify-0 park never re-checks a self-dropping refcount

- **Milestone / gate round:** M4 / §5.6 (surfaced in M4 review round 1)
- **Finding / gap:** When all hosts have quiesced but verify-0 sees a non-zero
  shared refcount (a wedged/racing loader), the barrier parks and is resolved ONLY
  by the quiesce timeout → rollback. There is no hook that re-checks `verifyZero`
  if the refcount later drops to 0 on its own, so a legitimately-slow-to-release
  `v1` forces an unnecessary rollback.
- **Decision:** Deferred. Treating a non-zero count after every host quiesced as a
  wedged loader and rolling back on timeout is the safe M4 behavior (no unbounded
  wait, no coexistence).
- **Follow-up:** Optionally add a refcount-drop notification from the provider so
  the barrier can advance without waiting out the timeout.

### 2025-XX-XX — STILL OPEN (carried to M5): connect mid-`removing` misses `v2`

- **Milestone / gate round:** M4 (carried from M3 Finding B)
- **Finding / gap:** Unchanged from M3: a session that `connect()`s while a name
  is `removing` is not a barrier target and never receives `v2` (nor `v1`) until
  it reconnects. M4 did not change `connect()`'s registration path.
- **Decision:** Still deferred to M5 (or later): unify `connect()` initial
  registration and the barrier fan-out under one FIFO / the session command lock.
- **Follow-up:** Evaluate in M5 §6 cleanup.
