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



