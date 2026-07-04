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

