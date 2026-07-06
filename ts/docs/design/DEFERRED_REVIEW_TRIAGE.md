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
| 8   | Concurrency/lifecycle | verify-0 park never re-checks self-dropping refcount | P2       | Add refcount-drop notification (later)   |
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

### 1.4 verify-0 park never re-checks a self-dropping refcount — **P2, later enhancement**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: verify-0 park never re-checks a self-dropping refcount"_.

When all hosts quiesce but verify-0 sees a non-zero shared refcount, the barrier parks and is resolved only by the quiesce timeout → rollback (or, today, by a re-poll on a host **disconnect**). A refcount that drops to 0 on its own — with no disconnect event — forces an unnecessary rollback.

**Options**

- **A. Keep timeout/disconnect-only re-poll.** Pros: safe (bounded, no coexistence); already covers the realistic disconnect case. Cons: a legitimately slow-to-release v1 can be rolled back needlessly.
- **B. Add a refcount-drop notification from the provider that re-polls `verifyZero`.**
  - Pros: barrier advances the instant the straggler releases; avoids the needless rollback.
  - Cons: new provider→barrier callback; must be idempotent and not re-open coexistence.

**Recommendation: A now, B later.** The rollback-on-timeout is safe and correct; add the notification as an optimization if slow-release stragglers prove to cause visible unnecessary rollbacks in practice.

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
