# Deferred Review — Triage & Options

> Cross-cutting triage of the **remaining open** deferred review findings / test
> gaps recorded in the three deferred logs. Each item below is grouped by area,
> restates the concern, lays out concrete options with pros/cons, and gives a
> recommendation (which option — or an explicit "do not address" with the reason).
>
> Source logs (each item links back to its exact entry by date + title):
>
> - **[agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md)** — install-source design (installer, `@source`/`@install`/`@update` handlers, feed/catalog/path sources).
> - **[connectedProvider/DEFERRED_REVIEW_LOG.md](./connectedProvider/DEFERRED_REVIEW_LOG.md)** — connected `AppAgentProvider` milestone gates.
> - **[connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md)** — update-coordination barrier / swap rework.
>
> Priorities: **P1** = should address; **P2** = worthwhile but not urgent; **P3** = leave as-is / do only if triggered.

## Summary table

| #   | Area                  | Item                                                 | Priority | Recommendation                           |
| --- | --------------------- | ---------------------------------------------------- | -------- | ---------------------------------------- |
| 6   | Concurrency/lifecycle | Load tombstone `withTombstone` kept                  | P2       | Keep (defense-in-depth; #4/#5 landed)    |
| 8   | Concurrency/lifecycle | verify-0 park never re-checks self-dropping refcount | P2       | Add refcount-drop notification (later)   |
| 9   | Concurrency/lifecycle | Wedged-straggler v2 dir + phase-3 GC backstop        | P3       | Keep (startup sweep backstop)            |
| 10  | Concurrency/lifecycle | Full pre-launch v2 startability probe                | P3       | Do not address (no forking)              |
| 11  | Concurrency/lifecycle | Failed materialize leaves partial root               | P3       | Do not address (startup sweep)           |
| 12  | Config/architecture   | `getProviderConfig` first-config singleton cache     | P3       | Do not address (single-config invariant) |
| 17  | Test coverage         | Feed-driven prune via `path`-record stand-in         | P2       | Add `feedDeps` seam when needed          |
| 18  | Test coverage         | Direct (non-drain) prune branches unexercised        | P3       | Do not address (defensive fallback)      |
| 19  | Test coverage         | Rollback-prune of REAL distinct v2 root untested     | P2       | Add with feed materialize harness        |
| 20  | Test coverage         | source→real-`AppAgentHostApplicator` integration     | P2       | Add thin smoke test                      |
| 21  | Test coverage         | `@package` async status STRINGS not asserted         | P3       | Optional string assertions               |
| 22  | Test coverage         | Fake-timer rollback tests (NIT)                      | P3       | Optional harness cleanup                 |
| 23  | Test coverage         | execMode propagation end-to-end                      | P3       | Add if execMode routing changes          |
| 24  | Test coverage         | Feed `@update <range>` re-resolve untested           | P3       | Add if installer gains DI seam           |
| 25  | Test coverage         | Catalog renamed-install re-lookup end-to-end         | P3       | Do not address (covered indirectly)      |
| 26  | Test coverage         | `UpdateCommandHandler` happy-path call order         | P3       | Do not address (covered e2e)             |
| 27  | Test coverage         | `@source add` duplicate-name error path              | P3       | Do not address (registry-owned)          |
| 28  | Test coverage         | `agent-keyword` policy rule fixture test             | P3       | Add if a scripts test harness lands      |
| 29  | Test coverage         | Multi-host boot consistency                          | P2       | Add smoke-test scenario                  |

---

## 1. Concurrency, lifecycle & GC

### 1.3 Load tombstone `withTombstone` kept — **P2, keep for now**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"KEPT (not removed): load tombstone `withTombstone`"_.

The tombstone refuses `loadAppAgent` for a name while its entry is `removing`. Under the single lock-held barrier, each session's remove+unload are atomic, so the original per-session race is closed. The connect-mid-`removing` races it originally backstopped are now themselves fixed (a late joiner is enrolled on the in-flight barrier and receives the decided version on completion, and `connect()`'s initial registration runs under the session command lock), so the tombstone is retained purely as defense-in-depth for the load path.

**Options**

- **A. Keep the tombstone.** Pros: cheap defense-in-depth for the `loadAppAgent` path even though the connect-mid-`removing` races are closed. Cons: a little extra state that looks redundant once you assume the barrier + late-joiner fan-out cover everything.
- **B. Remove it now.** Pros: less code. Cons: removes the redundant backstop on the load path.

**Recommendation: A (keep).** The connect-mid-`removing` races are fixed, but the tombstone's `removing.provider` retention is cheap and keeps the load path defensively guarded; reconsider removing it only if that redundancy proves unnecessary.

### 1.4 verify-0 park never re-checks a self-dropping refcount — **P2, later enhancement**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: verify-0 park never re-checks a self-dropping refcount"_.

When all hosts quiesce but verify-0 sees a non-zero shared refcount, the barrier parks and is resolved only by the quiesce timeout → rollback (or, today, by a re-poll on a host **disconnect**). A refcount that drops to 0 on its own — with no disconnect event — forces an unnecessary rollback.

**Options**

- **A. Keep timeout/disconnect-only re-poll.** Pros: safe (bounded, no coexistence); already covers the realistic disconnect case. Cons: a legitimately slow-to-release v1 can be rolled back needlessly.
- **B. Add a refcount-drop notification from the provider that re-polls `verifyZero`.**
  - Pros: barrier advances the instant the straggler releases; avoids the needless rollback.
  - Cons: new provider→barrier callback; must be idempotent and not re-open coexistence.

**Recommendation: A now, B later.** The rollback-on-timeout is safe and correct; add the notification as an optimization if slow-release stragglers prove to cause visible unnecessary rollbacks in practice.

### 1.5 Wedged-straggler v2 install dir + phase-3 GC backstop — **P3, do not address**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: wedged-straggler `v2` install dir + phase-3 GC backstop"_.

Phase 3 (`releasing`) has no timer; a host whose add leg hangs forever leaves `settling` non-empty, so `finalizeGc` never runs and a superseded install root lingers. The outcome is already committed and every reachable session serves correctly — only the GC is skipped.

**Options**

- **A. Leave as-is.** Pros: the Milestone-1 startup orphan sweep already removes any root not referenced by the current record. Cons: a lingering dir until next startup.
- **B. Add a phase-3 timer that forces `finalizeGc`.** Pros: eager cleanup. Cons: a timer + forced-GC path for a purely cosmetic disk-space concern.

**Recommendation: A (do not address).** The startup sweep is the backstop; revisit only if lingering dirs prove costly.

### 1.6 Full pre-launch v2 startability probe — **P3, do not address**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: full pre-launch `v2` startability probe"_.

The structural check only reads v2's manifest; it does not fork/launch v2 to prove it starts. A v2 that resolves its manifest but crashes on `instantiate()` still commits, surfacing later as a normal per-session load failure.

**Options**

- **A. Keep manifest-read only (no fork).** Pros: TypeAgent never forks a startability probe; the cheap manifest read already runs at materialize time (before the barrier) so corrupt/unresolvable v2 fails early. Cons: a manifest-valid-but-crashes-on-instantiate v2 still commits.
- **B. Reintroduce an opt-in forking `verifyStart` seam.** Pros: catches instantiate-time crashes before commit. Cons: forking a probe is heavy and was deliberately removed; must be explicit/opt-in.

**Recommendation: A (do not address).** Only reintroduce B as an explicit opt-in seam if instantiate-time-only failures become a real operational problem.

### 1.7 Failed materialize leaves its partial root for the startup sweep — **P3, do not address**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"Failed materialize leaves its partial root for the startup sweep"_.

When `feedSource.materialize` throws, the just-created `installDir/agents/<root>` dir survives until the next startup orphan sweep.

**Options**

- **A. Leave as-is.** Pros: matches design intent (startup sweep is the backstop); the partial root is never recorded/resolved. Cons: a transient partial dir until next startup.
- **B. `rmSync` eagerly on the error path.** Pros: no partial dir. Cons: adds an error-path branch for no correctness gain.

**Recommendation: A (do not address).** Consistent with 1.5 — the startup sweep reclaims it.

---

## 2. Configuration & architecture

### 2.1 `getProviderConfig` first-config singleton cache — **P3, do not address**

Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"`getProviderConfig` first-config singleton cache"_.

`getProviderConfig(configName?)` caches the first config it loads and ignores later `configName` args.

**Options**

- **A. Keep the singleton.** Pros: correct for TypeAgent's single-config-per-process model; no-arg callers (mcp, constructions, indexing) read the active named config. Cons: wrong if a process ever mixes named configs.
- **B. Per-name `Map` cache.** Pros: supports multi-config-per-process. Cons: regresses no-arg callers (an unrelated no-arg call could pin the default), for a scenario that does not exist today.

**Recommendation: A (do not address).** Revisit only if multi-config-per-process is ever introduced.

---

## 3. Test coverage gaps

Most of these are "add a test when the enabling seam/harness exists." Grouped recommendations below; each links to its entry.

### 3.1 Add when a feed materialize/DI harness lands — **P2**

- **Feed-driven prune via `path`-record stand-in** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"Feed-driven prune tests stand in via `path`-record `installRoot`"_.
- **Rollback-prune of a REAL distinct v2 root** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: rollback-prune of a REAL distinct v2 root untested (path-source limit)"_.
- **Feed `@update <range>` re-resolve** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"Feed `@update <range>` building `module@range` not unit-tested"_.

**Options:** (A) add a `feedDeps`/`npmInstall` injection seam to `createDefaultInstalledAgentSource` (and/or export `pruneAgentRoot`) so a feed materialize can be mocked, then cover these together; (B) leave stand-ins (path-record `installRoot`, path-source coverage).

**Recommendation: A when the first of these is genuinely needed** — one seam unlocks all three, so batch them. Until then the stand-ins cover the safety-critical direction (v1 durability on rollback is already asserted).

### 3.2 Add thin real-wiring smoke tests — **P2**

- **source→real-`AppAgentHostApplicator` integration** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: source→real-`AppAgentHostApplicator` integration test"_.
- **Multi-host boot consistency** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"Multi-host boot consistency is smoke-test scope, not unit scope"_.

**Options:** (A) add a thin smoke test wiring the real source barrier to the real applicator, and a smoke scenario booting shell + agentServer + api against one fresh instance dir; (B) rely on the single-lock invariant pinned in `appAgentHost.spec` + per-host build/type-check.

**Recommendation: A (smoke-test pipeline).** These are integration concerns the unit suite cannot express; add them to `pipelines/azure-smoke-tests.yml` if host wiring diverges. Low urgency while the unit invariants hold.

### 3.3 Optional low-value assertions — **P3, do only if cheap**

- **`@package` async status STRINGS** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: `@package` async status STRINGS not asserted"_. Record `appendDisplay` and assert wording. Behavior behind the strings is already covered; only exact wording is unasserted.
- **Fake-timer rollback tests (NIT)** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED (NITs): fake-timer rollback tests; hung-remove single-session"_. Prefer `jest.useFakeTimers()` + `advanceTimersByTimeAsync` over real-timer racing.
- **`agent-keyword` policy rule fixture test** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"No isolated unit test for the `agent-keyword` policy rule"_. Add a positive/negative fixture test if a `ts/tools/scripts` test harness is ever introduced.

**Recommendation: leave as-is; add opportunistically.** None changes behavior coverage; the full-repo `check:policy` run and the existing behavior tests already guard the real logic.

### 3.4 Do not address (covered indirectly / defensive) — **P3**

- **Direct (non-drain) prune branches unexercised** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"Direct (non-drain) prune branches left unexercised"_. The `else` branch is a trivial defensive fallback (same `pruneAgentRoot` call) not reachable in the normal seed→install→op flow; the primary drained path is fully covered.
- **execMode propagation end-to-end** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"execMode propagation through installed records not asserted end-to-end"_. `recordToNpmInfo` mapping is unit-covered and `createNpmAppAgentProvider`'s execMode handling is pre-existing/separately tested; add a fixture load test only if execMode routing changes.
- **Catalog renamed-install re-lookup end-to-end** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"Catalog renamed-install re-lookup not covered end-to-end"_. The `ref`-preservation logic is locked in by the path-source unit test; add a fixture only if catalog re-lookup logic changes.
- **`UpdateCommandHandler` happy-path call order** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"`UpdateCommandHandler` happy-path call order not unit-tested"_. The three-call sequence is exercised end-to-end by the installer + `@install` tests; an isolated mock fights a TDZ module cycle for little value.
- **`@source add` duplicate-name error path** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"`@source add` duplicate-name error path not unit-tested"_. The duplicate guard is the registry's responsibility and is covered by the registry's own tests; the handler only propagates.

**Recommendation: do not address.** Each is either a defensive fallback or already covered indirectly, and adding coverage would require disproportionate harness/fixture work.
