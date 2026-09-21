# TypeAgent memory agent

`@typeagent/memory-agent` is the first-party AppAgent for the durable
`@typeagent/memory-service`. The host must inject either a `MemoryService`
directly as `AppAgentInitSettings.options`, or an options object containing
`{ memoryServiceClient: MemoryService }`. This package does not create or own
a memory store.

## Role and relationship to the MCP server

The memory agent and `@typeagent/memory-mcp-server` are two interfaces to the
same memory service, not separate memory implementations.

- The **memory service** owns durable storage, extraction, chunking, indexing,
  revisions, search, grounded answers, job state, correction, and forgetting.
- The **MCP server** exposes those service operations to external MCP clients,
  including editors, agents, and remote or out-of-process integrations.
- The **first-party memory agent** provides a TypeAgent-native UX over the same
  operations: `@memory` commands, command completion, active-corpus session
  state, confirmation flows, result presentation, and natural-language action
  routing.

The first-party agent normally uses an injected in-process service facade. It
does not need to call the MCP endpoint or pay an additional HTTP and MCP
serialization cost. External clients use the MCP server to reach the same
underlying implementation.

Most agent commands correspond directly to operations that are also available
through MCP. The important host-specific capability is local folder import.
The trusted TypeAgent host enumerates and validates local paths, reads Markdown
files, and submits their content to the memory service. The MCP server remains
content-oriented and does not receive arbitrary paths or require access to a
client's filesystem. Another trusted MCP client can implement the same workflow
by enumerating its local files and calling document ingestion for each one.

The intended deployment is:

```text
TypeAgent user -> native @memory agent -> injected MemoryService
External client -> memory MCP server   -> the same MemoryService
```

When the native agent is available, the dynamically generated MCP agent should
not also be presented as a second user-facing memory agent by default. Doing so
would create duplicate routing choices and inconsistent UX. The MCP endpoint
should remain available for interoperability, while `@memory` is the preferred
TypeAgent interaction surface.

The agent must not independently implement knowledge extraction, indexing,
revision semantics, retrieval ranking, deletion cleanup, or durable job state.
Those behaviors belong in the memory service so native and MCP clients remain
consistent.

The active corpus is session state and is restored from `sessionStorage` when
available. Select one by ID or name with `@memory corpus use <corpus>` before
running corpus-scoped commands. Confirmation tokens are never persisted.

## Commands

- `@memory corpus create|list|use|info|clear`
- `@memory import file|folder|status|cancel`
- `@memory sources list|show|knowledge|replace|forget`
- `@memory search`, `@memory ask`, `@memory explain`
- `@memory jobs list|show|cancel`
- `@memory reindex`, `@memory status`

Corpus clearing, source replacement, and source forgetting use a preview token.
Run the command once, inspect the preview, then repeat it with `--confirm
<token>`. Tokens expire after five minutes; replacement confirmation also fails
if the source revision or file content changed.

## Markdown import

Imports accept absolute paths or paths relative to the host working directory.
Folder import is non-recursive unless `--recursive` is supplied. `--include`
and `--exclude` are repeatable globs over root-relative paths. Defaults are
1,000 files, 50 MiB total, and four concurrent ingestion requests; lower limits
can be supplied with `--maxFiles`, `--maxBytes`, and `--concurrency`.

Every candidate is checked after `realpath`. A symlink or junction that resolves
outside the import root is reported as a per-file error, and linked directories
are not traversed. Source IDs are stable SHA-256 IDs derived from the real root
and normalized relative path. The batch manifest records every accepted file
and exact per-file failure. Batch status aggregates the current durable job
states, so a batch remains running while accepted jobs are indexing. `--wait`
also waits for terminal service job states before the import command returns.

`ask` calls `MemoryService.answer` and renders its grounded extractive answer
with citation metadata. `explain` shows the answer and citations retained from
the latest session answer.

## Host setup

```ts
const agent = instantiate();
const agentContext = await agent.initializeAgentContext?.({
  options: memoryService,
});

// agent-server option shape
const serverAgentContext = await agent.initializeAgentContext?.({
  options: { memoryServiceClient: memoryService },
});
```

The injected service remains host-owned and is not closed by the agent.
