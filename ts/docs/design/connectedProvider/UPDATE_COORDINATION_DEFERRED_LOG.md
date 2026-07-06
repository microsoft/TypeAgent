# Update Coordination — Deferred Log

> Running log of gate **review findings** and **test gaps** that were deliberately
> **not addressed** during implementation of the update-coordination rework,
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
