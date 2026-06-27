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

### 2026-06-26 — Corrupt user catalog degrades; corrupt bundled catalog fails loud
- **Milestone / item:** M1 / 1.3
- **Type:** Unspecified
- **Design ref:** §4.1 (ordered resolve walk)
- **Decision:** `catalogSource.find`/`listAgents` catch read/parse errors for a *user*
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
  separate install dir *and* modules bundled with the app. The design's "single installed
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
