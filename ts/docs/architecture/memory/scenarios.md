# TypeAgent memory scenarios

**Audience:** product engineers, agent authors, evaluators and demo owners.
These journeys describe implemented surfaces, not a new live acceptance run.
See [Current system](current-system.md) for routing and
the dated [implementation ledger](https://github.com/microsoft/TypeAgent/blob/main/ts/docs/plans/memory-system/STATUS.md)
for evidence and remaining qualification.

## Capability map

| Scenario                          | Surface                                          | Evidence/knowledge                    | Boundary                                                      |
| --------------------------------- | ------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------- |
| Recall or locate conversations    | Conversation commands, reasoning `search_memory` | Profile events                        | Historical backfill imports user turns                        |
| Manage a local knowledge base     | Native `@memory`                                 | Retained sources and revisions        | Host path validation; model-backed content pipeline           |
| Capture and inspect web activity  | Browser and Memory Hub                           | Captured sources plus separate events | Enumeration is not content indexing                           |
| Browse Wiki/Projects              | Hub, View-capable service/RPC/MCP                | Bounded indexed derived documents     | Informational content, not exhaustive or approved             |
| Edit and refresh knowledge        | Hub editorial/family controls                    | Generated base plus protected edits   | Explicit conflicts/limits; privacy overrides protection       |
| Build a timeline or guide         | Hub and typed View APIs                          | Selected full-evidence inputs         | Own validation/temporal contracts, no execution               |
| Recover publication/index failure | Hub and View APIs                                | Exact published revision              | Retry index, do not rebuild to disguise failure               |
| Connect another application       | Configured MCP client                            | Owning service's typed operations     | Authentication/configuration and store ownership are explicit |

## Scenario 1: Find a previous conversation

Use `@conversation find` for approximate names, `search` for discussed content,
`summarize` for selected conversations and `index` to backfill display logs.
Live service-backed turns become typed events; content search groups ranked
events by conversation.

Check that results resolve current conversation identities and expose
authority/provenance. Assistant evidence is not a verified observation. Deleting
a conversation removes its events and records a tombstone.

## Scenario 2: Build and manage a Markdown knowledge base

1. Select a corpus with `@memory corpus create` and `@memory corpus use`.
2. Submit files/folders with `@memory import`; inspect batch/job status.
3. Use `@memory search` or `ask`; `ask --extractive` requests snippets.
4. Inspect source content/revisions/knowledge and reopen citations with `explain`.
5. Preview replacement/forgetting, then confirm the exact proposed operation.

Imports use one `content` pipeline, not profiles. The trusted host enforces
real paths, symlink/junction containment, globs, file/byte limits and concurrency.
MCP clients enumerate their own files and submit content instead.

Source indexing and automatic derived work have separate outcomes. A failed
Wiki target does not invalidate a successfully indexed source.

## Scenario 3: Remember web pages and activity

"Save this page", bookmarks/history and HTML imports acquire actual content
for the service. URL enumeration alone is not indexing. Visits/bookmarks/
capture/import events remain distinct from linked page sources.

Inspect acquired batches, member failures, exact revision assets, source
synopses and knowledge in the Hub. A synopsis is navigation only; original
retained content is citation evidence. Compare current-source searches with
activity/time filters rather than treating capture time as claim validity.

## Scenario 4: Carry verified outcomes across conversations

The dispatcher records user assertions, assistant evidence, verified tool
results, explicit decisions and task outcomes with distinct authority labels.
Reasoning combines conversation recall and saved-document search.

Inspect the result's type/outcome and source/turn identity. A failed tool action
is evidence of failure, not a successful fact. Do not infer a saved-procedure
or derived-View retrieval branch in reasoning from a service capability.

<a id="scenario-5-preserve-personal-procedures"></a>

## Scenario 5: Browse automatically maintained Wiki and Projects

Save useful sources to a named collection. Enabled families discover subjects
from the real index and produce bounded source-linked pages/briefs. The user
does not need to choose every input or approve each informational page.

Inspect each target's updating/limited/error state and exact citations.
Projects must keep initiative goals, owners, milestones and status dimensions
separate; shared vocabulary does not merge initiatives. A single substantive
source can justify a page, but generated output is not an exhaustive inventory.

The former saved-personal-procedure workflow is not a current service API.
Retained instruction documents and troubleshooting Views are guidance, not
automatically promoted skills/macros.

<a id="scenario-6-integrate-an-external-client"></a>

## Scenario 6: Integrate an external application

A configured MCP client uses the owning service's typed content, event,
management and View tools. The host's authenticated loopback endpoint is not
a promise of automatic credential discovery for every client. A standalone
owner needs an explicitly configured store; do not assume it shares a running
profile or open that profile concurrently.

Native `@memory`, runtime `@memory-mcp` and the separate workspace memory plugin
have different integration roles. None should silently implement competing
retrieval or lifecycle logic.

## Scenario 7: Edit knowledge and refresh without losing intent

Edit a Wiki title/category/note, exclusion or prose in the Hub. Keep the stable
View identity. After new indexed evidence, inspect the updated page and its
protected edit units. Explicit unlock allows maintenance to revise a protected
unit; incompatible overlap remains a recoverable conflict.

Use family update/rebuild/pause/resume, then reopen the collection to verify
durable state. Unchanged evidence should not cause synthesis merely to produce
a fresh timestamp. Generated-article consolidation is guarded separately from
human editorial saves; old-ID navigation and exact historical reads differ.
See [Maintenance](view-maintenance.md).

## Scenario 8: Build a timeline or troubleshooting guide

Use the Hub or typed View API to select eligible exact revisions and, for a
timeline, canonical events and temporal bounds. Inspect the durable job's
per-target receipt, inventory/support results, generated base and exact citations.
An empty/blocked checkpoint is not a successful fabricated document.

For continuing source scope, preview explicit maintenance before admitting
work. Dynamic future-event discovery is not implied. Edit narrative without
inventing source-owned event identity or time, and resolve conflicts explicitly.
See [Derived Views](derived-views.md).

## Scenario 9: Recover a published but unsearchable document

Inspect built, published and indexed revision IDs. A failed derivative index
does not erase the publication commit or make the revision searchable.
Retry the exact index using current concurrency guards; do not generate another
document to mask the failure. Default derived search must exclude stale,
conflicted or ineligible evidence.

## Scenario 10: Forget a source across its derivatives

Preview the affected source, confirm removal, and observe progress/errors.
Authorized removal withholds corpus content reads until dependent local
index/View/history/asset/batch/context cleanup completes; restart must resume
it. Neither a protected human edit nor a late model response may retain the
forgotten evidence. External exports/backups have a separate lifecycle.

## Evaluation checklist

- Citations reopen the exact source/revision/range or canonical event.
- Typed query validity, citation identity and generated claim support are tested
  separately; an unchanged shape is not a quality pass.
- No-op, family pause/restart, cancellation and partial failures remain visible.
- Source indexing does not wait for successful View synthesis.
- Explicit human edits survive supported refresh or produce an inspectable conflict.
- Publication/index retry preserves exact versions; derived content is not counted
  as independent corroboration.
- Forgetting blocks queued/late reads and removes dependent local payloads.
- Record model, corpus/fixture, commit, workload, time and limitations for every
  live qualification claim. Offline stubs and source inspection are not live runs.
