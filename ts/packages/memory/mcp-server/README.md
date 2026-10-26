# @typeagent/memory-mcp-server

Supporting hosts expose `memory_graph_query` and `memory_graph_support` for
bounded document/event graph projections and exact provenance pages. Tool
registration follows the host's actual graph capability. Responses include
coverage states, counts, budgets and generation-bound continuations; graph reads
do not silently build an index or imply checkpoint readiness. Summary inventory
tools provide paginated view/build metadata and batched publication status.

MCP tools for importing content, searching sources, answering questions with
citations, and managing memory. The server calls `MemoryService`; it does not
implement a separate memory store or retrieval engine. Destructive tools use
preview and confirmation and are annotated accordingly.

## Views and maintenance

View tools build documents, read exact revisions and history, save guarded edits,
resolve conflicts, publish, maintain and search derived content. Source
acquisition and revision assets are managed separately. When informational support
is enabled, committed index changes can schedule automatic Wiki, Projects and
Topics maintenance. Importing instructions does not turn them into executable
procedures.

Views are enabled by default. Set `TYPEAGENT_MEMORY_VIEW_DRAFTS=false` to disable
them. Invalid values cause an error. If a required model provider is unavailable,
the build reports an error instead of saving a successful artifact.

See [Current system](../../../docs/architecture/memory/current-system.md) for
host setup and [View maintenance](../../../docs/architecture/memory/view-maintenance.md)
for refresh behavior.

## Tool details

Schema-defined Views round-trip through generic View tools. The bounded tools
`memory_questions_list`, `memory_question_edit`, `memory_view_page`,
`memory_schema_view_propose` and `memory_schema_questions_discover` expose the
question inventory, guarded review, deterministic pages and explicit authoring.
Proposals are not facts: approve slots explicitly and configure finite discovery
before requesting discovery.

`memory_acquisitions_list`, `memory_acquisitions_run` and
`memory_acquisition_cancel` expose sanitized acquisition progress and explicit
run/cancel controls. They omit staged content, outbound arguments, host
authority and raw request errors. No acquisition admission or periodic-scheduler
tool is registered. Unsupported or disabled capabilities fail explicitly.

The loopback HTTP host uses a fresh connection per stateless MCP request.
Tool-catalog validation in SDK clients can synchronously outlast the HTTP
keep-alive window; explicit connection closure prevents the next request from
reusing an expired pooled socket. Tool schemas and output validation remain
enabled.

Agent-session import is opt-in and separate from ordinary ingestion:

- `memory_agent_session_import`: explicit session ID, import type
  (`agent-session-jsonl` or `copilot-session-jsonl`), idempotency key,
  expected cursor, bounded JSONL content, optional scope, and final flag.
- `memory_agent_session_get`: receipt or `null` for an unknown session.
- `memory_agent_session_cancel`: explicit session cancellation receipt.
- `memory_agent_memory_search`: scoped diagnostic memories with complete
  evidence metadata and warnings.

No tool opens local paths. Chunks are at most 512 KiB UTF-8 and 1,000 lines;
send them sequentially, polling each running receipt before advancing
`expectedCursor`. Retry lost responses with the identical request and key.
Unsupported service capabilities return tool errors, not empty success.
Native local file submission is available through `@memory import session`.

`memory_view_source_usage` returns paginated metadata for current derived Views
that depend on a document source. It never enumerates legacy procedures,
canonical event-ID matches, or historical-only View dependencies.

`memory_changes_list` exposes canonical `MemoryService.listChanges` with
`corpusId`, optional `pageSize` (1-200), and `continuationToken`. Results are
metadata-only committed receipts retained for 90 days. Unsupported services
return a tool error, not an empty success. This read-only tool never persists
its own history or source content.

`memory_search` accepts optional ISO `dateFrom` and `dateTo` timestamps.
Canonical search validates ordered ranges and filters active capture dates
before its result limit. Unknown capture dates are excluded, indexing dates
are never substituted, and bounded-candidate incompleteness warnings are
returned unchanged.

Answer tools support synthesized answers and extractive snippets through
`answerMode`. Other tools expose ingestion status, paginated content and
knowledge reads, revision replacement, reindexing, and filtered job management.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
