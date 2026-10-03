# @typeagent/memory-mcp-server

`memory_procedure_save` accepts optional schema-v1 `document.agentEdition`,
`reviewAgentEdition`, and `safetyConfirmed`. Schemas preserve both human and
agent sections and use shared pure edition validation. Review requires
explicit intent for the resulting exact procedure version; incoming model
review stamps are not trusted. Real catalog validation remains the injected
memory service/host's responsibility. Missing catalog resolvers fail review
explicitly, and no MCP operation executes runbook commands or bindings.

Catalog argument maps preserve nested `{"$input":"declared-input-id"}`
references and `{"$literal": JSON}` escapes. Shared validation enforces bounded
finite JSON and declared references before recursive wire parsing. The injected
host must validate actual target schemas, including required parameters for
omitted arguments, and explicitly attest argument fit; an identity-only catalog
check cannot bless a reviewed runbook. Secret values are not resolved or retained
as input defaults/examples.

The explicit `memory_runbook_synthesis_request` tool takes only
`{corpusId,sourceId,revisionId}` and invokes the optional existing durable draft
pipeline. It can reuse pending/completed results without claiming fresh output
or overwriting human edits. Poll with `memory_runbook_job_get` or
`memory_runbook_jobs_list`; failed model jobs retain explicit state/reason.
Unsupported implementations return tool errors. These tools require no model
keys for offline fixture verification and confer no execution/approval permission.
The golden-set numerical quality gate remains separate and open.
Source revisions preserve asset metadata. Raw asset upload is host-only and
rejected by ingestion schemas until an explicit bounded wire contract exists.

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

Personal how-to tools cover optimistic settings updates, procedure candidate
create/get/list/reject, and immutable procedure save/get/list/search/archive.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
