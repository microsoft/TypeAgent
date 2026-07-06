# Deferred Review Findings & Test Gaps

> Running log of subagent **review findings** and **test gaps** (from the Milestone Gates and the Final
> Gate) that were **deliberately not addressed**. Everything declined must be recorded here with a reason,
> so reviewers see the conscious trade-offs rather than silent omissions.
> See the gate procedure in [EXECUTION_PLAN.md](./EXECUTION_PLAN.md#milestone-gate-run-at-the-end-of-every-milestone).

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

### 2026-06-27 — `getProviderConfig` first-config singleton cache

- **Milestone / gate:** M2 gate
- **Kind:** Review finding
- **Raised by:** review round 2 (major #2)
- **Summary:** `getProviderConfig(configName?)` caches the first config it loads and ignores later `configName` arguments. In theory a process that mixed multiple named configs would get the wrong one.
- **Why not addressed:** TypeAgent runs a single config per process; no-arg callers (mcp, constructions, indexing) are designed to read the active named config. A per-name `Map` would regress those processes by letting an unrelated no-arg call pin the default. Confirmed correct for real usage and left unchanged.
- **Follow-up:** none (revisit only if multi-config-per-process is ever introduced).

### 2026-06-27 — Indexing registry skips non-builtin (feed/path) agents

- **Milestone / gate:** M2 gate
- **Kind:** Review finding
- **Raised by:** review round 2 (major #1)
- **Summary:** `getIndexingServiceRegistry` resolves indexing services from the config `agents` map (builtins). Feed/path-installed agents are absent and warn-skipped, so they cannot register an indexing service.
- **Why not addressed:** Indexing services are a builtin-only capability today; the `config.json` `agents` map remains the authoritative builtin list until M4. Pre-existing behavior, clarified with a comment.
- **Follow-up:** M4 cleanup of the `config.json` `agents` map will revisit whether indexing should consult installed records.

### 2026-06-27 — execMode propagation through installed records not asserted end-to-end

- **Milestone / gate:** M2 gate
- **Kind:** Test gap
- **Raised by:** test-gap round 2 (gap #3, MED)
- **Summary:** Tests assert `execMode` is carried on the `InstalledAgentRecord` and mapped by `recordToNpmInfo`, but no test drives a `dispatcher`-execMode agent all the way through `createNpmAppAgentProvider` to confirm it actually loads in-process.
- **Why not addressed:** `recordToNpmInfo` mapping is unit-covered and `createNpmAppAgentProvider`'s execMode handling is pre-existing, separately tested behavior. An end-to-end in-process load test would require a bundled dispatcher-execMode fixture agent; low marginal value over the existing unit coverage.
- **Follow-up:** none (consider a fixture-based load test if execMode routing changes).

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

### 2026-06-28 — Catalog renamed-install re-lookup not covered end-to-end

- **Milestone / gate:** M3 gate
- **Kind:** Test gap
- **Raised by:** test-gap round 1 & 2 (deferred)
- **Summary:** The `ref`-preservation fix is unit-covered via the path source (install fills
  `ref`, update keeps it). The original catalog scenario — install a catalog agent under a
  different name, then `@update` re-looks-up the original catalog key — is not driven
  end-to-end.
- **Why not addressed:** It needs a real bundled/loadable catalog agent fixture and a
  catalog source wired into the hermetic installer; the underlying `ref`-preservation logic
  is already locked in by the path-source unit test.
- **Follow-up:** none (covered indirectly; add a fixture-based test if catalog re-lookup
  logic changes).

### 2026-06-28 — `UpdateCommandHandler` happy-path call order not unit-tested

- **Milestone / gate:** M3 gate
- **Kind:** Test gap
- **Raised by:** test-gap round 1 & 2 (deferred)
- **Summary:** The handler's success path (`installer.update` → `agents.removeAgent` →
  `installAppProvider`) is not asserted in isolation; only its two error branches
  (no installer, update unsupported) are unit-tested.
- **Why not addressed:** `installAppProvider` is a heavy named import from
  `commandHandlerContext.js` and the spec already needs a side-effect import of that module
  first to dodge a TDZ module cycle, which precludes `jest.unstable_mockModule`. The thin
  three-call sequence is exercised end-to-end by the installer tests plus `@install`
  coverage; an isolated mock would require changing the test environment for little value.
- **Follow-up:** none.

### 2026-06-28 — `@source add` duplicate-name error path not unit-tested

- **Milestone / gate:** M3 gate
- **Kind:** Test gap
- **Raised by:** test-gap round 2 (LOW)
- **Summary:** `registry.add` throws `'source already exists'` on a duplicate name; the
  handler passes that through but no handler test exercises it (the fake registry's `add` is
  a no-op `jest.fn`).
- **Why not addressed:** The duplicate guard is the registry's responsibility and is covered
  by the registry's own tests; the handler merely propagates the error without wrapping.
- **Follow-up:** none.

### 2026-06-28 — No isolated unit test for the `agent-keyword` policy rule

- **Milestone / gate:** M4 gate
- **Kind:** Test gap
- **Raised by:** test-gap round 1
- **Summary:** `tools/scripts/policyChecks/agentKeyword.mjs` has no positive/negative fixture
  unit test.
- **Why not addressed:** `ts/tools/scripts` has no jest/node:test harness (unlike
  `tools/docsAutogen`); standing one up for a pure, single-purpose rule is disproportionate.
  The full-repo `npm run check:policy` run is an effective integration test (it classified
  all 134 package.json files — 36 agents flagged, 98 non-agents untouched) and is wired into
  CI (`pipelines/azure-build-ts.yml`), so a future agent missing the keyword fails the build.
- **Follow-up:** none (add a fixture test if a scripts test harness is ever introduced).

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
