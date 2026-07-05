# Update Coordination — Implementation Decisions Log

> Running log of decisions made **during implementation** that are **not specified in** or **change**
> the design ([UPDATE_COORDINATION.md](./UPDATE_COORDINATION.md)) or the
> [UPDATE_COORDINATION_EXECUTION_PLAN.md](./UPDATE_COORDINATION_EXECUTION_PLAN.md).
> Append a new entry whenever you choose something the design did not pin down, or deviate from what it says.
> Keep entries short. If a decision invalidates the design, also update UPDATE_COORDINATION.md and note it here.
>
> Distinct from [UPDATE_COORDINATION_DEFERRED_LOG.md](./UPDATE_COORDINATION_DEFERRED_LOG.md): that log
> records gate findings / test gaps deliberately **not addressed**; this log records design-level choices
> **made** during implementation.

## How to use

- Add an entry the moment you make the call — don't batch.
- Cross-reference the design section (e.g. §5.5, §5.7) the entry relates to.
- Mark each entry's relationship: **Unspecified** (design was silent) or **Deviation** (design said otherwise).
- If a deviation is later ratified into the design, link the UPDATE_COORDINATION.md change.

## Entry format

```
### YYYY-MM-DD — <short title>
- **Milestone / item:** M_ / _._
- **Type:** Unspecified | Deviation
- **Design ref:** §_ (or "none")
- **Decision:** what was chosen.
- **Rationale:** why.
- **Design updated?** yes (link) | no (why not / follow-up)
```

---

## Entries

### 2026-07-05 — Install-id keyed roots under an `agents/` subdir

- **Milestone / item:** M1 / §5.5
- **Type:** Deviation (bounded) from the literal `<name>@<version>` root naming.
- **Design ref:** §5.5 (version-scoped install roots), §6 (shared `installDir`).
- **Decision:** Each materialize installs into
  `installDir/agents/<sanitizedInstallName>@<installId>/`, where `installId` is a
  unique, monotonic-ish token (`Date.now().toString(36)-<random>`), not the
  package version. The resolved package `version` is still captured and stored on
  the record (`InstalledAgentRecord.version`) for information only; the leaf dir
  name is stored as `InstalledAgentRecord.installRoot`.
- **Rationale:** The version is only knowable _after_ npm install completes, so it
  cannot name the directory the install writes into (chicken/egg). An install-id
  suffix is the design-sanctioned fallback and additionally guarantees two
  concurrent/back-to-back installs of the same name never collide (non-destructive
  invariant), even at identical versions. Roots live under a dedicated `agents/`
  subdir so GC can safely enumerate/prune them without touching the shared
  `installDir/node_modules`, the marker `package.json`, or feed caches.
- **Design updated?** no — recorded here; will fold into UPDATE_COORDINATION.md §5.5
  wording in M5 docs pass.

### 2026-07-05 — Best-effort GC: prune-on-swap + startup orphan sweep

- **Milestone / item:** M1 / §5.5
- **Type:** Unspecified (design mandated non-destructive roots but left reclamation open).
- **Design ref:** §5.5, §6.
- **Decision:** Old/uninstalled version-scoped roots are reclaimed by (a) pruning the
  superseded root after a successful update swap and after an uninstall completes,
  and (b) a startup orphan sweep that removes any `installDir/agents/*` dir not
  referenced by a current record's `installRoot`. Both are best-effort (`rmSync`
  recursive+force, failures logged not thrown); the sweep is the backstop for a
  crash between materialize and swap, or a failed prune.
- **Rationale:** Keeps disk bounded without making teardown fragile; a failed prune
  never blocks the update/uninstall, and the next startup reconciles.
- **Design updated?** no — recorded here; fold into §5.5/§6 in M5 docs pass.

### 2026-07-05 — `installName`/`version` threaded as optional & back-compatible

- **Milestone / item:** M1 / §5.5
- **Type:** Unspecified.
- **Design ref:** §5.5.
- **Decision:** `InstallSource.materialize` gained an optional
  `opts?: { installName?: string | undefined }`; `registry.resolve`/`reresolve`
  thread it through. `InstalledAgentRecord.installRoot`/`version` are optional. A
  record lacking `installRoot` resolves from the shared `installDir` exactly as
  before (`recordRequirePath`).
- **Rationale:** Zero migration for existing on-disk records and keeps the source
  interface change additive; `exactOptionalPropertyTypes` forced the explicit
  `| undefined` widening on the option types.
- **Design updated?** no.

### 2026-07-05 — Uniform enqueue: the issuing session is fanned out like a sibling

- **Milestone / item:** M2 / §5.4
- **Type:** Deviation (removes the previously-implemented inline "immediate" path).
- **Design ref:** §5.4 (uniform enqueue), §7.1 (idle-gated applicator).
- **Decision:** Deleted the `immediate` parameter on
  `AppAgentHost.addProvider`/`removeProvider` and the applicator's
  `applyImmediate` fast path. Every session — INCLUDING the one that issued the
  `@package` command — now enqueues its add/remove on its own idle-gated FIFO
  applicator and is notified with a system message. `fanOutAdd`/`startDrain`
  build `targets = new Set(clients); targets.add(issuingHost)` and loop with
  `notify=true`; both are synchronous `void` functions that return once the ops
  are wired (non-blocking). `install`/`uninstall`/`update` no longer await the
  issuing host's op, so they return before the fan-out add / drain completes and
  the terminal state is reported via the fan-out notification ("…will load/
  unload/reload in each session shortly").
- **Rationale:** The old inline path applied the issuing session's change under
  the command lock the issuing `@package` command still held; awaiting it now
  would deadlock. Treating the issuing session identically to siblings removes
  the special case, guarantees FIFO remove-then-add ordering per session, and is
  the ownership flip M3's `replaceProvider` barrier builds on. A regression test
  (`deadlock-free: install/uninstall/update return while the issuing session's
command lock is held`) pins the non-blocking contract.
- **Design updated?** no — matches §5.4 intent; fold the "issuing == sibling"
  wording into UPDATE_COORDINATION.md in the M5 docs pass.

### 2026-07-05 — `pruneAgentRoot` guards against any falsy `installRoot`

- **Milestone / item:** M2 / §5.5 (hardening surfaced in M2 review round 2)
- **Type:** Unspecified (defensive).
- **Design ref:** §5.5 GC.
- **Decision:** `pruneAgentRoot` now early-returns on `!installRoot` (was
  `=== undefined`), so a corrupt empty-string `installRoot` can never join to the
  whole `agents/` dir and get recursively removed.
- **Rationale:** Install-ids are source-generated and non-empty, so this is
  theoretical, but the downside (wiping every agent's root) is severe enough to
  warrant the one-line guard on a destructive `rmSync`.
- **Design updated?** no.

### 2026-07-05 — Coordinated `replaceProvider` barrier + explicit verify-0 (M3 core)

- **Milestone / item:** M3 / §5.1, §5.6, §5.7
- **Type:** Implements the design (the correctness core).
- **Decision:** Introduced ONE `replaceProvider(oldProvider, newProviderThunk?,
options)` primitive on `AppAgentHost`; BOTH `update` and `uninstall` route
  through it. The applicator runs the whole `applyRemove(old) → onQuiesced() →
await whenReady → (thunk ? applyAdd(new))` sequence as a SINGLE queued op, so
  `pump` holds the session command lock across the entire remove→wait→add
  section — no user command interleaves (closes the update request-slip of §5).
  Uninstall omits the thunk (`old → ∅`, same section, no add). A source-side
  barrier (`ReplaceBarrier`, replacing `startDrain`/`drainDrop`/`then`) fans
  `replaceProvider` out to every session non-blocking, collects each host's
  quiesce via `quiesce()`, and only when `pending` is empty AND `verifyZero`
  confirms the shared old provider's `getRefCount(name) === 0` runs `onComplete`
  (flip to active(new) / delete + prune) BEFORE releasing the parked hosts.
- **verify-0 is EXPLICIT:** the source reads `oldProvider.getRefCount?.(name)`;
  release is NEVER inferred from quiesce ACKs (a provider without `getRefCount`
  is treated as released). New optional `getRefCount?`/`isLoaded?` on
  `AppAgentProvider`; `npmAgentProvider` implements them off its `moduleAgents`
  refcount. Layering preserved — the check rides the provider interface, so
  `agent-dispatcher` core never imports `default-agent-provider`.
- **Rationale:** A single lock-held section per dispatcher is the only way to
  guarantee no request slips into the window between remove and add on a session;
  the source-coordinated verify-0 barrier guarantees no two versions of a name
  are ever loaded at once (persisted storage is keyed by name and cannot be
  shared). Reusing the existing `applyAdd`/`applyRemove` leaves
  `commandHandlerContext` wiring unchanged.
- **Design updated?** no — implements §5.1/§5.6/§5.7; flip UPDATE_COORDINATION.md
  to "Implemented" in the M5 docs pass.

### 2026-07-05 — `replaceProvider` defaults `dropConfig=false` (preserve config)

- **Milestone / item:** M3 / §5 Model B (surfaced in M3 review round 2)
- **Type:** Unspecified (API default choice).
- **Decision:** `AppAgentHost.replaceProvider` defaults `options.dropConfig` to
  `false` (preserve the enable preference), unlike `removeProvider` which
  defaults `true`. The barrier always passes `dropConfig` explicitly
  (`uninstall→true`, `update→false`), so the default only affects a hypothetical
  bare caller.
- **Rationale:** A replace is a swap, not a removal; the conservative default for
  a swap is to keep the user's per-session enable preference. Documented inline.
- **Design updated?** no.

### 2026-07-05 — Parked `replaceProvider` re-checks `closed` after the barrier

- **Milestone / item:** M3 / §5.7, §6 (hardening surfaced in M3 review round 1)
- **Type:** Unspecified (defensive).
- **Decision:** After `await options.whenReady`, the applicator's replace op
  re-checks `this.closed` and skips the startup (add) leg if the session was
  disposed while parked. `dispose` leaves a running op to finish (§6), so without
  this a late barrier release could `applyAdd` v2 into a torn-down session.
- **Rationale:** The source already drops a disconnected host from the barrier,
  so the add is a pure no-op; the guard makes that explicit and avoids loading v2
  into a closing manager. Pinned by an applicator test ("a replace parked on
  whenReady skips the add after dispose").
- **Design updated?** no.

### 2026-07-05 — Single-round rollback: outcome decided BEFORE hosts release

- **Milestone / item:** M4 / §5.3
- **Type:** Unspecified
- **Design ref:** §5.3
- **Decision:** The barrier decides its outcome (commit / rollback) BEFORE
  releasing the parked hosts. Each host adds whatever the barrier decided via a
  single post-barrier thunk `decideAdd`: `v2` on a committed update, the OLD
  provider (`v1`) on a rollback, or nothing on a committed uninstall. There is no
  second swap round — hosts remove `v1` (phase 1), park on `whenReady`, then add
  the decided provider (phase 3) under the SAME held command lock.
- **Rationale:** A two-round barrier (add `v2`, then on failure swap back to `v1`)
  would double the disruption and the lock windows and could leave a session on
  `v2` if the second round fails. Deciding first keeps each session's swap a
  single atomic remove→add and guarantees no session ever transiently runs `v2`
  on a rolled-back update.
- **Design updated?** no — implements §5.3; flip to "Implemented" in M5.

### 2026-07-05 — Default `verifyStart` = `getAppAgentManifest` (non-forking probe)

- **Milestone / item:** M4 / §5.3 (v2 start verification)
- **Type:** Unspecified
- **Design ref:** §5.3
- **Decision:** The default `v2`-start probe is `provider.getAppAgentManifest(name)`
  — a cheap, NON-forking manifest read — not a full `loadAppAgent` (which forks a
  child process in the default `separate` exec mode). Overridable via
  `updateCoordination.verifyStart`.
- **Rationale:** A forking pre-launch probe would spawn (and immediately tear
  down) a process on every update purely to check startability, and would make
  the existing path-source update tests newly fork. The manifest read catches the
  common "v2 is corrupt/unresolvable" failure without that cost. A full pre-launch
  probe is DEFERRED (see deferred log).
- **Design updated?** no.

### 2026-07-05 — Rollback record-restore is synchronous, ordered before flip/prune

- **Milestone / item:** M4 / §5.3 (surfaced in M4 review rounds 1 & 2)
- **Type:** Unspecified
- **Design ref:** §5.3, §5.5
- **Decision:** On rollback, `onDecided` restores the pre-op `agents.json` record
  with a SYNCHRONOUS `readAgentsJson`+`writeAgentsJson`, sequenced BEFORE the
  in-memory entry flips back to `active(v1)`, before `release()`, and before any
  `finalizeGc` prune. It is intentionally NOT routed through the write limiter.
- **Rationale:** Each `agents.json` read-modify-write is atomic (no `await` gap)
  and touches only this name's key, so a bare synchronous restore cannot lose a
  concurrent other-name install's write. Doing it synchronously closes two
  windows a detached async write opened: (1) a following op reading a stale `v2`
  baseline while the entry already reads `active(v1)`, and (2) a crash stranding
  the store on a `v2` record whose install root `finalizeGc` had already pruned.
  `decide()` wraps `onDecided` in try/catch so a write error still runs
  `release()` (parked hosts add off `barrier.outcome`, so they recover regardless).
- **Design updated?** no.

### 2026-07-05 — Success continuation re-quiesces (closed-at-enqueue hosts)

- **Milestone / item:** M4 / §5.3, §5.4 (surfaced in M4 review round 2)
- **Type:** Unspecified
- **Design ref:** §5.4, §5.7
- **Decision:** The per-host `replaceProvider(...).then(success)` continuation
  calls BOTH `quiesce(name, host)` and `hostSettled` (previously only
  `hostSettled`). `quiesce` is idempotent (`pending.delete` guards it).
- **Rationale:** An applicator CLOSED at enqueue time auto-acks with a resolved
  promise WITHOUT running its op body, so `onQuiesced` never fires. Without the
  success-path `quiesce`, such a host would keep its phase-1 slot filled until the
  quiesce timeout → a spurious `failed-reverted`. Quiescing from the success path
  fills the slot immediately.
- **Design updated?** no.

### 2026-07-05 — Update outcome status surfaced via `onOutcome` callback (minimal UX)

- **Milestone / item:** M4 / §4.4
- **Type:** Unspecified
- **Design ref:** §4.4, §5.4
- **Decision:** `update()` gains an `onOutcome?(status)` callback where `status ∈
{updated, cancelled-reverted, failed-reverted}` (`UpdateOutcomeStatus`), invoked
  once at decide time. `@package update` maps it to a follow-up status line. The
  no-live-old-version fan-out branch also fires `onOutcome("updated")`.
- **Rationale:** The command already returns "update started" synchronously; the
  async terminal outcome needs a channel. A full user-facing outcome UX (progress,
  a visible cancel affordance) stays DEFERRED (see deferred log), consistent with
  §4.2's UX deferral.
- **Design updated?** no.

### 2026-07-05 — Persist the store commit at the BARRIER decision, not before it

- **Milestone / item:** Final gate / §5.3, §5.5, §7.4
- **Type:** Deviation (refines the §7.4 "record write is the commit point")
- **Design ref:** §5.3, §5.5, §7.4
- **Decision:** `update()` and `uninstall()` no longer write/delete the
  `agents.json` record BEFORE the barrier. The record mutation now happens inside
  `onDecided(committed)`: update writes the v2 record only on commit; uninstall
  deletes the record only on commit. On rollback the record is untouched (v1 stays
  recorded), so there is nothing to "restore" — the previous synchronous
  rollback-restore write is removed. The in-memory entry is flipped BEFORE the
  store write (never strands the name in `removing` under the tombstone), and
  `finalizeGc`'s commit prune is guarded on the store actually reflecting the new
  state (`committed?.installRoot === newRoot` for update; record absent for
  uninstall) so a failed commit-write keeps the old root.
- **Rationale:** Two final-gate correctness findings: (1) writing v2 before the
  barrier meant a crash mid-swap left the store on an UNVERIFIED v2 while the
  startup orphan sweep pruned v1's root — the exact stranding M4 rollback exists
  to prevent. Persisting only at commit makes a crash-mid-swap recover cleanly to
  v1 (v2 root becomes the orphan the sweep reclaims), matching §5.5. (2) the
  rollback-restore write could throw (disk error) and, being swallowed by
  `decide()`'s try/catch, leave the entry stuck in `removing` → the tombstone
  bricked the agent in every session. Not restoring at all removes that failure
  mode entirely. §7.4 still holds — the record write IS the commit point; it is
  just aligned with the barrier's commit (when v2 actually becomes live) instead
  of the earlier materialize.
- **Design updated?** no (consistent with §7.4's intent; note for a future §5.3
  wording pass).

### 2026-07-05 — Uninstall surfaces a terminal outcome (`uninstalled` | `reverted`)

- **Milestone / item:** Final gate / §5.4
- **Type:** Unspecified
- **Design ref:** §5.4
- **Decision:** `uninstall()` gains an `onOutcome?(status)` callback
  (`UninstallOutcomeStatus = "uninstalled" | "reverted"`), mirroring `update()`.
  `@package uninstall` now prints "uninstall started …" up front and a follow-up
  status line at the terminal outcome; a straggler-timeout rollback reports
  "uninstall reverted; the agent is still installed."
- **Rationale:** Uninstall runs through the same barrier as update and CAN roll
  back (quiesce timeout), but the handler previously printed an unconditional
  "uninstalled" success line — telling the user the agent was gone when it had
  reverted and was still serving. The outcome callback closes that gap.
- **Design updated?** no.
