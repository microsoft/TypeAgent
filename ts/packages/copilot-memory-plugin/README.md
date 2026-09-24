# Copilot memory plugin

This is milestone 0 conversation memory for Copilot CLI. It uses
`@typeagent/conversation-memory`, the package that provides the dispatcher's
`queueAddMessage`, `addMessage`, and `getAnswerFromLanguage` functions.

The plugin keeps one store per git workspace under
`~/.typeagent/copilot-memory/`. Set `TYPEAGENT_MEMORY_DIR` to change the path.

| Behavior                 | Surface                                                      |
| ------------------------ | ------------------------------------------------------------ |
| Implicit request capture | `userPromptSubmitted` → `queueAddMessage`                    |
| Implicit result capture  | `agentStop` → `queueAddMessage`                              |
| Explicit save            | MCP `remember` → `addMessage`                                |
| Recall                   | MCP `recall`, and prompt injection → `getAnswerFromLanguage` |

Recall is single-conversation. The host cross-conversation index is not part of
this milestone.

Copilot CLI drops command-hook output from `userPromptSubmitted`, so that hook
only captures the prompt. Recall runs in `userPromptTransformed`. Copilot sends
`modifiedTransformedPrompt` from that hook to the model.

## Build and install

From `ts/`:

```bash
pnpm run build @typeagent/copilot-memory-plugin
pnpm --filter @typeagent/copilot-memory-plugin test
pnpm --filter @typeagent/copilot-memory-plugin register
copilot plugin list
```

Knowledge extraction and recall use the same model config as TypeAgent in
`ts/config.local.yaml`. If extraction fails, the plugin still stores the turn
text so later recall can search it.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
