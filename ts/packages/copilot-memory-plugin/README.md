# Copilot memory plugin

Milestone 0 conversation memory for Copilot CLI. It wraps
`@typeagent/conversation-memory` — the same `queueAddMessage`, `addMessage`,
and `getAnswerFromLanguage` the dispatcher uses. One store per git workspace,
persisted under `~/.typeagent/copilot-memory/` (override with
`TYPEAGENT_MEMORY_DIR`).

| Behavior                 | Surface                                                      |
| ------------------------ | ------------------------------------------------------------ |
| Implicit request capture | `userPromptSubmitted` → `queueAddMessage`                    |
| Implicit result capture  | `agentStop` → `queueAddMessage`                              |
| Explicit save            | MCP `remember` → `addMessage`                                |
| Recall                   | MCP `recall`, and prompt injection → `getAnswerFromLanguage` |

Recall is single-conversation. The host cross-conversation index is not part of
this milestone.

Copilot CLI drops command-hook output from `userPromptSubmitted`. The plugin
still returns `additionalContext` there, and also registers
`userPromptTransformed` so `modifiedTransformedPrompt` reaches the model.

```bash
cd ts
pnpm --filter @typeagent/copilot-memory-plugin build
pnpm --filter @typeagent/copilot-memory-plugin test
node packages/copilot-memory-plugin/scripts/install-plugin.mjs
```

Knowledge extraction and recall need the same model config as the rest of
TypeAgent (`ts/config.local.yaml`). If extraction fails, the turn text is still
stored so later recall can search it.
