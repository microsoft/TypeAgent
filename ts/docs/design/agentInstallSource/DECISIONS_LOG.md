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
