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

### 2026-06-27 — Indexing registry skips non-builtin (feed/path) agents

- **Milestone / gate:** M2 gate
- **Kind:** Review finding
- **Raised by:** review round 2 (major #1)
- **Summary:** `getIndexingServiceRegistry` resolves indexing services from the config `agents` map (builtins). Feed/path-installed agents are absent and warn-skipped, so they cannot register an indexing service.
- **Why not addressed:** Indexing services are a builtin-only capability today; the `config.json` `agents` map remains the authoritative builtin list until M4. Pre-existing behavior, clarified with a comment.
- **Follow-up:** M4 cleanup of the `config.json` `agents` map will revisit whether indexing should consult installed records.

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

### 2026-06-28 — `agent-keyword` autofix needs a second `--fix` pass to sort

- **Milestone / gate:** M4 gate
- **Kind:** Review finding
- **Raised by:** review round 1 (minor)
- **Summary:** The `sort-package-json` rule runs before `agent-keyword` in the same pass, so
  a freshly auto-added `keywords` field is left unsorted until the next `--fix` pass.
- **Why not addressed:** This only affects `--fix` ergonomics, not enforcement. CI runs
  `check:policy` **without** `--fix` and merely verifies; all committed agent package.json
  files are already sorted, so the gate is green. Reordering the rule list (or sorting inside
  the rule) would couple the rule to `sort-package-json` for no enforcement gain.
- **Follow-up:** RESOLVED (2026-07-06) — the `repo-policy-check` harness now re-normalizes
  package.json key ordering after all rules run: in `--fix` mode it applies `sort-package-json`
  to any matched `package.json` before saving. This moves a field added by a later rule (e.g.
  `agent-keyword`'s `keywords`, which runs after `npm-package-sort-metadata`) into its sorted
  position in a single `--fix` pass. The re-sort is idempotent (an already-sorted file
  serializes unchanged, so nothing is written) and generalizes to any key-adding rule.

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
