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

| #   | Area          | Item                                             | Priority | Recommendation                    |
| --- | ------------- | ------------------------------------------------ | -------- | --------------------------------- |
| 17  | Test coverage | Feed-driven prune via `path`-record stand-in     | P2       | Add `feedDeps` seam when needed   |
| 19  | Test coverage | Rollback-prune of REAL distinct v2 root untested | P2       | Add with feed materialize harness |
| 20  | Test coverage | source→real-`AppAgentHostApplicator` integration | P2       | Add thin smoke test               |
| 24  | Test coverage | Feed `@update <range>` re-resolve untested       | P3       | Add if installer gains DI seam    |
| 29  | Test coverage | Multi-host boot consistency                      | P2       | Add smoke-test scenario           |

---

## 1. Test coverage gaps

Most of these are "add a test when the enabling seam/harness exists." Grouped recommendations below; each links to its entry.

### 1.1 Add when a feed materialize/DI harness lands — **P2**

- **Feed-driven prune via `path`-record stand-in** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"Feed-driven prune tests stand in via `path`-record `installRoot`"_.
- **Rollback-prune of a REAL distinct v2 root** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: rollback-prune of a REAL distinct v2 root untested (path-source limit)"_.
- **Feed `@update <range>` re-resolve** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"Feed `@update <range>` building `module@range` not unit-tested"_.

**Options:** (A) add a `feedDeps`/`npmInstall` injection seam to `createDefaultInstalledAgentSource` (and/or export `pruneAgentRoot`) so a feed materialize can be mocked, then cover these together; (B) leave stand-ins (path-record `installRoot`, path-source coverage).

**Recommendation: A when the first of these is genuinely needed** — one seam unlocks all three, so batch them. Until then the stand-ins cover the safety-critical direction (v1 durability on rollback is already asserted).

### 1.2 Add thin real-wiring smoke tests — **P2**

- **source→real-`AppAgentHostApplicator` integration** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: source→real-`AppAgentHostApplicator` integration test"_.
- **Multi-host boot consistency** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"Multi-host boot consistency is smoke-test scope, not unit scope"_.

**Options:** (A) add a thin smoke test wiring the real source barrier to the real applicator, and a smoke scenario booting shell + agentServer + api against one fresh instance dir; (B) rely on the single-lock invariant pinned in `appAgentHost.spec` + per-host build/type-check.

**Recommendation: A (smoke-test pipeline).** These are integration concerns the unit suite cannot express; add them to `pipelines/azure-smoke-tests.yml` if host wiring diverges. Low urgency while the unit invariants hold.
