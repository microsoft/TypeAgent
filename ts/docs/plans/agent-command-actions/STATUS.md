# Status: natural-language actions for every `@` command

Tracks [PLAN.md](./PLAN.md). Counts come from strict executable-endpoint
collection, not manual estimates.

## Baseline (2026-07-31)

| Metric                               |               Count |
| ------------------------------------ | ------------------: |
| Executable command endpoints         |                 387 |
| Valid linked endpoints               |                  13 |
| Missing action declarations          |                 374 |
| Invalid / dangling / ambiguous links |                   0 |
| Runtime-only static omissions        | 1 (`mcpfilesystem`) |

## Current coverage

| Metric                               |               Count |
| ------------------------------------ | ------------------: |
| Executable command endpoints         |                 387 |
| Valid linked endpoints               |                  96 |
| Missing action declarations          |                 291 |
| Invalid / dangling / ambiguous links |                   0 |
| Runtime-only static omissions        | 1 (`mcpfilesystem`) |

## Phase checklist

- [x] Add schema-aware action-link resolution.
- [x] Reject unknown schemas/actions and ambiguous bare names.
- [x] Preserve qualified schema identity in rendered forward/reverse links.
- [x] Enumerate bare, inline-default, and string-default endpoints.
- [x] Exclude namespace-only groups from endpoint totals.
- [x] Fail strict manifest, authored-schema, and command-table collection.
- [x] Report runtime-only schema omissions explicitly.
- [x] Add missing/invalid endpoint counters and migration check mode.
- [ ] Generate and maintain the per-host endpoint ledger.
- [x] Audit and link exact existing equivalents.
- [x] Complete all remaining agent-host actions.
- [ ] Complete existing system action families.
- [ ] Add remaining system action families.
- [ ] Enable permanent zero-gap regression check.

## Implemented hosts and slices

| Host            | Coverage completed in this milestone                                                      |
| --------------- | ----------------------------------------------------------------------------------------- |
| localPlayer     | All 16 endpoints, including bare status default, general play, and mute/shuffle toggles.  |
| osNotifications | `sync`, `test`.                                                                           |
| selfhelp        | Bare default and `ask`.                                                                   |
| powershell      | All five management endpoints: `list`, `run`, `delete`, `show`, and `import`.             |
| browser         | All 31 endpoints, including config, automation lifecycle, extraction, Q&A, and recording. |
| email           | All 5 endpoints: login default, logout, Google auth, and inbox indexing.                  |
| greeting        | Bare command, including deterministic `--mock` action parity.                             |
| player          | All 3 Spotify management endpoints: load, login, and logout.                              |
| calendar        | All 4 auth endpoints, including the bare login default and Google auth.                   |
| dispatcher      | All 6 request/match/translate/reason/explain diagnostics.                                 |

All non-system command hosts are now fully covered.

## System progress

| Family       | Completed in this milestone                                     |
| ------------ | --------------------------------------------------------------- |
| conversation | Added help action for bare `@conversation` and explicit `help`. |
| grammar      | Unified and linked list/show/delete/clear plus bare default.    |
| describe     | Added exact multiplexing action for `@describe`.                |

The current migration check is:

```text
Command action coverage: 96 / 387 endpoints (291 missing, 0 invalid)
Runtime-only schemas omitted: mcpfilesystem
```

## Commands

```powershell
pnpm --filter @typeagent/action-browser build
pnpm --filter @typeagent/action-browser test:local
node tools/actionBrowser/dist/cli.js --check --allow-missing
```

Strict completion command (expected to fail until all 291 remaining gaps
close):

```powershell
node tools/actionBrowser/dist/cli.js --check
```

The remaining gaps are all system command families. No built-in command is
excluded; every remaining endpoint stays in the ledger until covered.
