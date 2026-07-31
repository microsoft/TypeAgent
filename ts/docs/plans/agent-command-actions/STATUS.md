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
| Valid linked endpoints               |                  43 |
| Missing action declarations          |                 344 |
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
- [ ] Audit and link exact existing equivalents.
- [ ] Complete all remaining agent-host actions.
- [ ] Complete existing system action families.
- [ ] Add remaining system action families.
- [ ] Enable permanent zero-gap regression check.

## Implemented hosts and slices

| Host            | Coverage completed in this milestone                                                         |
| --------------- | -------------------------------------------------------------------------------------------- |
| localPlayer     | All 16 endpoints, including bare status default, general play, and mute/shuffle toggles.     |
| osNotifications | `sync`, `test`.                                                                              |
| selfhelp        | Bare default and `ask`.                                                                      |
| powershell      | `list`, `run`, `delete`, `import`; `show` remains a new-action gap.                          |
| browser         | `open`, `close`, `learn`, `actions match`, `actions infer`, and inherited `actions` default. |

The current migration check is:

```text
Command action coverage: 43 / 387 endpoints (344 missing, 0 invalid)
Runtime-only schemas omitted: mcpfilesystem
```

## Commands

```powershell
pnpm --filter @typeagent/action-browser build
pnpm --filter @typeagent/action-browser test:local
node tools/actionBrowser/dist/cli.js --check --allow-missing
```

Strict completion command (expected to fail until all 344 remaining gaps
close):

```powershell
node tools/actionBrowser/dist/cli.js --check
```

## Known blockers requiring new behavior

| Host / command             | Reason it cannot be linked yet                                   |
| -------------------------- | ---------------------------------------------------------------- |
| browser `extractKnowledge` | Named action is not in a registered schema.                      |
| browser `ask`              | Proposed action is outside active `BrowserActions`.              |
| browser `actions record`   | Starts recording; proposed action consumes a finished recording. |
| calendar/email login       | Readiness setup intercepts execution while signed out.           |
| calendar/email logout      | Must refresh cached readiness after logout.                      |

No built-in command is excluded. OAuth callbacks, dispatcher diagnostics,
PowerShell `show`, browser automation controls, recording stop, and every
system command remain in the endpoint ledger until covered.
