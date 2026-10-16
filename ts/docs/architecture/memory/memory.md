# Memory architecture

TypeAgent memory supports two user tasks: **recall evidence for a question**
and **maintain useful documents as evidence changes**. A durable memory service
retains sources and typed events, KnowPro extracts queryable structure, and
editable derived Views organize selected evidence without replacing it.

This page explains the architecture. The [current-system map](current-system.md)
records implementation boundaries; availability is not a claim of live-model
quality or production qualification.

## System model

![Sources feed shared retained evidence and a KnowPro index. Query-time recall serves Chat/Search and agents/MCP clients; view builders produce maintained documents. A separate optional branch represents reviewed skills or macros.](diagrams/memory-overview.svg)

[Full-size SVG](diagrams/memory-overview.svg)

Read left to right: **Sources -> Shared memory -> Processing paths -> Consumers**.
The diagram is conceptual, not a deployment map or connector inventory.
Its Procedures source means retained instructional material, not a saved-procedure
service. The optional **Skills/Macros** branch is outside the current memory
service: publication does not package, approve, activate or authorize execution.
The generic builder summary is expanded into two construction families below;
Wiki/Projects do not require exhaustive full-source inventory.

### Evidence, index and editable knowledge

| Representation                    | Responsibility                                                                                                               | Important boundary                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Retained sources and typed events | Identity, exact revisions, provenance, correction/suppression and forgetting                                                 | Retaining a user assertion or hypothesis does not make it true            |
| KnowPro index                     | Extracted entities, topics, actions, typed relationships, postings and retrieval                                             | Derived and rebuildable; a graph sketch does not imply a graph database   |
| Editable Views                    | Wiki pages, project briefs, timelines and troubleshooting guides with citations, generated bases, explicit edits and history | Generated content is not independent corroboration or execution authority |
| Navigation projections            | Maintained Topics and revision-bound source synopses                                                                         | Useful for browsing; not substitutes for original citation evidence       |

### Two processing paths

**Recall** interprets a question at runtime, retrieves supporting passages, and
returns snippets or a cited answer. Source search works independently of View
construction. An answer may later be retained as conversation evidence; recall
is request-time work, not a guarantee of zero persistent state.

**View construction** builds reusable, versioned documents. Wiki and Projects
discover subjects and retrieve bounded indexed fragments. Timeline and
troubleshooting builders retain a full-evidence inventory/checking path over
their selected inputs. Both preserve exact evidence identities, recheck
eligibility before committing, and retain explicit human edits or expose conflicts.
See [Derived Views](derived-views.md).

## Views by audience

| Reader                                    | Start here                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Maintainer or integration author          | [Current system](current-system.md)                                                                                      |
| View lifecycle or citation author         | [Derived Views](derived-views.md)                                                                                        |
| Maintenance or editorial author           | [View maintenance](view-maintenance.md)                                                                                  |
| Product engineer, evaluator or demo owner | [Memory scenarios](scenarios.md)                                                                                         |
| Release planner                           | [Implementation evidence ledger](https://github.com/microsoft/TypeAgent/blob/main/ts/docs/plans/memory-system/STATUS.md) |
| Structured RAG reader                     | [Structured RAG](#structured-rag) below                                                                                  |

## Current capabilities

### Conversation recall and discovery

In service-backed hosts, conversation memory is the profile event ledger.
The dispatcher records typed turns/evidence/outcomes with authority labels.
`@conversation find` locates names; `search`, `summarize` and historical `index`
use the conversation service. Historical backfill imports user turns.

Reasoning `search_memory` combines conversation recall and saved-document
search. Do not infer a saved-procedure or derived-View search branch from
service capabilities. The no-service legacy path and the separate workspace
Copilot memory plugin remain explicit exceptions; see [Current system](current-system.md#conversation-memory).

### Managed document memory

Native `@memory`, browser clients and MCP use the service's corpus, source,
revision, ingestion job, search, answer and management contracts. Native local
folder import validates host paths before submitting content; MCP is
content-oriented rather than an arbitrary client-filesystem reader.

There is one model-driven `content` pipeline, not fast/balanced/deep presets.
`ask` synthesizes from retrieved evidence; `--extractive` returns snippets.
The configured answer path is described in
[Search and answer semantics](current-system.md#search-and-answer-semantics).

### Browser and web-activity memory

The browser captures normalized page content and records visit/bookmark/capture/
import activity separately. The Memory Hub exposes sources, revisions, knowledge,
jobs, Views, Topics, editorial controls and source management. Source acquisition
and revision assets are evidence capabilities, not procedure authoring.

<a id="procedural-memory"></a>

### Derived knowledge, not a saved-procedure store

The service exposes the four derived View kinds and their build, draft, history,
maintenance, conflict, publication and search operations. It no longer exposes
saved-procedure detection, CRUD, retrieval or promotion. Instruction-document
and AgentEdition helpers remain available to independent artifact consumers;
their existence does not create a procedure service.

## Enablement and maturity

Views and informational Wiki/Projects are enabled by default in configured
hosts. `TYPEAGENT_MEMORY_VIEW_DRAFTS=false` disables Views;
`TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS=false` disables informational maintenance.
Missing providers and invalid settings fail explicitly, not with fabricated
successful artifacts.

Source indexing, generated-document quality, UI acceptance and release readiness
are different checks. Implementation and offline tests do not certify arbitrary
corpora. Consult the dated [evidence ledger](https://github.com/microsoft/TypeAgent/blob/main/ts/docs/plans/memory-system/STATUS.md)
instead of treating a default or historical trial as acceptance.

## Storage and ownership

One local owner manages the profile store. Sources/events are retained evidence;
KnowPro indexes are derived. Editable View content, generated bases, conflicts,
maintenance records and Topics state use the existing per-corpus View store and
private Git history, not the product repository or a second source store.

Source replacement, suppression and forgetting constrain current reads and
late model writes. Authorized forgetting removes dependent local state and
withholds reads until cleanup completes. It does not erase external exports,
backups or physical media remnants. See [History and forgetting](derived-views.md#history-and-forgetting).

## Known boundaries

- Extraction, question interpretation and synthesis can lose or misread context.
- A valid typed query is not proof of correct user intent; a resolvable citation
  is not proof that its passage supports the generated claim.
- Bounded Wiki/Projects output is not exhaustive coverage of a collection.
- Published and derivative-index-ready are distinct states.
- Human editorial protection is not approval; privacy removal overrides it.
- Topic/graph association does not establish project or entity equivalence.
- Remote synchronization, distributed ownership and enterprise governance are
  not implied by the local service.

## Structured RAG

KnowPro pairs extracted structure with runtime query interpretation:

1. Extract entities, actions, facets, topics and source ranges from content.
2. Index terms and semantic references that resolve back to original passages.
3. Translate a natural-language question to a schema-validated query at runtime.
4. Apply scopes, structured matching, ranking and configured related-term or
   embedding-backed retrieval within KnowPro.
5. Read relevant evidence and return snippets or synthesize a cited answer.

For example, "Who rejected scaling, and why?" can constrain actor/action matching
and then read the original passage for the reason. If extraction lost the
rejection, translation chose only a general topic, or synthesis omitted the
reason, the answer can still fail.

Structure enables inspectable constraints; it does not establish universal
accuracy, latency, cost or retention superiority over vector retrieval.
Related-term embeddings can participate in structured retrieval, not only a
final fallback. Compare equivalent evidence, workloads and questions when
measuring approaches.

## Implementations and interfaces

- [KnowPro](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/knowPro):
  extraction, indexes and search primitives.
- [Memory service](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/memory/service):
  durable evidence, management, derived Views and maintenance.
- [Memory MCP server](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/memory/mcp-server):
  typed external transport over a service.
- [Memory agent](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents/memory):
  native commands and local import over the injected service.
- [Conversation memory](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/memory/conversation):
  KnowPro-based library; distinguish library consumers from service-backed events.

## Demos

The [one-minute Structured RAG demonstration](https://youtu.be/jTHOt4O7YuM)
and [ninety-second agent-memory demonstration](https://youtu.be/CWgrAEK123U)
are historical examples, not current cross-workload benchmarks or acceptance
receipts.
