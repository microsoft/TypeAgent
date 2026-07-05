# Update Coordination — Deferred Log

> Running log of gate **review findings** and **test gaps** that were deliberately
> **not addressed** during implementation of the
> [UPDATE_COORDINATION_EXECUTION_PLAN.md](./UPDATE_COORDINATION_EXECUTION_PLAN.md),
> each with an explicit rationale for declining.
>
> Distinct from the design ([UPDATE_COORDINATION.md](./UPDATE_COORDINATION.md)), which captures the
> design-level choices **made** during implementation; this log records
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

### 2026-07-05 — Feed-driven prune tests stand in via `path`-record `installRoot`

- **Milestone / gate round:** M1 / test-gap round 1
- **Finding / gap:** A fully realistic prune-on-swap / prune-after-uninstall test would drive a real feed materialize through `createDefaultInstalledAgentSource`, but that factory does not forward a `feedDeps`/`npmInstall` seam, so a feed install cannot be mocked through the source. Only the `path` source is reachable, and its records have no `installRoot`.
- **Decision:** Deferred the seam; used a stand-in instead.
- **Rationale:** The GC prune branches are exercised by seeding a `path` record with a hand-set `installRoot` plus a real on-disk root, then running `update`/`uninstall` (`installSourcesInstalledProvider.spec.ts`: "update prunes the old version's install root after the swap", "uninstall prunes the agent's install root once drained"). Feed-level materialize + distinct-root behavior is covered directly in `installSourcesFeed.spec.ts`. Adding a `feedDeps` injection seam is production surface not needed for M1.
- **Follow-up:** If a later milestone needs end-to-end feed→update coverage, add a `feedDeps` param to `createDefaultInstalledAgentSource` (or export `pruneAgentRoot` for a direct unit test).

### 2026-07-05 — Failed materialize leaves its partial root for the startup sweep

- **Milestone / gate round:** M1 / review round 1 (NIT)
- **Finding / gap:** When `feedSource.materialize` throws, the just-created `installDir/agents/<root>` dir survives (empty/partial) until the next startup orphan sweep, rather than being `rmSync`'d eagerly on the error path.
- **Decision:** Declined eager cleanup.
- **Rationale:** This matches the logged design intent (decisions log: "the startup orphan sweep is the backstop"). The partial root is never persisted to a record, is never resolved, and is reclaimed on next startup; eager cleanup adds an error-path branch for no correctness gain. The prior root and shared `installDir` are already proven intact by the clean-abort test.
- **Follow-up:** none.

### 2026-07-05 — Direct (non-drain) prune branches left unexercised

- **Milestone / gate round:** M1 / test-gap round 2 (LOW)
- **Finding / gap:** In `update`/`uninstall`, the prune runs through the `startDrain(...).then` path because startup seeds every record as an `active` entry. The `else` branches that prune directly (no active entry to drain) are not hit by the prune tests.
- **Decision:** Deferred.
- **Rationale:** Reaching an inactive-entry state at prune time requires contriving a record with no live entry, which does not occur in the normal seed→install→op flow; the branch is a trivial defensive fallback (same `pruneAgentRoot` call, best-effort). The primary drained path is fully covered. Low regression risk.
- **Follow-up:** none.

### 2026-07-05 — Sibling connecting concurrently with an in-flight drain can leak the drained agent

- **Milestone / gate round:** M2 / review round 2 (MEDIUM, PRE-EXISTING — not an M2 regression)
- **Finding / gap:** A session `S` that is mid-`connect()` can end up still hosting an agent that was uninstalled/updated by another session. `connect(S)` adds `S` to `clients` synchronously, then registers its initial providers via `await installAppProvider(...)` NOT wrapped in `S`'s `commandLock`. During that await another session's `uninstall`/`update` → `startDrain` snapshots `clients` (now includes `S`) and enqueues `S.removeProvider(X)`; `S`'s applicator can run that remove (lock is free during init) before `X` is actually registered, so `removeAgent('X')` no-ops, then init registers `X`. Net: `X` stays loaded on `S` while gone everywhere else; `reconcileKnownAgents` records it as known rather than healing it.
- **Decision:** Deferred (out of M2 scope).
- **Rationale:** The sibling fan-out enqueue predates M2; M2 only added the ISSUING session to the enqueue path, and the issuing session is fully initialized and holds its own `commandLock` for the current `@package` command, so its enqueued op runs strictly after that command — race-free. The only susceptible party is a DIFFERENT session mid-`connect()`, which existed before M2. The M3 refcount barrier + `replaceProvider` rework is the natural place to close it (init adds and fan-out removes should share one FIFO order, or the initial registration should run under the session's `commandLock`).
- **Follow-up:** Revisit during M3 (§5.6/§5.7): run `connect()`'s initial provider registration under the session's `commandLock`, or enqueue the initial adds through the same applicator so init adds and fan-out removes share one FIFO order.

### 2026-07-05 — Leaf-op invariant (§5.7) enforced by convention, not at runtime

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

### 2026-07-05 — STILL OPEN: session connecting mid-`removing` update misses v2

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

### 2026-07-05 — DEFERRED: full pre-launch `v2` startability probe

- **Milestone / gate round:** M4 / §5.3
- **Finding / gap:** The structural check only reads `v2`'s manifest
  (`getAppAgentManifest`); it does not fork/launch `v2` to prove it actually
  starts. A `v2` that resolves its manifest but crashes on `instantiate()` still
  commits, and the crash surfaces later as a normal per-session load failure (not
  an update rollback).
- **Decision:** Deferred, and the `verifyStart` seam was REMOVED (TypeAgent never
  forks a startability probe). The cheap manifest read that used to be the default
  `verifyStart` moved forward to install/update materialize time (before the
  barrier, gated to npm-package sources via `record.module !== undefined`), so the
  common "corrupt/unresolvable `v2`" case fails without ever reaching the swap.
- **Follow-up:** If forking pre-launch verification is ever wanted, it must be
  reintroduced as an explicit, opt-in seam — the previous `updateCoordination.verifyStart`
  hook no longer exists.

### 2026-07-05 — DEFERRED: user-facing cancel UX + longer-lived abort source

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

### 2026-07-05 — DEFERRED: wedged-straggler `v2` install dir + phase-3 GC backstop

- **Milestone / gate round:** M4 / §5.3, §5.5 (surfaced in M4 review round 1)
- **Finding / gap:** Phase 3 (`releasing`) has no timer: a host whose add leg
  hangs forever leaves `settling` non-empty, so `finalizeGc` (the prune) never
  runs and a superseded install root lingers. The outcome is already committed and
  every reachable session is serving correctly; only the GC is skipped.
- **Decision:** Deferred — the Milestone 1 startup orphan sweep is the backstop
  (it removes any install root not referenced by the current record).
- **Follow-up:** None required; revisit only if lingering dirs prove costly.

### 2026-07-05 — DEFERRED: verify-0 park never re-checks a self-dropping refcount

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

### 2026-07-05 — STILL OPEN (carried to M5): connect mid-`removing` misses `v2`

- **Milestone / gate round:** M4 (carried from M3 Finding B)
- **Finding / gap:** Unchanged from M3: a session that `connect()`s while a name
  is `removing` is not a barrier target and never receives `v2` (nor `v1`) until
  it reconnects. M4 did not change `connect()`'s registration path.
- **Decision:** Still deferred to M5 (or later): unify `connect()` initial
  registration and the barrier fan-out under one FIFO / the session command lock.
- **Follow-up:** Evaluate in M5 §6 cleanup.

### 2026-07-05 — KEPT (not removed): load tombstone `withTombstone`

- **Milestone / gate round:** M5 / §6 (5.1 step 2)
- **Finding / gap:** M5 evaluated removing the load tombstone (`withTombstone`),
  which refuses `loadAppAgent` for a name while its entry is `removing`. Under the
  single lock-held barrier, each session's remove + unload are atomic under its
  own command lock, so the per-session removed-but-still-loadable race the
  tombstone originally guarded is closed.
- **Decision:** KEPT, not removed. A surviving window remains: a session that
  `connect()`s mid-`removing` is NOT a barrier target (the still-open
  connect-during-removing item), so the barrier's per-session serialization does
  not cover it. The tombstone is the cheap backstop for exactly that §7.3
  connect-during-removing case (see the code comments and the entry's
  `removing.provider` retention).
- **Follow-up:** Reconsider removing the tombstone once `connect()` initial
  registration is unified with the barrier fan-out (the connect-mid-removing
  follow-up above). Until then it stays.

### 2026-07-05 — DEFERRED: rollback-prune of a REAL distinct v2 root untested (path-source limit)

- **Milestone / gate round:** Final gate (test-gap, MEDIUM)
- **Finding / gap:** The `finalizeGc` rollback branch prunes the v2 root
  (`pruneAgentRoot(installDir, newRoot)`). Every rollback test drives the update
  through the hermetic `path` source, whose re-resolve yields `installRoot ===
undefined`, so `newRoot` is undefined and the prune is a guarded no-op — the
  branch that deletes a REAL, distinct v2 dir on rollback is never exercised.
- **Decision:** Deferred. The safety-critical direction IS covered: the
  "rolled-back update leaves v1 durable …" test now asserts the v1 install-root
  DIRECTORY survives a rollback, catching any regression that pruned `oldRoot`
  (v1) instead of `newRoot` (v2). Exercising a real v2-root prune requires a
  feed-style materializing harness (npm/registry mocking) that is disproportionate
  to a 3-line symmetric branch guarded by `pruneAgentRoot`'s own segment/empty
  checks.
- **Follow-up:** Add the distinct-root rollback-prune (and its commit mirror: v2
  kept, v1 pruned) when a feed materialize harness lands in this spec.

### 2026-07-05 — DEFERRED: source→real-`AppAgentHostApplicator` integration test

- **Milestone / gate round:** Final gate (test-gap, recommended-not-must)
- **Finding / gap:** The source lifecycle/barrier tests compose `replaceProvider`
  from a faithful fake (`withReplace`) that acquires the lock twice
  (remove+add) rather than holding ONE command-lock section. The single-lock /
  no-interleave invariant is pinned only in the applicator unit test
  (`appAgentHost.spec`). No test wires the real source barrier to the real
  `AppAgentHostApplicator`, so a regression swapping the source back to naive
  remove+add would keep all source tests green.
- **Decision:** Deferred — the documented M3 unit-split. The single-lock invariant
  fails loudly in `appAgentHost.spec` on regression; verify-0 nonzero-park is
  exercised at the source via the `refCount` seam.
- **Follow-up:** Optional thin source→real-applicator smoke test as hardening.

### 2026-07-05 — DEFERRED: `@package` async status STRINGS not asserted

- **Milestone / gate round:** Final gate (test-gap, LOW)
- **Finding / gap:** `packageAgent.spec`'s fake `actionIO.appendDisplay` discards
  output, so the user-visible status strings ("…will load/unload/reload in each
  session shortly", "update/uninstall started", the terminal outcome lines) are
  not asserted anywhere. Handler delegation, the record-write commit point, and
  the async-return boundary ARE covered.
- **Decision:** Deferred (LOW / cosmetic). The behavior behind the strings is
  covered; only the exact wording is unasserted.
- **Follow-up:** Optionally record `appendDisplay` and assert the strings.

### 2026-07-05 — TRACK (pre-existing, NOT introduced by this rework): `@update <range>` shell-injection on Windows

- **Milestone / gate round:** Final gate (security, SHOULD-FIX — pre-existing)
- **Finding / gap:** `feedSource` runs `execFile("npm", ["install", spec, …], {
shell: process.platform === "win32" })`. With `shell:true` Node does not quote
  args, and the user-supplied `@update` `range` flows unvalidated into `spec`
  (`` `${module}@${range}` ``). On Windows a crafted range could execute a shell
  command. Confirmed present at the branch base `cd48fccc9` — this rework did NOT
  introduce it, but it lives in the update flow.
- **Decision:** NOT fixed here (out of scope for the Update Coordination rework;
  the proper fix — validate `range` against a semver-range grammar and/or drop
  `shell:true` / pass npm's `.cmd` explicitly — is a separate hardening in
  `feedSource`, and naive metachar-blocking would wrongly reject valid `||` OR
  ranges). Flagged to the user.
- **Follow-up:** File a separate security hardening task for `feedSource`'s npm
  invocation on Windows.

### 2026-07-05 — DEFERRED (NITs): fake-timer rollback tests; hung-remove single-session

- **Milestone / gate round:** Final gate (NITs)
- **Finding / gap:** (a) The §5.3 timeout/rollback suite is real-timer-based
  (`settle()` = 4×`setTimeout(5)` racing injected 20 ms timeouts); deterministic
  today but wall-clock-coupled. (b) A pathologically HUNG `applyRemove` (never
  settles) leaves that one session half-removed and unrestored by rollback — the
  quiesce timer protects global liveness but not that wedged session (requires a
  dispatcher-side leaf-op bug outside this rework's contract).
- **Decision:** Deferred. (a) Prefer `jest.useFakeTimers()` +
  `advanceTimersByTimeAsync` later. (b) Informational — outside the leaf-op
  contract; the timeout backstop protects global progress.
- **Follow-up:** Optional test-harness cleanup; no code change for (b).
