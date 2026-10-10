# @typeagent/memory-mcp-server

Typed derived View tools expose explicit builds, drafts, exact revision history, guarded edits/conflict resolution, publication, maintenance and search. Source acquisition and revision assets remain independent evidence capabilities. Ingestion does not detect candidates or start synthesis jobs, and no tool grants review or execution permission.

Views are enabled by default. `TYPEAGENT_MEMORY_VIEW_DRAFTS=false` explicitly disables them; unset or `true` requires no user opt-in, and invalid values fail. Missing or unavailable model providers surface build errors without creating successful artifacts or bypassing validation.

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

MCP transport adapter for the TypeAgent memory service. It exposes the complete
typed ingestion, search, synthesized or extractive grounded answers
(`answerMode`), status, pagination,
bounded content, derived knowledge, revision replacement, preview/confirm
deletion, reindex, and filtered job management surface. Destructive tools are
annotated accordingly.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
