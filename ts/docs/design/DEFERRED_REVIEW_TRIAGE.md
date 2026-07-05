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

| #   | Area                  | Item                                                             | Priority | Recommendation                                  |
| --- | --------------------- | ---------------------------------------------------------------- | -------- | ----------------------------------------------- |
| 2   | Security              | Feed cache file symlink safety                                   | P3       | Do not address (optional `lstat` guard)         |
| 3   | Security              | Transient npm auth file mode on Windows                          | P3       | Do not address                                  |
| 4   | Concurrency/lifecycle | Sibling connecting concurrently with in-flight drain leaks agent | **P1**   | Fix with #5 (connect under lock)                |
| 5   | Concurrency/lifecycle | Session connecting mid-`removing` misses v2                      | **P1**   | Fix — unify connect registration with barrier   |
| 6   | Concurrency/lifecycle | Load tombstone `withTombstone` kept                              | P2       | Keep until #5 lands, then reconsider            |
| 7   | Concurrency/lifecycle | Leaf-op invariant enforced by convention                         | P3       | Keep convention (optional assertion)            |
| 8   | Concurrency/lifecycle | verify-0 park never re-checks self-dropping refcount             | P2       | Add refcount-drop notification (later)          |
| 9   | Concurrency/lifecycle | Wedged-straggler v2 dir + phase-3 GC backstop                    | P3       | Keep (startup sweep backstop)                   |
| 10  | Concurrency/lifecycle | Full pre-launch v2 startability probe                            | P3       | Do not address (no forking)                     |
| 11  | Concurrency/lifecycle | Failed materialize leaves partial root                           | P3       | Do not address (startup sweep)                  |
| 12  | Config/architecture   | `getProviderConfig` first-config singleton cache                 | P3       | Do not address (single-config invariant)        |
| 13  | Config/architecture   | Indexing registry skips non-builtin agents                       | P2       | Evaluate: consult installed records             |
| 14  | Config/architecture   | Source config fail-fast validation                               | P3       | Keep graceful degrade (optional doctor cmd)     |
| 15  | Tooling/policy        | `agent-keyword` autofix needs 2nd `--fix` pass                   | P3       | Optional in-rule sort                           |
| 16  | UX                    | Update cancel UX + longer-lived abort source                     | P2       | Build abort registry when update UX prioritized |
| 17  | Test coverage         | Feed-driven prune via `path`-record stand-in                     | P2       | Add `feedDeps` seam when needed                 |
| 18  | Test coverage         | Direct (non-drain) prune branches unexercised                    | P3       | Do not address (defensive fallback)             |
| 19  | Test coverage         | Rollback-prune of REAL distinct v2 root untested                 | P2       | Add with feed materialize harness               |
| 20  | Test coverage         | source→real-`AppAgentHostApplicator` integration                 | P2       | Add thin smoke test                             |
| 21  | Test coverage         | `@package` async status STRINGS not asserted                     | P3       | Optional string assertions                      |
| 22  | Test coverage         | Fake-timer rollback tests (NIT)                                  | P3       | Optional harness cleanup                        |
| 23  | Test coverage         | execMode propagation end-to-end                                  | P3       | Add if execMode routing changes                 |
| 24  | Test coverage         | Feed `@update <range>` re-resolve untested                       | P3       | Add if installer gains DI seam                  |
| 25  | Test coverage         | Catalog renamed-install re-lookup end-to-end                     | P3       | Do not address (covered indirectly)             |
| 26  | Test coverage         | `UpdateCommandHandler` happy-path call order                     | P3       | Do not address (covered e2e)                    |
| 27  | Test coverage         | `@source add` duplicate-name error path                          | P3       | Do not address (registry-owned)                 |
| 28  | Test coverage         | `agent-keyword` policy rule fixture test                         | P3       | Add if a scripts test harness lands             |
| 29  | Test coverage         | Multi-host boot consistency                                      | P2       | Add smoke-test scenario                         |
| 30  | Code hygiene          | `displayResult` not awaited in handlers                          | P3       | Do not address (matches pattern)                |
| 31  | Code hygiene          | connectedProvider M1 cosmetic nits                               | P3       | Do not address (cosmetic)                       |

---

## 1. Security & hardening

### 1.2 Feed cache file symlink safety — **P3, do not address**

Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"Feed cache file symlink safety"_.

`writeDiskCache` overwrites the cache path without symlink checks.

**Options**

- **A. Leave as-is.** Pros: no churn. Cons: theoretical symlink pre-placement.
- **B. `lstat` + refuse-if-symlink (or `O_NOFOLLOW`) before write.** Pros: closes the theoretical hole cheaply. Cons: extra syscall + platform nuance for negligible threat.

**Recommendation: A (do not address).** Write access to the per-user `installDir` already implies control of the whole agent install tree — a far larger capability — and the only content written is benign public package-name JSON. If a hardening sweep of `installDir` writes ever happens, fold in option B then.

### 1.3 Transient npm auth file mode on Windows — **P3, do not address**

Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"Transient npm auth file mode on Windows"_.

`{ mode: 0o600 }` on the transient `.npmrc` is not enforced the same way on Windows (ACL-based).

**Options**

- **A. Leave as-is.** Pros: none needed. Cons: none material.
- **B. Set an explicit Windows ACL on the temp file.** Pros: symmetry with POSIX. Cons: platform-specific ACL code for a sub-second file.

**Recommendation: A (do not address).** The file lives in a freshly `mkdtemp`'d dir under the per-user `os.tmpdir()` (ACL-isolated by default on Windows) and is removed in a `finally`. Not worth platform-specific ACL code.

---

## 2. Concurrency, lifecycle & GC

### 2.1 Sibling connecting concurrently with an in-flight drain leaks the drained agent — **P1, FIX (with 2.2)**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"Sibling connecting concurrently with an in-flight drain can leak the drained agent"_.

A session `S` mid-`connect()` adds itself to `clients` synchronously, then registers initial providers via `await installAppProvider(...)` **not** under `S`'s `commandLock`. Another session's drain can enqueue `S.removeProvider(X)` that runs before `X` is registered (no-op), then init registers `X` — leaving `X` loaded on `S` while gone everywhere else.

**Options**

- **A. Run `connect()`'s initial provider registration under the session `commandLock`.**
  - Pros: initial adds and fan-out removes serialize in one order; closes the race directly; same mechanism the rest of the system already relies on.
  - Cons: initial connect now contends the command lock (slightly slower cold connect).
- **B. Enqueue the initial adds through the same applicator FIFO as fan-out ops.**
  - Pros: one FIFO order for init-adds and fan-out-removes; no lock contention on connect.
  - Cons: larger plumbing change; initial registration becomes async-ordered rather than inline.
- **C. Leave as-is.** Pros: none. Cons: a real (if narrow) cross-session leak that `reconcileKnownAgents` records rather than heals.

**Recommendation: A (or B), fixed together with 2.2** — both share the same root cause (initial connect registration is not ordered against the barrier fan-out). Prefer **A** for the smallest, most local change; choose **B** if cold-connect latency under the command lock proves a problem.

### 2.2 Session connecting mid-`removing` misses v2 — **P1, FIX**

Refs: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"STILL OPEN: session connecting mid-`removing` update misses v2"_ and _"STILL OPEN (carried to M5): connect mid-`removing` misses `v2`"_ (same issue, carried forward).

`startReplace` snapshots its target set at start. A session that `connect()`s after that, while the entry is `removing`, is not a barrier target and never receives v2 (nor v1) until it reconnects; `activeProviders()` also hides a `removing` name from the late joiner.

**Options**

- **A. Unify `connect()` initial registration with the barrier fan-out (same fix as 2.1-A/B).**
  - Pros: one mechanism fixes both leaks; late joiner participates in the barrier or is registered after commit consistently.
  - Cons: touches the connect path + barrier target set.
- **B. On update completion, fan v2 out to any session that joined after `startReplace`.**
  - Pros: narrower; only the completion path changes.
  - Cons: needs a "joined-after" set + a second fan-out; two code paths add v2 (parked add-legs + late fan-out), more states to reason about.
- **C. Leave as-is + rely on the load tombstone (2.3).**
  - Pros: no code change. Cons: late joiner is simply missing the agent until reconnect — a correctness/UX gap.

**Recommendation: A.** Fold this into the same connect-under-lock / shared-FIFO rework as 2.1 so the two related races are closed by one change. Once landed, revisit the tombstone (2.3).

### 2.3 Load tombstone `withTombstone` kept — **P2, keep for now**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"KEPT (not removed): load tombstone `withTombstone`"_.

The tombstone refuses `loadAppAgent` for a name while its entry is `removing`. Under the single lock-held barrier, each session's remove+unload are atomic, so the original per-session race is closed — but a session that `connect()`s mid-`removing` is still not a barrier target, and the tombstone is the cheap backstop for exactly that window.

**Options**

- **A. Keep the tombstone.** Pros: cheap backstop for the still-open connect-mid-`removing` case (2.2). Cons: a little extra state that looks redundant once you assume the barrier covers everything.
- **B. Remove it now.** Pros: less code. Cons: reopens the connect-mid-`removing` load race until 2.2 is fixed.

**Recommendation: A (keep).** Remove only after 2.2 lands and the barrier provably covers late joiners; the tombstone's `removing.provider` retention is the reason the backstop works today.

### 2.4 Leaf-op invariant enforced by convention, not at runtime — **P3, keep convention**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"Leaf-op invariant (§5.7) enforced by convention, not at runtime"_.

Nothing at runtime prevents `applyAdd`/`applyRemove` from reacquiring the command lock or dispatching; the leaf-op rule is a comment.

**Options**

- **A. Keep as convention.** Pros: the single-slot applicator self-deadlocks if a leg re-acquires the lock, so the "one command-lock section, no interleave" test fails loudly — the invariant is effectively pinned by construction. Cons: no explicit guard.
- **B. Add a re-entrancy assertion flag on the command lock.** Pros: turns a deadlock into a clear thrown error. Cons: cross-cutting change beyond this area's scope.

**Recommendation: A (keep convention).** Add option B only if a future leg grows a nested lock acquisition.

### 2.5 verify-0 park never re-checks a self-dropping refcount — **P2, later enhancement**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: verify-0 park never re-checks a self-dropping refcount"_.

When all hosts quiesce but verify-0 sees a non-zero shared refcount, the barrier parks and is resolved only by the quiesce timeout → rollback (or, today, by a re-poll on a host **disconnect**). A refcount that drops to 0 on its own — with no disconnect event — forces an unnecessary rollback.

**Options**

- **A. Keep timeout/disconnect-only re-poll.** Pros: safe (bounded, no coexistence); already covers the realistic disconnect case. Cons: a legitimately slow-to-release v1 can be rolled back needlessly.
- **B. Add a refcount-drop notification from the provider that re-polls `verifyZero`.**
  - Pros: barrier advances the instant the straggler releases; avoids the needless rollback.
  - Cons: new provider→barrier callback; must be idempotent and not re-open coexistence.

**Recommendation: A now, B later.** The rollback-on-timeout is safe and correct; add the notification as an optimization if slow-release stragglers prove to cause visible unnecessary rollbacks in practice.

### 2.6 Wedged-straggler v2 install dir + phase-3 GC backstop — **P3, do not address**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: wedged-straggler `v2` install dir + phase-3 GC backstop"_.

Phase 3 (`releasing`) has no timer; a host whose add leg hangs forever leaves `settling` non-empty, so `finalizeGc` never runs and a superseded install root lingers. The outcome is already committed and every reachable session serves correctly — only the GC is skipped.

**Options**

- **A. Leave as-is.** Pros: the Milestone-1 startup orphan sweep already removes any root not referenced by the current record. Cons: a lingering dir until next startup.
- **B. Add a phase-3 timer that forces `finalizeGc`.** Pros: eager cleanup. Cons: a timer + forced-GC path for a purely cosmetic disk-space concern.

**Recommendation: A (do not address).** The startup sweep is the backstop; revisit only if lingering dirs prove costly.

### 2.7 Full pre-launch v2 startability probe — **P3, do not address**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: full pre-launch `v2` startability probe"_.

The structural check only reads v2's manifest; it does not fork/launch v2 to prove it starts. A v2 that resolves its manifest but crashes on `instantiate()` still commits, surfacing later as a normal per-session load failure.

**Options**

- **A. Keep manifest-read only (no fork).** Pros: TypeAgent never forks a startability probe; the cheap manifest read already runs at materialize time (before the barrier) so corrupt/unresolvable v2 fails early. Cons: a manifest-valid-but-crashes-on-instantiate v2 still commits.
- **B. Reintroduce an opt-in forking `verifyStart` seam.** Pros: catches instantiate-time crashes before commit. Cons: forking a probe is heavy and was deliberately removed; must be explicit/opt-in.

**Recommendation: A (do not address).** Only reintroduce B as an explicit opt-in seam if instantiate-time-only failures become a real operational problem.

### 2.8 Failed materialize leaves its partial root for the startup sweep — **P3, do not address**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"Failed materialize leaves its partial root for the startup sweep"_.

When `feedSource.materialize` throws, the just-created `installDir/agents/<root>` dir survives until the next startup orphan sweep.

**Options**

- **A. Leave as-is.** Pros: matches design intent (startup sweep is the backstop); the partial root is never recorded/resolved. Cons: a transient partial dir until next startup.
- **B. `rmSync` eagerly on the error path.** Pros: no partial dir. Cons: adds an error-path branch for no correctness gain.

**Recommendation: A (do not address).** Consistent with 2.6 — the startup sweep reclaims it.

---

## 3. Configuration & architecture

### 3.1 `getProviderConfig` first-config singleton cache — **P3, do not address**

Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"`getProviderConfig` first-config singleton cache"_.

`getProviderConfig(configName?)` caches the first config it loads and ignores later `configName` args.

**Options**

- **A. Keep the singleton.** Pros: correct for TypeAgent's single-config-per-process model; no-arg callers (mcp, constructions, indexing) read the active named config. Cons: wrong if a process ever mixes named configs.
- **B. Per-name `Map` cache.** Pros: supports multi-config-per-process. Cons: regresses no-arg callers (an unrelated no-arg call could pin the default), for a scenario that does not exist today.

**Recommendation: A (do not address).** Revisit only if multi-config-per-process is ever introduced.

### 3.2 Indexing registry skips non-builtin (feed/path) agents — **P2, evaluate**

Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"Indexing registry skips non-builtin (feed/path) agents"_.

`getIndexingServiceRegistry` resolves indexing services from the config `agents` map (builtins). Feed/path-installed agents are absent and warn-skipped, so they cannot register an indexing service.

**Options**

- **A. Keep builtin-only.** Pros: matches current capability (indexing is builtin-only); the `config.json` `agents` map is the authoritative builtin list. Cons: an installed agent can never provide an indexing service.
- **B. Make the indexing registry consult installed records too.** Pros: installed agents become first-class for indexing. Cons: requires deciding lifecycle (what happens on uninstall/update of an indexing agent) and trusting third-party indexing services.

**Recommendation: Evaluate, leaning B.** This is a product decision: do we want installed (non-builtin) agents to offer indexing services? If yes, extend the registry to consult installed records with clear uninstall/update semantics. If indexing stays a first-party capability, keep A and document it as intentional.

### 3.3 Source config fail-fast validation (path/catalog readability) — **P3, keep graceful degrade**

Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"Source config fail-fast validation (path/catalog readability)"_.

`createPathSource` / `createCatalogSource` do not verify `baseDir` / catalog readability at construction; errors surface on first `find()`.

**Options**

- **A. Keep lazy/graceful degradation.** Pros: one bad config entry does not turn into a startup failure; `find()` already degrades (catalog → non-match + debug log; path → stat miss), which is more robust for the ordered walk. Cons: a misconfigured source fails silently until used.
- **B. Fail fast at construction.** Pros: surfaces bad config immediately. Cons: sources are constructed eagerly for every configured source, including ones never used in a given resolve — a single bad entry becomes a startup failure.
- **C. Add a `@source doctor`/validate command.** Pros: opt-in validation without changing startup behavior. Cons: new command to build/maintain.

**Recommendation: A, with C as an optional add.** Keep graceful degradation as the default; offer an explicit validate command if users need to diagnose misconfigured sources.

---

## 4. Tooling & policy checks

### 4.1 `agent-keyword` autofix needs a second `--fix` pass to sort — **P3, optional in-rule sort**

Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"`agent-keyword` autofix needs a second `--fix` pass to sort"_.

`sort-package-json` runs before `agent-keyword` in the same pass, so a freshly auto-added `keywords` field is left unsorted until the next `--fix` pass. CI runs `check:policy` without `--fix`, so enforcement is unaffected.

**Options**

- **A. Leave as-is.** Pros: only affects `--fix` ergonomics, not enforcement; all committed agent `package.json` files are already sorted. Cons: a one-off double-pass for a human running `--fix`.
- **B. Sort the `keywords` array inside the rule when it adds the keyword.** Pros: single-pass `--fix` idempotence. Cons: minor duplication of sort logic in the rule.
- **C. Reorder the rule list so `agent-keyword` runs before `sort-package-json`.** Pros: single-pass fix. Cons: couples the rule ordering to `sort-package-json` for no enforcement gain.

**Recommendation: A, or B if cheap.** Enforcement is already correct; sort inside the rule (B) only if single-pass `--fix` ergonomics are worth the tiny duplication. Avoid C (ordering coupling).

---

## 5. UX

### 5.1 Update cancel UX + longer-lived abort source — **P2, build when update UX is prioritized**

Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: user-facing cancel UX + longer-lived abort source"_.

The abort→rollback path is wired and tested with a caller-owned `AbortController`, but `@package update` threads `context.abortSignal` — the per-command signal, torn down the instant the handler returns "update started". So nothing can fire it once the swap is running; cancel is reachable only programmatically.

**Options**

- **A. Build a registry of in-flight update controllers keyed by agent name + a "cancel update" affordance.**
  - Pros: gives users a real cancel; source-side abort semantics are already complete and tested, so this is UI + a controller registry.
  - Cons: new longer-lived state (must be cleaned up on completion/rollback) and a new command/affordance.
- **B. Leave cancel programmatic-only.** Pros: no work. Cons: no user-facing cancel for a potentially long swap.

**Recommendation: A, when update UX is prioritized.** The hard part (abort semantics) is done; this is a bounded UI + controller-registry task. Until then, document that cancel is programmatic-only.

---

## 6. Test coverage gaps

Most of these are "add a test when the enabling seam/harness exists." Grouped recommendations below; each links to its entry.

### 6.1 Add when a feed materialize/DI harness lands — **P2**

- **Feed-driven prune via `path`-record stand-in** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"Feed-driven prune tests stand in via `path`-record `installRoot`"_.
- **Rollback-prune of a REAL distinct v2 root** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: rollback-prune of a REAL distinct v2 root untested (path-source limit)"_.
- **Feed `@update <range>` re-resolve** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"Feed `@update <range>` building `module@range` not unit-tested"_.

**Options:** (A) add a `feedDeps`/`npmInstall` injection seam to `createDefaultInstalledAgentSource` (and/or export `pruneAgentRoot`) so a feed materialize can be mocked, then cover these together; (B) leave stand-ins (path-record `installRoot`, path-source coverage).

**Recommendation: A when the first of these is genuinely needed** — one seam unlocks all three, so batch them. Until then the stand-ins cover the safety-critical direction (v1 durability on rollback is already asserted).

### 6.2 Add thin real-wiring smoke tests — **P2**

- **source→real-`AppAgentHostApplicator` integration** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: source→real-`AppAgentHostApplicator` integration test"_.
- **Multi-host boot consistency** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"Multi-host boot consistency is smoke-test scope, not unit scope"_.

**Options:** (A) add a thin smoke test wiring the real source barrier to the real applicator, and a smoke scenario booting shell + agentServer + api against one fresh instance dir; (B) rely on the single-lock invariant pinned in `appAgentHost.spec` + per-host build/type-check.

**Recommendation: A (smoke-test pipeline).** These are integration concerns the unit suite cannot express; add them to `pipelines/azure-smoke-tests.yml` if host wiring diverges. Low urgency while the unit invariants hold.

### 6.3 Optional low-value assertions — **P3, do only if cheap**

- **`@package` async status STRINGS** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED: `@package` async status STRINGS not asserted"_. Record `appendDisplay` and assert wording. Behavior behind the strings is already covered; only exact wording is unasserted.
- **Fake-timer rollback tests (NIT)** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"DEFERRED (NITs): fake-timer rollback tests; hung-remove single-session"_. Prefer `jest.useFakeTimers()` + `advanceTimersByTimeAsync` over real-timer racing.
- **`agent-keyword` policy rule fixture test** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"No isolated unit test for the `agent-keyword` policy rule"_. Add a positive/negative fixture test if a `ts/tools/scripts` test harness is ever introduced.

**Recommendation: leave as-is; add opportunistically.** None changes behavior coverage; the full-repo `check:policy` run and the existing behavior tests already guard the real logic.

### 6.4 Do not address (covered indirectly / defensive) — **P3**

- **Direct (non-drain) prune branches unexercised** — Ref: [UPDATE_COORDINATION_DEFERRED_LOG.md](./connectedProvider/UPDATE_COORDINATION_DEFERRED_LOG.md) → _"Direct (non-drain) prune branches left unexercised"_. The `else` branch is a trivial defensive fallback (same `pruneAgentRoot` call) not reachable in the normal seed→install→op flow; the primary drained path is fully covered.
- **execMode propagation end-to-end** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"execMode propagation through installed records not asserted end-to-end"_. `recordToNpmInfo` mapping is unit-covered and `createNpmAppAgentProvider`'s execMode handling is pre-existing/separately tested; add a fixture load test only if execMode routing changes.
- **Catalog renamed-install re-lookup end-to-end** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"Catalog renamed-install re-lookup not covered end-to-end"_. The `ref`-preservation logic is locked in by the path-source unit test; add a fixture only if catalog re-lookup logic changes.
- **`UpdateCommandHandler` happy-path call order** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"`UpdateCommandHandler` happy-path call order not unit-tested"_. The three-call sequence is exercised end-to-end by the installer + `@install` tests; an isolated mock fights a TDZ module cycle for little value.
- **`@source add` duplicate-name error path** — Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"`@source add` duplicate-name error path not unit-tested"_. The duplicate guard is the registry's responsibility and is covered by the registry's own tests; the handler only propagates.

**Recommendation: do not address.** Each is either a defensive fallback or already covered indirectly, and adding coverage would require disproportionate harness/fixture work.

---

## 7. Code hygiene / cosmetic — **P3, do not address**

### 7.1 `displayResult` not awaited in the `@source`/`@update` handlers

Ref: [agentInstallSource/DEFERRED_REVIEW_LOG.md](./agentInstallSource/DEFERRED_REVIEW_LOG.md) → _"`displayResult` not awaited in the @source/@update handlers"_.

**Options:** (A) leave as-is — `displayResult` is the last statement before return and not awaiting it is the prevailing pattern across committed handlers; (B) standardize with a repo-wide sweep that awaits all handler display calls.

**Recommendation: A.** Awaiting only here adds churn without changing observable behavior; do B only as part of a deliberate handler-display standardization.

### 7.2 connectedProvider Milestone-1 cosmetic nits

Ref: [connectedProvider/DEFERRED_REVIEW_LOG.md](./connectedProvider/DEFERRED_REVIEW_LOG.md) → _Milestone 1 gate_ ("Nits deliberately not actioned"): dangling `record.provider` ref after `removeAgent`; optional-chaining clarity comment; `undefined as unknown as AppAgentHostApplicator` deferred-assignment cast.

**Options:** (A) leave as-is; (B) apply the cosmetic cleanups (null the ref, add the comment, replace the cast pattern).

**Recommendation: A (do not address).** These are cosmetic: the dangling ref is GC-reclaimed once the record leaves the `agents` map; the cast mirrors the existing `requestQueue` wiring pattern and is assigned before first use. No behavior impact.
