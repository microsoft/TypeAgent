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

### 2026-07-05 — Direct (non-drain) prune branches left unexercised

- **Milestone / gate round:** M1 / test-gap round 2 (LOW)
- **Finding / gap:** In `update`/`uninstall`, the prune runs through the `startDrain(...).then` path because startup seeds every record as an `active` entry. The `else` branches that prune directly (no active entry to drain) are not hit by the prune tests.
- **Decision:** Deferred.
- **Rationale:** Reaching an inactive-entry state at prune time requires contriving a record with no live entry, which does not occur in the normal seed→install→op flow; the branch is a trivial defensive fallback (same `pruneAgentRoot` call, best-effort). The primary drained path is fully covered. Low regression risk.
- **Follow-up:** none.

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
