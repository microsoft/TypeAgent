# AGENTS.md — Onboarding Agent

This document is for AI agents (Claude Code, GitHub Copilot, etc.) working with the onboarding agent codebase.

## What this agent does

The onboarding agent automates integrating a new application or API into TypeAgent. It is itself a TypeAgent agent, so its actions are available to AI orchestrators via TypeAgent's MCP interface using `list_commands`.

## Agent structure

```
src/
  onboardingManifest.json       ← main manifest, declares 7 sub-action manifests
  onboardingSchema.ts           ← top-level coordination actions
  onboardingSchema.agr          ← grammar for top-level actions
  onboardingActionHandler.ts    ← instantiate(); routes all actions to phase handlers
  lib/
    workspace.ts                ← read/write per-integration state on disk
    llm.ts                      ← aiclient ChatModel factories per phase
  discovery/                    ← Phase 1: API surface enumeration
  phraseGen/                    ← Phase 2: natural language phrase generation
  schemaGen/                    ← Phase 3: TypeScript action schema generation
  grammarGen/                   ← Phase 4: .agr grammar generation
  scaffolder/                   ← Phase 5: agent package scaffolding
  testing/                      ← Phase 6: phrase→action test loop
  packaging/                    ← Phase 7: packaging and distribution
```

## How actions are routed

`onboardingActionHandler.ts` exports `instantiate()` which returns a single `AppAgent`. The `executeAction` method receives all actions (from main schema and all sub-schemas) and dispatches by `action.actionName` to the appropriate phase handler module.

## Workspace state

All artifacts are persisted at `~/.typeagent/onboarding/<integration-name>/`. The `workspace.ts` lib provides:

- `createWorkspace(config)` — initialize a new integration workspace
- `loadState(name)` — load current phase state
- `saveState(state)` — persist state
- `updatePhase(name, phase, update)` — update phase status; automatically advances `currentPhase` on approval
- `readArtifact(name, phase, filename)` — read a phase artifact
- `writeArtifact(name, phase, filename, content)` — write a phase artifact
- `listIntegrations()` — list all integration workspaces

## LLM usage

Each phase that requires LLM calls uses `aiclient`'s `createChatModelDefault(tag)`. Tags are namespaced as `onboarding:<phase>` (e.g. `onboarding:schemagen`). This follows the standard TypeAgent pattern — credentials come from `ts/.env`.

## Phase approval model

Each phase has a status: `pending → in-progress → approved`. An `approve*` action locks artifacts and advances to the next phase. The AI orchestrator is expected to review artifacts before calling approve — this is the human-in-the-loop checkpoint.

## Adding a new phase

1. Create `src/<phaseName>/` with `*Schema.ts`, `*Schema.agr`, `*Handler.ts`
2. Add the sub-action manifest entry to `onboardingManifest.json`
3. Add `asc:*` and `agc:*` build scripts to `package.json`
4. Import and wire up the handler in `onboardingActionHandler.ts`
5. Add the phase to the `OnboardingPhase` type and `phases` object in `workspace.ts`

## Adding a new tool to an existing phase

1. Add the action type to the phase's `*Schema.ts`
2. Add grammar patterns to the phase's `*Schema.agr`
3. Implement the handler case in the phase's `*Handler.ts`

## Key dependencies

- `@typeagent/agent-sdk` — `AppAgent`, `ActionContext`, `TypeAgentAction`, `ActionResult`
- `@typeagent/agent-sdk/helpers/action` — `createActionResultFromTextDisplay`, `createActionResultFromMarkdownDisplay`
- `aiclient` — `createChatModelDefault`, `ChatModel`
- `typechat` — `createJsonTranslator` for structured LLM output

## Scaffolder — choosing a pattern

The scaffolder (Phase 5) generates pattern-appropriate boilerplate. Before calling `scaffoldAgent`, determine which pattern fits the integration being onboarded. The discovery phase artifacts should give you enough information to decide.

**Decision guide**

| Signal from discovery                                                    | Pattern to use             |
| ------------------------------------------------------------------------ | -------------------------- |
| Integration streams text (chat, code gen, summarization)                 | `llm-streaming`            |
| Integration is a desktop/browser/Electron app with a JS runtime          | `websocket-bridge`         |
| Integration is a long-running, multi-step process needing human sign-off | `state-machine`            |
| API surface has 5+ distinct domains (e.g., files + calendar + mail)      | `sub-agent-orchestrator`   |
| Integration needs a custom interactive UI                                | `view-ui`                  |
| Integration has an authenticated REST or OAuth API                       | `external-api`             |
| Integration is a CLI tool, mobile device, or OS service                  | `native-platform`          |
| Integration has only a few toggle/config actions                         | `command-handler`          |
| None of the above                                                        | `schema-grammar` (default) |

**Scaffold with a pattern**

```
scaffold the <name> agent using the <pattern> pattern
```

**List all patterns**

```
list agent patterns
```

Full pattern reference (file layouts, manifest flags, example code) is in
[docs/architecture/agent-patterns.md](../../../../docs/architecture/agent-patterns.md).

**What the scaffolder generates per pattern**

- `schema-grammar` — manifest, handler, schema, grammar, tsconfigs, package.json
- `external-api` — above + `*Bridge.ts` with an API client class stub; adds `aiclient` dependency
- `llm-streaming` — above + `injected: true / cached: false / streamingActions` in manifest; adds `aiclient` + `typechat` dependencies
- `sub-agent-orchestrator` — above + `actions/` directory with per-group schema and grammar stubs; `subActionManifests` in manifest
- `websocket-bridge` — above + `*Bridge.ts` with a `WebSocketServer` + pending-request map; adds `ws` dependency
- `state-machine` — above + state type definitions and `loadState` / `saveState` helpers
- `native-platform` — above + `child_process` / platform-branching boilerplate
- `view-ui` — above + `openLocalView` / `closeLocalView` lifecycle; `localView: true` in manifest
- `command-handler` — replaces `executeAction` dispatch with a named `handlers` map

## Testing

Run phrase→action tests with the `runTests` action after completing the testing phase setup. Results are saved to `~/.typeagent/onboarding/<name>/testing/results.json`. The `proposeRepair` action uses an LLM to suggest schema/grammar fixes for failing tests.
