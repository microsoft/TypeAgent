# Agents

Reference documentation for every **application agent** under
`ts/packages/agents/**`. Agents are the plugins the
[dispatcher](../architecture/core/dispatcher.md) routes typed actions to. Each one
exports an `instantiate(): AppAgent` function and implements the `AppAgent`
interface from `@typeagent/agent-sdk`.

Use the left-hand navigation to browse agents. As with packages, each agent's
hand-written README is shown as its **Overview** page, and its
`README.AUTOGEN.md` companion (when present) appears as a secondary
**Generated README** page — see [the doc-autogen guide](../contributing/doc-autogen.md).

## Understand the patterns first

Before reading individual agents (or building one), read
**[Agent patterns](../architecture/agents/agent-patterns.md)**. Every agent follows
one of nine patterns based on how it talks to external systems, whether it keeps
state, and what output it produces:

| Pattern                  | When to use                              | Examples                        |
| ------------------------ | ---------------------------------------- | ------------------------------- |
| `schema-grammar`         | Bounded set of typed actions (default)   | `weather`, `photo`, `list`      |
| `external-api`           | Authenticated REST / cloud API           | `calendar`, `email`, `player`   |
| `llm-streaming`          | Agent calls an LLM, streams results      | `chat`, `greeting`              |
| `sub-agent-orchestrator` | API surface too large for one schema     | `desktop`, `code`, `browser`    |
| `websocket-bridge`       | Automate a host app via a plugin         | `browser`, `code`               |
| `state-machine`          | Multi-phase workflow with approval gates | `onboarding`, `powershell`      |
| `native-platform`        | OS / device APIs, no cloud               | `androidMobile`, `playerLocal`  |
| `view-ui`                | Rich interactive web-view UI             | `turtle`, `montage`, `markdown` |
| `command-handler`        | Simple settings-style direct dispatch    | `settings`, `test`              |

## Anatomy of an agent

Each agent typically follows this layout:

```
packages/agents/<name>/src/
  <name>Manifest.json    # metadata, schema pointers, emoji
  <name>Schema.ts        # typed action/activity definitions
  <name>Schema.agr       # grammar rules (NL → structured actions)
  <name>ActionHandler.ts # implements instantiate(): AppAgent
```

The dispatcher calls `executeAction(action, context)` with already-validated,
typed actions — agents never parse natural language directly.

## Adding an agent

After scaffolding a new agent (often via the
[`onboarding`](../architecture/agents/agent-patterns.md) agent), regenerate the
navigation:

```bash
node ts/docs/scripts/build-wiki.mjs
```

See [Add an agent](../contributing/add-an-agent.md) for the full checklist.
