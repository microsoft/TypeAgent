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
