# Deferred Review Findings & Test Gaps

> Running log of subagent **review findings** and **test gaps** (from the Milestone Gates and the Final
> Gate) that were **deliberately not addressed**. Everything declined must be recorded here with a reason,
> so reviewers see the conscious trade-offs rather than silent omissions.
> The design of record is [DESIGN.md](./DESIGN.md); the execution plan that defined the gate procedure
> has been retired (its file map and test coverage are migrated into DESIGN.md's _Implementation reference_).

## How to use

- If a gate finding or identified test gap is **not** fixed/filled, add an entry here before closing the gate.
- Anything actionable later should link a tracking issue (or be marked _follow-up_).
- Fixed items do **not** belong here — only the ones intentionally left.

## Entry format

```
### YYYY-MM-DD — <short title>
- **Milestone / gate:** M_ gate | final gate
- **Kind:** Review finding | Test gap
- **Raised by:** review round _ / test-gap round _
- **Summary:** the finding or missing coverage.
- **Why not addressed:** rationale (out of scope / low risk / deferred / disagree).
- **Follow-up:** issue link, or "none".
```

---

## Entries

### 2026-06-28 — Feed `@update <range>` building `module@range` not unit-tested

- **Milestone / gate:** M3 gate
- **Kind:** Test gap
- **Raised by:** test-gap round 1 & 2 (deferred)
- **Summary:** The `update` feed branch builds `module@range` and re-resolves through the
  feed source, but no test exercises it. Path and catalog re-resolution are covered.
- **Why not addressed:** The feed branch requires a live npm/Azure-Artifacts registry (or a
  mocked feed source injected into `getDefaultAppAgentInstaller`, which takes no DI seam).
  A hermetic test would mean re-architecting the installer factory for injection — out of
  proportion to the thin `range !== undefined ? \`${m}@${range}\` : m` logic.
- **Follow-up:** add if the installer factory ever gains a DI seam for the registry.

### 2026-06-28 — Multi-host boot consistency is smoke-test scope, not unit scope

- **Milestone / gate:** Final gate
- **Kind:** Test gap
- **Raised by:** final-gate test-gap round 1
- **Summary:** No single test boots shell + agentServer + api against one fresh instance dir
  and confirms all three hosts see the same installed agents from `agents.json`.
- **Why not addressed:** This is a cross-process, multi-package integration concern that the
  unit suite cannot realistically express; it belongs in the smoke-test pipeline
  (`pipelines/azure-smoke-tests.yml`). The per-host wiring is unit-covered (each caller
  passes `agentInstaller`), and the record read/write path is covered by the store/provider
  specs. Cross-process `@source` restart persistence is now covered hermetically by the
  registry reload round-trip test.
- **Follow-up:** consider a smoke-test scenario if host wiring diverges.
