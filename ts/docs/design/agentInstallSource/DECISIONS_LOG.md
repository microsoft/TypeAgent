# Implementation Decisions Log

> Running log of decisions made **during implementation** that are **not specified in** or **change**
> the design ([DESIGN.md](./DESIGN.md)) or the [EXECUTION_PLAN.md](./EXECUTION_PLAN.md).
> Append a new entry whenever you choose something the design did not pin down, or deviate from what it says.
> Keep entries short. If a decision invalidates the design, also update DESIGN.md §12 (decision log) and note it here.

## How to use

- Add an entry the moment you make the call — don't batch.
- Cross-reference the design section / decision (e.g. §4.1, Q20) the entry relates to.
- Mark each entry's relationship: **Unspecified** (design was silent) or **Deviation** (design said otherwise).
- If a deviation is later ratified into the design, link the DESIGN.md change.

## Entry format

```
### YYYY-MM-DD — <short title>
- **Milestone / item:** M_ / _._
- **Type:** Unspecified | Deviation
- **Design ref:** §_ / Q_ (or "none")
- **Decision:** what was chosen.
- **Rationale:** why.
- **Design updated?** yes (link) | no (why not / follow-up)
```

---

## Entries

### 2026-06-28 — `@update` overwrites the record only after a successful materialize

- **Milestone / item:** M3 / 3.1
- **Type:** Unspecified
- **Design ref:** §4.7, §12 Q13
- **Decision:** `update` resolves+materializes the new version first and overwrites
  `agents.json` only after that succeeds, under the registry mutex. A failed materialize
  (e.g. the recorded path was removed) leaves the old record — and the running agent —
  intact (verified by a no-op test). The on-disk record is the source of truth; if the
  post-write `removeAgent`/`installAppProvider` re-registration throws, the next restart
  reconciles from disk (accepted per §4.7, NIT in gate review r2).
- **Rationale:** Matches the design's materialize-first guarantee (Q13) so an update never
  leaves the user with a half-installed or missing agent.
- **Design updated?** no (consistent with §4.7/§12 Q13)

### 2026-06-28 — Legacy migration shim retained for one release

- **Milestone / item:** M4 / 4.2
- **Type:** Unspecified
- **Design ref:** §8, §12 Q14 (legacy migration)
- **Decision:** M4 removed the already-dead `getDefaultNpmAppAgentProvider` /
  `getExternalAppAgentProvider` / `installNpm` / `isNpmSpecifier` (all gone by M2), but
  deliberately keeps the `externalAgentsConfig.json` migration shim (read + rename to
  `.migrated`) for one release.
- **Rationale:** The shim must survive at least one release so existing instances migrate on
  first run; deleting it now would strand un-migrated installs.
- **Design updated?** no (follow-up: file an issue to delete the shim next release)
- **Reconciled 2026-07-02:** Original entry also kept the `config.json` `agents` map "for
  one release" as deprecated code read only by the indexing registry, pending removal.
  After the bundled-agents revert, that map is now the authoritative definition of the
  shipped/builtin agent set (`seedRecordsFromConfig` / `getBundledAgentNames`) and is
  permanent by design — not a removal follow-up.

