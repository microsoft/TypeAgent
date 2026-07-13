# Structured Agent Output — Status & Backlog

Working tracker for the plan in [PLAN.md](./PLAN.md). Update whenever a
phase item is started, completed, or a follow-up surfaces. Keep entries
terse — one line per item where possible.

_Last updated: 2026-07-11 — plan drafted, not yet started._

## Progress by phase

### Phase 1 — SDK foundation _(blocks everything)_

| Item | Description                                                                                | Status |
| ---- | ------------------------------------------------------------------------------------------ | ------ |
| 1a   | `StructuredContent` + block types in `agentSdk/src/display.ts`                             | todo   |
| 1b   | Builders: `createStructuredResult`, `createTable`, `fromRecords`                           | todo   |
| 1c   | Fallback derivation: `structuredToMarkdown` / `structuredToText` / `getStructuredFallback` | todo   |
| 1d   | Exports from `agentSdk/src/index.ts`                                                       | todo   |
| 1e   | Unit tests (derivation + builders)                                                         | todo   |

### Phase 2 — Renderer safety net _(after 1)_

| Item | Description                                                              | Status |
| ---- | ------------------------------------------------------------------------ | ------ |
| 2a   | `chat-ui/setContent.ts` — detect `"structured"`, use fallback (no throw) | todo   |
| 2b   | `vscode-chat/displayRender.ts` — fallback                                | todo   |
| 2c   | `cli/enhancedConsole.ts` — fallback                                      | todo   |
| 2d   | `commandExecutor/commandServer.ts` — fallback                            | todo   |
| 2e   | `copilot-plugin/message-formatter.ts` — fallback                         | todo   |

### Phase 3 — Rich rendering _(after 1)_

| Item | Description                                                                                    | Status |
| ---- | ---------------------------------------------------------------------------------------------- | ------ |
| 3a   | `chat-ui/setContent.ts` blocks → HTML (table/badge/link/image/card/list/keyValue) + `chat.css` | todo   |
| 3b   | `vscode-chat/displayRender.ts` blocks → markdown                                               | todo   |

### Phase 4 — Interactivity _(after 3a)_

| Item | Description                                                                         | Status |
| ---- | ----------------------------------------------------------------------------------- | ------ |
| 4a   | Client-side sort/filter on `TableBlock` honoring `readonly`/`sortable`/`filterable` | todo   |

### Phase 5 — First adopter: github-cli _(after 1)_

| Item | Description                                                                        | Status |
| ---- | ---------------------------------------------------------------------------------- | ------ |
| 5a   | `prList` / `issueList` / `myPullRequests` / `searchRepos` → table blocks + rawData | todo   |
| 5b   | `dependabotAlerts` + contributors → table blocks                                   | todo   |
| 5c   | `repoView` → keyValue block                                                        | todo   |
| 5d   | Update handler unit tests                                                          | todo   |

### Phase 6 — Programmatic "or otherwise" _(after 1 + 5)_

| Item | Description                                                         | Status |
| ---- | ------------------------------------------------------------------- | ------ |
| 6a   | `commandExecutor` forwards `rawData` as MCP `structuredContent`     | todo   |
| 6b   | `taskflow` reads `rawData` directly (drop extractText+tryParseJson) | todo   |

## Open questions

| #   | Question                       | Resolution                                                |
| --- | ------------------------------ | --------------------------------------------------------- |
| 1   | `rawData` source-of-truth      | Lean: `fromRecords` helper emits table + rawData together |
| 2   | Image source policy            | Lean: URL / dataURI; agent rehydrates file paths          |
| 3   | Forward-compat for row-actions | Lean: reserve `cell.href` + `block.action` now            |
| 4   | Naming: `structured` vs `rich` | Lean: `structured`                                        |

## Notes

- `chat-ui/setContent.ts` is shared by Electron shell + vscode-shell
  webview + Chrome extension — one rich renderer, three clients.
- `vscode-chat` (chat participant) is a separate renderer and cannot be
  interactive (it emits into the Copilot chat stream).
- `commandExecutor` does not use MCP `structuredContent` today — Phase 6
  is greenfield.
