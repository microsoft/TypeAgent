# TypeAgent Explore MCP

A stdio MCP server exposing exactly one tool, `explore`. Each call goes through
a bounded TypeAgent reasoning loop with one generic `execute_action` tool. The
host discovers the typed Explorer AppAgent schema through the session-bound
TypeAgent dispatcher before reasoning, then supplies that authoritative schema
to the loop. The loop executes `explorer.discoverRepository`,
`explorer.refineRepository`, and `explorer.submitExploration` as validated typed
actions through the dispatcher. MCP input maps directly to this loop; there is
no redundant natural-language translation request. Generated Code Mode programs
use the canonical `@typeagent/agent-flows` validator and executor and can call
four read-only repository operations, plus optional LSP navigation. Unused
semantic schema embeddings are disabled, and the reasoning layer hard-stops
after eight `execute_action`
attempts with at most three successful actions:

- `ls`
- `glob`
- `grep`
- `read`
- `lsp` (only when enabled)

One outer `explore` invocation may run two programs, but both use the same
repository snapshot, observations, and default budget of eight internal calls.

Gitignore, secret, binary, oversized-file, traversal, and symlink filters are
applied by the repository tools. The canonical validator rejects forbidden
identifiers, dangerous property access, and dynamic imports before execution.
The canonical executor runs in the MCP process, so its timeout applies to
asynchronous execution and does not provide process isolation or a memory boundary.

## Build and test

From `ts/`:

```bash
pnpm --filter explorer-typeagent build
pnpm --filter typeagent-explore-mcp build
pnpm --filter explorer-typeagent test
pnpm --filter typeagent-explore-mcp test
```

## Server configuration

The Luna, Terra, or Sol LiteLLM route and OpenAI-compatible base URL are
required. The API key is passed by environment-variable name, never as an
argument.

```bash
node packages/mcp/explore/dist/server.js \
  --repo /absolute/path/to/repository \
  --model azure/gpt-5.6-luna \
  --base-url http://127.0.0.1:4627/v1 \
  --api-key-env LITELLM_API_KEY \
  --max-tool-calls 8
```

Enable symbol-based definition/reference navigation after preparing the pinned
Python environment:

```bash
uv sync --project packages/mcp/explore/python-lsp --frozen

node packages/mcp/explore/dist/server.js \
  --repo /absolute/path/to/repository \
  --model azure/gpt-5.6-luna \
  --base-url http://127.0.0.1:4627/v1 \
  --api-key-env LITELLM_API_KEY \
  --max-tool-calls 8 \
  --enable-lsp \
  --python-lsp-command packages/mcp/explore/python-lsp/.venv/bin/pylsp
```

The TypeScript language server is a pinned dependency of `explorer-typeagent`.
The all-language registry otherwise launches only servers already installed on
`PATH`, unless a command is explicitly overridden. It performs no runtime
downloads. LSP calls share the normal eight-call budget, and their locations
must be read before the agent may submit them as grounded citations.

Supported flags and environment fallbacks:

| Flag                       | Environment fallback               |                                         Required |
| -------------------------- | ---------------------------------- | -----------------------------------------------: |
| `--repo`                   | `TYPEAGENT_EXPLORE_ROOT`           |                              No; defaults to cwd |
| `--model`                  | `TYPEAGENT_EXPLORE_MODEL`          |                                              Yes |
| `--base-url`               | `TYPEAGENT_EXPLORE_BASE_URL`       |                                              Yes |
| `--api-key-env`            | `TYPEAGENT_EXPLORE_API_KEY_ENV`    |        No; defaults to `CUSTOM_PROVIDER_API_KEY` |
| `--max-tool-calls`         | None                               |                                No; defaults to 8 |
| `--telemetry-file`         | `TYPEAGENT_EXPLORE_TELEMETRY_FILE` |                                               No |
| `--enable-lsp`             | None                               |                       No; enables LSP navigation |
| `--python-lsp-command`     | None                               |                          No; defaults to `pylsp` |
| `--python-lsp-arg`         | None                               |            No; repeatable Python server argument |
| `--typescript-lsp-command` | None                               |          No; uses the pinned server when omitted |
| `--typescript-lsp-arg`     | None                               |        No; repeatable TypeScript server argument |
| `--lsp-server-command`     | None                               |  No; repeatable `<server-id>=<command>` override |
| `--lsp-server-arg`         | None                               | No; repeatable `<server-id>=<argument>` override |
| `--disable-lsp-server`     | None                               |     No; repeatable built-in server ID to disable |

When configured, the schema-v4 telemetry file is written atomically after every
call. Its invocation ledger preserves every concurrent call in start order, with
one non-double-counted usage bucket for the inner completions that both translate
the current state into typed actions and generate Code Mode programs, bounded
repository-tool traces, typed-action attempts, completion status, and location
counts. It does not contain the API key or repository file contents.

## Tool contract

```json
{
  "name": "explore",
  "arguments": {
    "query": "where is request authentication handled?",
    "maxResults": 6
  }
}
```

`maxResults` is optional and bounded to 1–6. The result is compact,
repository-relative `path:line` evidence for the outer coding agent.

## Claude Code

Add a project `.mcp.json` and replace the paths and credential name. The value
is expanded from the environment when Claude Code launches the server.

```json
{
  "mcpServers": {
    "typeagent-explore": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/typeagent/ts/packages/mcp/explore/dist/server.js",
        "--repo",
        "/absolute/path/to/repository",
        "--model",
        "azure/gpt-5.6-luna",
        "--base-url",
        "http://127.0.0.1:4627/v1",
        "--api-key-env",
        "MODEL_KEY"
      ],
      "env": {
        "MODEL_KEY": "${LITELLM_API_KEY}"
      }
    }
  }
}
```

The inner reasoning adapter accepts only the Luna, Terra, and Sol routes. The
benchmark remains the separate `packages/exploreBench` workspace package.

## GitHub Copilot SDK

`packages/exploreBench` passes this server through the SDK's native
`mcpServers` session configuration. It preflights that the server is running
and advertises only `explore`, then verifies one started and successfully
completed MCP invocation from Copilot's tool events.
