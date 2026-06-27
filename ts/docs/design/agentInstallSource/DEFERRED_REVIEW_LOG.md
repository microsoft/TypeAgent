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

### 2025-06-18 — Source config fail-fast validation (path/catalog readability)
- **Milestone / gate:** M1 gate
- **Kind:** Review finding
- **Raised by:** review round 1 (finding 3, minor)
- **Summary:** `createPathSource` / `createCatalogSource` do not verify `baseDir` / catalog file readability at construction; errors surface on first `find()`.
- **Why not addressed:** Sources are constructed eagerly for every configured source at registry init, including ones never used in a given resolve. Failing fast there would turn one bad config entry into a startup failure. `find()` already degrades gracefully (catalog → non-match + debug log; path → stat miss), which is the more robust behavior for the ordered walk. Clear contextual errors were added to catalog loading.
- **Follow-up:** none.

### 2025-06-18 — Feed cache file symlink safety
- **Milestone / gate:** M1 gate
- **Kind:** Review finding
- **Raised by:** review round 1 (finding 4, minor)
- **Summary:** `writeDiskCache` overwrites the cache path without symlink checks; an attacker with write access to `installDir` could pre-place a symlink.
- **Why not addressed:** Write access to the per-user `installDir` already implies control of the agent install tree (a far larger capability), and the only content written is benign public package-name JSON. Out of proportion to the threat for M1.
- **Follow-up:** none.

### 2025-06-18 — Transient npm auth file mode on Windows
- **Milestone / gate:** M1 gate
- **Kind:** Review finding
- **Raised by:** review round 1 (finding 5, minor)
- **Summary:** `{ mode: 0o600 }` on the transient `.npmrc` is not enforced the same way on Windows (ACL-based).
- **Why not addressed:** The file lives in a freshly `mkdtemp`'d directory under the per-user `os.tmpdir()` and is removed in a `finally`. On Windows per-user temp dirs are ACL-isolated by default, so the token is not exposed to other users. Platform-specific ACL handling is disproportionate for a sub-second transient file.
- **Follow-up:** none.

### 2026-06-27 — `getProviderConfig` first-config singleton cache
- **Milestone / gate:** M2 gate
- **Kind:** Review finding
- **Raised by:** review round 2 (major #2)
- **Summary:** `getProviderConfig(configName?)` caches the first config it loads and ignores later `configName` arguments. In theory a process that mixed multiple named configs would get the wrong one.
- **Why not addressed:** TypeAgent runs a single config per process; no-arg callers (mcp, constructions, indexing) are designed to read the active named config. A per-name `Map` would regress those processes by letting an unrelated no-arg call pin the default. Confirmed correct for real usage and left unchanged (see DECISIONS_LOG 2026-06-27).
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
