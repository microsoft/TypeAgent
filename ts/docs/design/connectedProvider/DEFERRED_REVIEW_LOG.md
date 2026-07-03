# Connected AppAgent Provider — Deferred Review Log

> Every gate **review finding** or **test gap** deliberately **not addressed**,
> with a rationale. See [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) for the gate
> structure.

## Milestone 1 — gate

Review round 1 (Explore subagent) found no blockers/majors. Nits deliberately
**not** actioned, with rationale:

- **Dangling `record.provider` ref after `removeAgent`** (appAgentManager.ts):
  the record is deleted from the `agents` map and goes out of scope, so GC
  reclaims it; explicitly nulling `record.provider` is cosmetic. Not changed.
- **Optional-chaining `record.provider?.unloadAppAgent` clarity comment**: the
  code already guards on `record.appAgent !== undefined`; comment is
  nice-to-have. Not changed.
- **`undefined as unknown as AppAgentHostApplicator` deferred-assignment cast**:
  intentional, mirrors the existing `requestQueue` wiring pattern in the same
  file; the applicator is assigned before first use. Kept for consistency.
- **N+1 `setState` calls when registering source providers at init**:
  behavior-preserving M1 path, logically idempotent. Milestone 2 restructures
  install onto the explicit-enable applicator path, removing the redundancy.
  Deferred to M2.

Test-gap round 1 (Explore subagent): 4 P0 gaps identified and **all fixed** in
appAgentHost.spec.ts (now 13 tests): positive `removeProvider` teardown of a
registered single-agent provider; `applyRemove` error propagation; dispose while
an op is actively running (only queued ops auto-ack); longer mixed FIFO sequence.

Review round 2 (fresh subagent): found one real low-severity bug — if the
command lock itself throws/rejects (not `op.run`), the op was never settled and
its ack would hang forever. **Fixed** (wrapped the `commandLock` call in
try/catch that settles the op and keeps pumping) + regression test added (14
tests total). No other findings beyond the round-1 logged nits.

Test-gap round 2 (fresh subagent): confirmed all Milestone-1 matrix rows and
test-focus bullets are covered; no remaining P0 gaps. Integration-level concerns
(enable-state semantics, connect/dispose wiring races, collision/embedding save)
are appropriately deferred to M2/M3 integration coverage.

## Milestone 2 — gate

Review round 1 (Explore subagent): no real blockers. The flagged "verify
AppAgentManager.removeProvider exists" is the M1-implemented+tested method (the
subagent did not read appAgentManager.ts). Remaining items were clarity nits
(add TODO/why comments for the `clients` Set, `enable=true`, `commandDefaultEnabled`)
— already covered by existing inline comments + this log; not re-churned.

Test-gap round 1 (Explore subagent): P0 gaps identified and **all fixed**:
- `@package source` nesting under the command table (buildPackageCommandTable);
- handler error handling (install/uninstall/update throw → no `AppAgentHost` call);
- handler completions (install ref/--source, uninstall/update names);
- connection `dispose()` lifecycle (idempotent; does NOT tear down shared
  providers; a later connect still vends them);
- install-after-connect visibility (a later session's connect sees the new agent);
- uninstall drops the agent from later-vended connections.
packageAgent.spec.ts (13) + installSourcesInstalledProvider.spec.ts (now 40 total
across the two files) all green.

Deferred (logged): "all hosts smoke-boot" is integration-only; partial evidence
is that the three rewired host files (server.ts, webDispatcher.ts, instance.ts)
type-check and their packages build. Full boot is covered by existing host smoke
tests / CI, not a new unit test.

## Milestone 3 — gate

Review round 1 (Explore subagent): all 9 review-focus items verified correct; no
blockers. Confirmed issuing-awaited/siblings-best-effort ordering, §5 enable
policy, two dispose guards (source registry removal + applicator closed flag),
shared providers survive single-session dispose, update remove-then-add per
client, single-client degrade, `withDisabledByDefault` preserves optional methods,
layering intact.

Test-gap round 1 (Explore subagent): P0/P1 gaps identified and **all fixed**:
- system-message content asserted — extracted `emitAgentChangeNotification`
  helper + 3 wording tests (disabled-install / enabled-install / uninstall);
- double-dispose + late-op no-op (applicator);
- single-client (web) fan-out degrade;
- update remove-then-add per client (issuing + sibling);
- late-connect-disabled (manifest default false) distinct from sibling-disabled
  (fan-out `enable=false`) — both covered.
Suites: appAgentHost.spec.ts (19), installSourcesInstalledProvider.spec.ts (36),
packageAgent.spec.ts (11).

Deferred (logged): the deeper "hostAddProvider actively calls setState with the
agent disabled" assertion is integration-level (needs a live AppAgentManager +
session); the enable-flag flow is unit-covered (fan-out asserts `enable=false` to
siblings; the applicator threads it; `applyExplicitAgentState` is the same
mechanism proven at install). End-to-end web/server boot deferred to the final
gate.

Review + test-gap round 2: the `Explore` subagent was temporarily unavailable, so
round 2 was performed as a focused self-review of the round-1 focus areas. It
found one real §5 nuance — `withDisabledByDefault` originally forced only
`defaultEnabled: false`, so an installed agent explicitly setting
`commandDefaultEnabled: true` would still be enabled on a sibling. **Fixed** by
forcing all four enable-default fields false. All other focus items verified:
notify emitted only after the op applies; sibling `.catch` attached synchronously;
update sibling remove-enqueued-before-add; no double-add of the issuing host; the
extracted `emitAgentChangeNotification` is behavior-identical to the inlined
version. No remaining P0 gaps.

## Milestone 4 — gate

The `Explore` subagent was unavailable for this milestone, so the gate was run as
a rigorous self-review (both review passes + test-gap) plus tests.

Review — found one real concurrency bug: `update`'s `materialize` await runs while
the entry is still `active`, so a concurrent `uninstall` (from another session)
could start draining P1 while `update` then overwrote the entry with P2 —
coexistence + a wedged drain. The design (§7.3 point 6) explicitly requires
per-name serialization beyond the global write limiter. **Fixed** by adding a
per-name `busy` guard (`assertNameFree` + `busy.add`/finally-`busy.delete`)
wrapping the synchronous span of install/uninstall/update; combined with the
`removing` state this fully serializes concurrent ops on one name. Other checks:
`drainDrop` is idempotent (status guard + `entries.delete` before `then`, so a
host dropped via both its `.finally` and `dispose()` cannot double-run `then`);
concurrent uninstalls are caught by the record "not found" check after the first
deletes; the update `then`'s `fanOutAdd` to a possibly-disconnected issuing host
is safe (its applicator is closed → no-op); every fire-and-forget has `.catch`.

Test-gap — added: reuse-during-removing rejected (install + update) and allowed
once drained; connect-during-removing skips the draining name; disconnect-while-
pending completes the drain; load-during-removing refused (tombstone); `@package
list` hides a draining agent (update in progress); update adds new only after old
drains everywhere (no coexistence); failed update leaves the agent active +
vended everywhere; a throwing sibling still drains (record committed, name freed).
installSourcesInstalledProvider.spec.ts (44) + packageAgent.spec.ts (11) green.

Deferred: none for M4. End-to-end multi-conversation flow is exercised at unit
scope via fake hosts; the real dispatcher wiring is covered by the final gate.

## Milestone 5 — light gate (1 review + 1 test-gap)

Hygiene milestone (docs + dead-code sweep); comments/docs only, no runtime change.

Review: grep gate is clean — no code or comment reference to `AppAgentInstaller`,
`getDefaultAppAgentInstaller`, `installCommandHandlers`, or `.agentInstaller`
remains anywhere under `ts/packages` / `ts/examples`. The old
`installAppProvider` is intentionally KEPT (not dead): it is still used to
register a source's vended providers at `connect()` init through the
config-derived state path, which is what makes late-connect "disabled by default"
hold (the manifest default is false). The `@package`/`@source` graft helpers in
the system agent were already removed in M2. Stale doc comments updated to the
new `AppAgentSource` / `InstalledAgentSourceApi` model; README.AUTOGEN.md updated
(`getDefaultAppAgentSource`); DESIGN.md status flipped to **Implemented**.

Test-gap: grep gate for removed symbols (empty); install-sources suites (153)
green; all packages (dispatcher, default-agent-provider, agentServer, api, shell
node) build. No new tests needed for a docs/hygiene pass.







