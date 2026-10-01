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

The dynamically generated `@memory-mcp` agent is intentionally registered next
to native `@memory`. This is a design decision, not an oversight: together with
the Copilot CLI memory plugin (which has its own store and is deliberately not
connected to the durable service), it is one arm of an experiment to learn
which path makes an externally consumable MCP package easier to build and
support. Native `@memory` remains the preferred TypeAgent interaction surface;
do not remove or hide either agent until the experiment concludes.

The agent must not independently implement knowledge extraction, indexing,
revision semantics, retrieval ranking, deletion cleanup, or durable job state.
Those behaviors belong in the memory service so native and MCP clients remain
consistent.

The active corpus and import batch manifests are session state and are restored
from `sessionStorage` when available. Durable job IDs are stored with each
batch, allowing status and cancellation to continue after agent recreation.
In-process cancellation handles are never persisted. Select a corpus by ID or
name with `@memory corpus use <corpus>` before running corpus-scoped commands.
Confirmation tokens are never persisted.

Closing an agent instance stops its local file submission work but does not
cancel already accepted service jobs. Use `@memory import cancel <batchId>` to
cancel those durable jobs explicitly.

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

Imports use the model-driven `content` pipeline with 8,000-character chunks.
The effective pipeline is stored with the batch and included in restored status
output. There are no import profiles or alternate processing modes.
Pre-release version 1 batch state is rejected explicitly rather than migrated;
new batches use version 2. Accepted service jobs remain managed by the service.

Every candidate is checked after `realpath`. A symlink or junction that resolves
outside the import root is reported as a per-file error, and linked directories
are not traversed. Source IDs are stable SHA-256 IDs derived from the real root
and normalized relative path. The batch manifest records every accepted file
and exact per-file failure. Batch status aggregates the current durable job
states, so a batch remains running while accepted jobs are indexing. Restored
batches reconstruct their current state from those jobs. `--wait` also waits
for terminal service job states before the import command returns.

`ask` calls `MemoryService.answer`, which by default synthesizes the answer with
KnowPro's answer generator over the retrieved evidence, and renders it with
citation metadata. `ask --extractive` returns the ranked evidence snippets
verbatim. `explain` shows the answer and citations retained from
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

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
