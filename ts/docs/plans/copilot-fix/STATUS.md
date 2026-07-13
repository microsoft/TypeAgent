# `@copilot fix` — Status

Tracks progress for the plan in [PLAN.md](./PLAN.md). Update as phases land.

Status: **Not started** (plan approved, implementation pending).

## Phase checklist

- [ ] **Phase 1 — Command + conversation assembly (dispatcher)**
  - [ ] `FixWithCopilotCommandHandler` added to `copilotCommandHandlers.ts`; `fix` subcommand registered.
  - [ ] Flags: `--mode`, `--no-screenshot`, `--dev-captures`, (`--target` reserved); optional trailing instructions.
  - [ ] `conversation.json` written from `displayLog.getEntries()`.
  - [ ] Dev-capture selection (developer mode + persistent session, correlated by `requestId`).
  - [ ] Prompt (`query`) composition.
- [ ] **Phase 2 — Copilot-launch action (code agent + Coda)**
  - [ ] `EditorActionLaunchCopilotChat` added to `editorCodeActionsSchema.ts` (+ rebuilt `.pas.json`).
  - [ ] `launchCopilotChat` handler in Coda → `workbench.action.chat.open`.
  - [ ] Older-build capability guard / fallback.
- [ ] **Phase 3 — Orchestrate + confirm**
  - [ ] `askYesNoWithContext` confirmation.
  - [ ] `executeActions` dispatch of `code.launchCopilotChat`.
  - [ ] Not-connected error handling.
- [ ] **Phase 4 — Verify**
  - [ ] Build + `prettier:fix`.
  - [ ] Unit tests (`agent-dispatcher`, `coda`).
  - [ ] Manual end-to-end in the VS Code shell.

## Notes / decisions log

- Conversation source is the **raw display log** (`displayLog.getEntries()`), not `conversationMemory`.
- Developer-mode `dev-captures` attached as supplementary JSON when available.
- Screenshot via native `attachScreenshot: true`; conversation/captures via `attachFiles`.
- Execution via the `code` agent + Coda bridge (frontend-agnostic); native Copilot in agent mode; pre-fill (no auto-submit); manual trigger.
