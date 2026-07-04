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

### 2025-XX-XX — Install-id keyed roots under an `agents/` subdir

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

### 2025-XX-XX — Best-effort GC: prune-on-swap + startup orphan sweep

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

### 2025-XX-XX — `installName`/`version` threaded as optional & back-compatible

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
