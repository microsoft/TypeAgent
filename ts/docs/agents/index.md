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

## Adding an agent

Building a new application agent? Start with
[Build an agent](../guides/build-an-agent/index.md) - the canonical guide for
picking a pattern, scaffolding (often via the `onboarding` agent), defining
actions and grammar, and distributing your agent. The
[Echo tutorial](../guides/build-an-agent/tutorial-echo.md) is a concrete
standalone-package walkthrough if you'd rather start with working code.

An agent does not need to live in this repo. Standalone agents in their own
packages can be surfaced via `@package install` from a local path, catalog,
or feed - see [Agent install sources](../architecture/lifecycle/agent-sources.md).

If the agent **does** live in this repo under `ts/packages/agents/**`, its
README shows up in the navigation above once you regenerate the wiki:

```bash
node ts/docs/scripts/build-wiki.mjs
```

See [Add an agent](../contributing/add-an-agent.md) for the full
wiki-registration checklist.
