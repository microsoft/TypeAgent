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
| Valid linked endpoints               |                 387 |
| Missing action declarations          |                   0 |
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
- [x] Generate and maintain the per-host endpoint ledger.
- [x] Audit and link exact existing equivalents.
- [x] Complete all remaining agent-host actions.
- [x] Complete existing system action families.
- [x] Add remaining system action families.
- [x] Enable permanent zero-gap regression check.

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

| Family       | Completed in this milestone                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------ |
| conversation | Added help and completed every conversation endpoint.                                            |
| grammar      | Linked rule management and collision scanning, including the bare default.                       |
| describe     | Added exact multiplexing for `@describe`.                                                        |
| settings     | Completed all seven persistent user-setting endpoints.                                           |
| notify       | Completed all eight notification endpoints.                                                      |
| history      | Completed all history, entity, attachment, and transcript endpoints.                             |
| index        | Added create/list/show/delete actions for all five endpoints.                                    |
| diagnostics  | Added environment, token, and random-request actions for all nine endpoints.                     |
| session      | Added create/open/reset/clear/list/delete/info actions for all seven endpoints.                  |
| memory       | Added legacy toggle, query, search, and answer actions for all six endpoints.                    |
| copilot      | Added import, fix handoff, and login actions for all four endpoints.                             |
| feedback     | Added list/summary/filter/export/count actions for all six endpoints.                            |
| operations   | Added help, display, scripts, tracing, debugging, lifecycle, demo, and other small operations.   |
| construction | Added store lifecycle, inspection, import, pruning, and toggle actions for all 24 endpoints.     |
| collision    | Added telemetry, corpus, keyword, neighborhood, optimization, and preference actions (30 total). |
| config       | Added an explicit 165-path config action that delegates to the canonical command parser.         |

The strict coverage check is:

```text
Command action coverage: 387 / 387 endpoints (0 missing, 0 invalid)
Runtime-only schemas omitted: mcpfilesystem
```

## Commands

```powershell
pnpm --filter @typeagent/action-browser build
pnpm --filter @typeagent/action-browser test:local
node tools/actionBrowser/dist/cli.js --check --allow-missing
```

Permanent regression coverage is also enforced by
`test/commandActionCoverage.spec.ts`. The strict completion command is:

```powershell
node tools/actionBrowser/dist/cli.js --check
```

No bundled executable command is excluded. `mcpfilesystem` remains an explicit
runtime-only action-schema omission because its actions are generated from the
connected MCP server rather than authored statically.
