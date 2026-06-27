# Implementation Decisions Log

> Running log of decisions made **during implementation** that are **not specified in** or **change**
> the design ([README.md](./README.md)) or the [EXECUTION_PLAN.md](./EXECUTION_PLAN.md).
> Append a new entry whenever you choose something the design did not pin down, or deviate from what it says.
> Keep entries short. If a decision invalidates the design, also update README §12 (decision log) and note it here.

## How to use

- Add an entry the moment you make the call — don't batch.
- Cross-reference the design section / decision (e.g. §4.1, Q20) the entry relates to.
- Mark each entry's relationship: **Unspecified** (design was silent) or **Deviation** (design said otherwise).
- If a deviation is later ratified into the design, link the README change.

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

### 2026-06-26 — Default provider reads bundled catalog only for the default config

- **Milestone / item:** M1 / 1.2
- **Type:** Unspecified
- **Design ref:** §3, §7 (plan 1.2 step 4)
- **Decision:** In the temporary 1.2 adapter, `getDefaultNpmAppAgentProvider` reads the
  bundled catalog (`agents.catalog.json`) only when `configName` is undefined; named
  configs (`config.test.json`, `config.all.json`, `config.agent.json`,
  `config.service.json`) still read their own `config.<name>.json` `agents` map.
- **Rationale:** Named configs select distinct agent subsets used by tests/dev. The
  bundled catalog mirrors `config.json` (the default). Routing only the default through
  the catalog verifies the data move without changing named-config behavior. The
  `config.json` `agents` map is left in place during M1 (still read by
  `getIndexingServiceRegistry`); full removal is M2/M4 cleanup.
- **Design updated?** no (temporary M1 scaffolding; replaced by the single provider in M2)

### 2026-06-26 — `ExecutionMode` defined as a string union in dispatcher core

- **Milestone / item:** M1 / 1.1
- **Type:** Unspecified
- **Design ref:** §4.1, §4.2 (sketches use `execMode?: ExecutionMode`)
- **Decision:** `installSource.ts` defines `export type ExecutionMode = "separate" | "dispatcher"`
  locally rather than importing the `const enum ExecutionMode` from `dispatcher-node-providers`.
- **Rationale:** `dispatcher-node-providers` depends on `agent-dispatcher`; importing back
  would create a cycle and violate the layering rule. The string union matches the enum's
  serialized values used in catalog/record JSON.
- **Design updated?** no (interface-level detail consistent with the design)
### 2026-06-27 — `ExecutionMode` moved to the node provider; core carries `loaderConfig`

- **Milestone / item:** follow-up to M1 / 1.1
- **Type:** Layering correction
- **Design ref:** §4.1, §4.2
- **Decision:** Reverses the 2026-06-26 placement. `ExecutionMode` now lives in
  `dispatcher-node-providers` (the loader that owns process-model semantics) and is
  exported from there. The dispatcher-core `ResolvedCandidate` / `InstalledAgentRecord`
  no longer carry a typed `execMode`; instead they carry an opaque, kind-specific
  `loaderConfig?: Record<string, unknown>` bucket (npm uses `{ execMode }`). Sources
  write `loaderConfig`; the record→`NpmAppAgentInfo` boundary in `installedAgents.ts`
  reads `loaderConfig.execMode`.
- **Rationale:** Execution mode is a provider/loader concern, not a core contract. Keeping
  the type in core forced the core to know a loader-specific vocabulary. The opaque bucket
  keeps the core provider-agnostic, stays JSON-serializable for `agents.json`, and leaves
  the `kind` seam (§10) free to add non-npm loaders without touching core types.
- **Design updated?** no (interface-level refinement; record shape stays serialization-compatible)
### 2026-06-26 — Corrupt user catalog degrades; corrupt bundled catalog fails loud

- **Milestone / item:** M1 / 1.3
- **Type:** Unspecified
- **Design ref:** §4.1 (ordered resolve walk)
- **Decision:** `catalogSource.find`/`listAgents` catch read/parse errors for a _user_
  catalog and degrade to "no agents" (debug-logged) so the ordered resolve walk continues
  to the next source. A corrupt/unreadable **bundled** catalog (`"<bundled>"`) instead
  throws loudly, since it is a build artifact and a failure there is a packaging bug.
  `loadCatalog` wraps raw read/JSON errors with the file path for actionable messages.
- **Rationale:** A single bad workspace catalog should not break resolution against other
  configured sources, mirroring the feed source's offline-degrade behavior. Silently
  masking a packaging defect in the shipped catalog would hide real bugs, so the bundled
  path stays fail-fast (raised in M1 gate review round 2).
- **Design updated?** no (robustness detail consistent with the design)

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

### 2026-06-27 — Indexing service registry resolves builtins only

- **Milestone / item:** M2 / 2.4
- **Type:** Unspecified
- **Design ref:** §7
- **Decision:** `getIndexingServiceRegistry` continues to resolve agents from the config's
  `agents` map (builtins). Feed/path-installed agents are absent there and are warn-skipped
  rather than resolved.
- **Rationale:** Indexing services are a property of builtin agents only; the `config.json`
  `agents` map is the authoritative builtin list until M4 cleanup. Pre-existing behavior,
  clarified with a comment (gate review r2).
- **Design updated?** no (intentional; revisit in M4)

### 2026-06-28 — `@update`/`@source remove` data access lives on the installer, not the dispatcher core

- **Milestone / item:** M3 / 3.1
- **Type:** Deviation
- **Design ref:** §4.3, §5 (plan 3.1 said "AppAgentInstaller interface unchanged")
- **Decision:** Added three **optional** methods to `AppAgentInstaller`:
  `update(name, range?)`, `sources()`, and `recordsUsingSource(sourceName)`. The dispatcher
  core handlers (`UpdateCommandHandler`, `@source remove`) call these instead of reading
  `agents.json` directly.
- **Rationale:** The dispatcher core must never import `default-agent-provider` and cannot
  read `agents.json` (that record store lives in the installer's package). `@update` needs
  the recorded provenance to re-resolve, and `@source remove` needs the list of records
  using a source to warn. Putting that logic behind optional installer methods keeps the
  layering rule intact while the core handlers stay thin. Methods are optional so alternate
  installers (e.g. test doubles) need not implement them.
- **Design updated?** no (interface addition consistent with §4.3 intent)

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

### 2026-06-28 — `@source order` appends the remaining configured sources

- **Milestone / item:** M3 / 3.2
- **Type:** Unspecified
- **Design ref:** §5 (order is a subset), §6 (full configured set)
- **Decision:** `@source order <names...>` treats the given names as a priority prefix:
  unknown names are warned and skipped, the known subset is de-duplicated and kept first,
  then every remaining configured source (in `registry.list()` order) is appended. An empty
  name list therefore leaves the configured set intact in its current list order.
- **Rationale:** Reordering must never silently drop a configured source (§6). Treating the
  argument as a prefix lets users promote a source without re-typing the whole order.
- **Design updated?** no (command-surface detail consistent with §5/§6)

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

### 2026-06-28 — Agent detection keys on the `./agent/manifest` export

- **Milestone / item:** M4 / 4.1
- **Type:** Unspecified
- **Design ref:** §4.1, §12 Q12 (feed-enumeration marker)
- **Decision:** The `agent-keyword` repo-policy rule classifies a package as an app agent
  when its `package.json` `exports` object has a `"./agent/manifest"` key, and then
  requires `"typeagent-agent"` in `keywords`. Detection does **not** use the
  `@typeagent/agent-sdk` dependency.
- **Rationale:** `./agent/manifest` is the exact subpath the npm agent provider resolves to
  load an agent, so it is the authoritative, false-positive-free marker. Many infrastructure
  packages depend on `@typeagent/agent-sdk` without being agents, so a dependency-based
  heuristic would over-match. Verified: all 36 packages with the export carry the keyword,
  and no non-agent package does.
- **Design updated?** no (enforcement detail consistent with §4.1/§12 Q12)

### 2026-06-28 — Migration shim and `config.json` agents map retained for one release

- **Milestone / item:** M4 / 4.2
- **Type:** Unspecified
- **Design ref:** §8, §12 Q14 (legacy migration)
- **Decision:** M4 removed the already-dead `getDefaultNpmAppAgentProvider` /
  `getExternalAppAgentProvider` / `installNpm` / `isNpmSpecifier` (all gone by M2), but
  deliberately keeps the `externalAgentsConfig.json` migration shim (read + rename to
  `.migrated`) and the builtin `config.json` `agents` map (still read by the indexing
  registry) for one release.
- **Rationale:** The shim must survive at least one release so existing instances migrate on
  first run; deleting it now would strand un-migrated installs. The `agents` map removal is
  coupled to the indexing-registry rework deferred past this feature.
- **Design updated?** no (follow-up: file an issue to delete the shim next release)

### 2026-06-28 — Catalog entry with neither path nor name fails fast
- **Milestone / item:** Final gate (catalogSource)
- **Type:** Unspecified
- **Design ref:** §4.2, §12 Q17 (exactly one resolution handle)
- **Decision:** `catalogSource.find` now throws a clear error when a matched catalog entry
  carries neither a `path` nor a package `name`, instead of producing a record with no
  resolution handle that would only fail (opaquely) at load time.
- **Rationale:** Q17 requires every record to have exactly one handle. A handle-less entry is
  a catalog authoring mistake; failing at resolve time (when the user references that key)
  gives an actionable message and never persists a malformed record. An unknown key still
  returns `undefined` (non-match) so the ordered walk continues — only a *present but
  malformed* entry throws. (Found in final-gate review round 2.)
- **Design updated?** no (enforces the existing §4.2/Q17 invariant)
