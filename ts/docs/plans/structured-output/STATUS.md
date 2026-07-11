# Structured Agent Output — Status & Backlog

Working tracker for the plan in [PLAN.md](./PLAN.md). Update whenever a
phase item is started, completed, or a follow-up surfaces. Keep entries
terse — one line per item where possible.

_Last updated: 2026-07-11 — Phase 2 (renderer safety net) implemented._

## Progress by phase

### Phase 1 — SDK foundation *(blocks everything)*

| Item | Description | Status |
| ---- | ----------- | ------ |
| 1a | `StructuredContent` + block types in `agentSdk/src/display.ts` | done |
| 1b | Builders: `createStructuredResult`, `createTable`, `fromRecords` | done |
| 1c | Fallback derivation: `structuredToMarkdown` / `structuredToText` / `getStructuredFallback` | done |
| 1d | Exports from `agentSdk/src/index.ts` | done |
| 1e | Unit tests (derivation + builders) | done |

### Phase 2 — Renderer safety net *(after 1)*

| Item | Description | Status |
| ---- | ----------- | ------ |
| 2a | `chat-ui/setContent.ts` — detect `"structured"`, use fallback (no throw) | done |
| 2b | `vscode-chat/displayRender.ts` — fallback | done |
| 2c | `cli/enhancedConsole.ts` — fallback | done |
| 2d | `commandExecutor/commandServer.ts` — fallback | done |
| 2e | `copilot-plugin/message-formatter.ts` — fallback | done |

### Phase 3 — Rich rendering *(after 1)*

| Item | Description | Status |
| ---- | ----------- | ------ |
| 3a | `chat-ui/setContent.ts` blocks → HTML (table/badge/link/image/card/list/keyValue) + `chat.css` | todo |
| 3b | `vscode-chat/displayRender.ts` blocks → markdown | todo |

### Phase 4 — Interactivity *(after 3a)*

| Item | Description | Status |
| ---- | ----------- | ------ |
| 4a | Client-side sort/filter on `TableBlock` honoring `readonly`/`sortable`/`filterable` | todo |

### Phase 5 — First adopter: github-cli *(after 1)*

| Item | Description | Status |
| ---- | ----------- | ------ |
| 5a | `prList` / `issueList` / `myPullRequests` / `searchRepos` → table blocks + rawData | todo |
| 5b | `dependabotAlerts` + contributors → table blocks | todo |
| 5c | `repoView` → keyValue block | todo |
| 5d | Update handler unit tests | todo |

### Phase 6 — Programmatic "or otherwise" *(after 1 + 5)*

| Item | Description | Status |
| ---- | ----------- | ------ |
| 6a | `commandExecutor` forwards `rawData` as MCP `structuredContent` | todo |
| 6b | `taskflow` reads `rawData` directly (drop extractText+tryParseJson) | todo |

## Open questions

| # | Question | Resolution |
| - | -------- | ---------- |
| 1 | `rawData` source-of-truth | Lean: `fromRecords` helper emits table + rawData together |
| 2 | Image source policy | Lean: URL / dataURI; agent rehydrates file paths |
| 3 | Forward-compat for row-actions | Lean: reserve `cell.href` + `block.action` now |
| 4 | Naming: `structured` vs `rich` | Lean: `structured` |

## Notes

- `chat-ui/setContent.ts` is shared by Electron shell + vscode-shell
  webview + Chrome extension — one rich renderer, three clients.
- `vscode-chat` (chat participant) is a separate renderer and cannot be
  interactive (it emits into the Copilot chat stream).
- `commandExecutor` does not use MCP `structuredContent` today — Phase 6
  is greenfield.
