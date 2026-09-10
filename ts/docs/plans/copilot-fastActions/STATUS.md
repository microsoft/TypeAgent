# Copilot fast actions status

Working tracker for [PLAN.md](./PLAN.md). Keep implementation, documentation,
and live verification as separate states.

_Last updated: 2026-09-09._

## Implementation status

| Area                                       | Status | Notes                                                             |
| ------------------------------------------ | ------ | ----------------------------------------------------------------- |
| Dev-mode PowerShell schema-family routing  | done   | Static namespaces and dynamic flows receive first refusal         |
| Typed handled and not-handled dispositions | done   | `notSuitable` returns the original prompt to Copilot              |
| PowerShell capability fallback             | done   | Existing-flow preference, synthesis, aliases, and bounded repair  |
| Transactional flow creation                | done   | Pending, execute once, promote, reload, and rollback              |
| Flow persistence and same-process locking  | done   | Cross-process storage locking remains open                        |
| Explicit macro trace recording             | done   | One armed interaction per session                                 |
| Macro induction and validation             | done   | Narrow deterministic induction from one trace                     |
| Immutable macro approval                   | done   | Approval creates a new version                                    |
| Deterministic MCP replay                   | done   | Full preflight, ordered calls, bindings, and postconditions       |
| Agent-runner handoff                       | done   | Whole-macro handoff with budgets                                  |
| Adaptation candidate submission            | done   | Successful adaptations become new drafts                          |
| Macro rollout controls                     | done   | Recording, induction, replay, and handoff are independently gated |

## Documentation status

| Item                                                  | Status                     |
| ----------------------------------------------------- | -------------------------- |
| Cross-package plan                                    | done                       |
| Plugin README routing and dev-mode correction         | done                       |
| Plugin README macro lifecycle and component inventory | done                       |
| Macro package README replacement                      | done                       |
| Workflow architecture PowerShell security correction  | done                       |
| Published architecture page                           | deferred until plan review |

## Open implementation work

- [ ] Replace FullLanguage dynamic PowerShell execution with an untrusted
      execution boundary.
- [ ] Require explicit first-run approval for generated, repaired, edited, and
      imported dynamic scripts until that boundary exists.
- [ ] Add storage-level locking for independent agent-server processes.
- [ ] Add forced process-tree termination after cancellation or timeout.
- [ ] Make credentialed end-to-end dev-action and macro scenarios a release
      gate.
- [ ] Decide whether to build a catalog over other TypeAgent flow providers.

## Documentation follow-up

- [ ] Review the `copilot-fastActions` directory name before more documents
      link to it.
- [ ] Promote stable cross-package material into a published architecture page
      after review.
- [ ] Add a link from the plugin and macro READMEs to that architecture page.
- [ ] Recheck security wording when the PowerShell execution boundary changes.

## Validation checklist

- [x] Commands match current hook command parsing.
- [x] Dev-mode options match `hook-dev-actions.ts`.
- [x] Macro lifecycle matches `MacroManager`.
- [x] Replay guarantees match `deterministicReplay.ts`.
- [x] Package ownership follows the wiki contribution guide.
- [ ] Build the DocFX site when the plan is promoted into published content.
