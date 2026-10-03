# @typeagent/agent-harness-hooks

Types for agent harness command hooks: the JSON payload a hook reads on stdin
and the JSON output it can write on stdout.

Copilot CLI hooks, from `@typeagent/agent-harness-hooks/copilot-cli`:

| Hook                  | Input                      | Output                      |
| --------------------- | -------------------------- | --------------------------- |
| `userPromptSubmitted` | `UserPromptSubmittedInput` | `UserPromptSubmittedOutput` |
| `sessionStart`        | `SessionStartInput`        | `SessionStartOutput`        |
| `agentStop`           | `AgentStopInput`           | `AgentStopOutput`           |
| `sessionEnd`          | `SessionEndInput`          | `SessionEndOutput`          |
| `preToolUse`          | `PreToolUseInput`          | `PreToolUseOutput`          |
| `postToolUse`         | `PostToolUseInput`         | `PostToolUseOutput`         |
| `postToolUseFailure`  | `PostToolUseFailureInput`  | `PostToolUseFailureOutput`  |
| `errorOccurred`       | `ErrorOccurredInput`       | `ErrorOccurredOutput`       |
| `subagentStart`       | `SubagentStartInput`       | `SubagentStartOutput`       |
| `subagentStop`        | `SubagentStopInput`        | `SubagentStopOutput`        |

```ts
import type { UserPromptSubmittedInput } from "@typeagent/agent-harness-hooks/copilot-cli";
```

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
