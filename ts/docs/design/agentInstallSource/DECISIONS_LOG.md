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

### 2026-06-27 — Multi-root module resolution via a combine facade over one provider per root

- **Milestone / item:** M2 / 2.1
- **Type:** Unspecified
- **Design ref:** §4.1, §6, Q20
- **Decision:** `createInstalledAppAgentProvider` groups records by their resolved module
  root (the install dir vs. the app bundle), builds one `createNpmAppAgentProvider` per
  group, and presents them through `combineAppAgentProviders` — a small facade that routes
  `getAppAgentManifest`/`loadAppAgent`/`unloadAppAgent` by agent name (pre-built
  `owners` map for O(1) routing), unions `getAppAgentNames`, and broadcasts
  `setTraceNamespaces`. Path records always resolve against the app bundle (their path is
  absolute); module records probe each root via `createRequire(root).resolve(...)`.
- **Rationale:** A single `createRequire` root cannot resolve modules installed under a
  separate install dir _and_ modules bundled with the app. The design's "single installed
  provider" intent is preserved because the facade exposes exactly one `AppAgentProvider`
  to the dispatcher; the multi-root split is an internal detail (Q20).
- **Design updated?** no (resolution detail consistent with §4.1/§6)

### 2026-06-27 — Legacy migration skips names already seeded by a builtin

- **Milestone / item:** M2 / 2.3
- **Type:** Unspecified
- **Design ref:** §4.1, §8 (legacy `externalAgentsConfig.json` migration)
- **Decision:** `migrateLegacyExternalAgents` migrates only legacy `path` entries (source
  `"path"`, resolved against the instance dir), drops module-only/feed legacy entries, and
  **skips any name already present in the seeded records** (collision guard added in gate
  review round 1). The old file is renamed to `.migrated`.
- **Rationale:** A legacy path entry must not silently shadow a builtin catalog agent of
  the same name on first-run seeding. Dropping module/feed legacy entries is safe because
  those are re-resolved from the (now authoritative) install sources. (Gate review r1.)
- **Design updated?** no (migration robustness detail)

### 2026-06-27 — `getProviderConfig` keeps its first-config singleton cache

- **Milestone / item:** M2 / 2.4
- **Type:** Unspecified
- **Design ref:** §7
- **Decision:** `getProviderConfig(configName?)` retains its existing singleton cache (it
  loads the first `configName` seen and ignores later names). Reviewed in gate round 2 and
  left unchanged.
- **Rationale:** TypeAgent runs one config per process. No-arg callers (mcp, constructions,
  indexing) are meant to read the active named config. Switching to a per-name `Map` would
  regress named-config processes by letting an unrelated no-arg call pin the default config.
  Documented as a known constraint rather than changed.
- **Design updated?** no (known constraint; see DEFERRED_REVIEW_LOG)

### 2026-06-27 — Indexing service registry resolves across all providers

- **Milestone / item:** M2 / 2.4
- **Type:** Unspecified
- **Design ref:** §7
- **Decision:** `getIndexingServiceRegistry` iterates every app-agent provider (bundled,
  installed, MCP), reads each agent's manifest, and registers any `manifest.indexingServices`.
  Installed (feed/path/catalog) agents are included via their manifests, not skipped.
- **Rationale:** Indexing services are declared per agent in the manifest, so resolving
  from the live providers covers installed agents too — not just builtins.
- **Design updated?** no (consistent with §7)
- **Reconciled 2026-07-02:** Original entry resolved builtins only from the `config.json`
  `agents` map and warn-skipped installed agents ("revisit in M4"). That limitation is
  gone — resolution now runs over all providers via their manifests.

### 2026-06-28 — Install-record data access lives on the installer, not the dispatcher core

- **Milestone / item:** M3 / 3.1
- **Type:** Deviation
- **Design ref:** §4.3, §5 (plan 3.1 said "AppAgentInstaller interface unchanged")
- **Decision:** Extended `AppAgentInstaller` with **optional** members so the dispatcher
  core never reads `agents.json`: `update(name, range?)` (re-resolve/refresh),
  `sourceCommands()` (the host-owned `@source` table, merged in as `@source`),
  `listInstalled()` (`@package list`), plus `listSources()` and `listAvailable()`
  (completion). The whole `@source` surface — including the "still referenced" warning on
  remove — is owned by the host; `recordsUsingSource` is a closure the installer passes into
  `getSourceCommands`, not a core-visible method.
- **Rationale:** The dispatcher core must never import `default-agent-provider` and cannot
  read `agents.json` (that record store lives in the installer's package). Putting this
  logic behind optional installer members keeps the layering rule intact while the core
  stays thin. Optional so alternate installers (e.g. test doubles) need not implement them.
- **Design updated?** no (interface addition consistent with §4.3 intent)
- **Reconciled 2026-07-02:** Original entry named `sources()` and `recordsUsingSource()`
  as core-called installer methods plus a core `@source remove` handler. The surface
  evolved: the host now owns the entire `@source` command table via `sourceCommands()`
  (there is no core `@source remove` handler), and `sources()` became `listSources()`
  alongside `listInstalled()` / `listAvailable()`.

### 2026-06-28 — install/update preserve the re-resolution key in `ref`

- **Milestone / item:** M3 / 3.1
- **Type:** Unspecified
- **Design ref:** §5 (`@update` re-resolves against the recorded source), §12 Q13
- **Decision:** When a resolved record has no `ref` (catalog and path records — catalog
  `materialize` leaves it unset, path records never set it), `install` and `update` fill
  `record.ref` with the supplied lookup key (catalog key or path). `recordToNpmInfo` never
  reads `ref`, so this is inert at load time but lets `@update` re-look-up a catalog agent
  installed under a different name than its catalog key, and re-materialize a path agent.
  `update` re-applies the same fill after re-resolution so repeated updates never drop it
  (caught in M3 gate review r2).
- **Rationale:** Without preserving the key, a renamed catalog install loses the only handle
  back to its source entry and `@update` would fail or mis-resolve.
- **Design updated?** no (record-field usage detail consistent with §5/§12 Q13)

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

