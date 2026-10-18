# TypeAgent memory scenarios

Use these workflows to find saved information, build a knowledge base, and
maintain generated documents. [Current system](current-system.md) explains the
implementation. The [implementation ledger](https://github.com/microsoft/TypeAgent/blob/main/ts/docs/plans/memory-system/STATUS.md)
tracks test results and release readiness.

## Capability map

| Scenario                          | Surface                                          | Evidence or knowledge                 | Limit                                                           |
| --------------------------------- | ------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------- |
| Recall or locate conversations    | Conversation commands, reasoning `search_memory` | Profile events                        | Backfill imports user turns only                                |
| Manage a local knowledge base     | Native `@memory`                                 | Retained sources and revisions        | The host validates paths. The content pipeline needs a model    |
| Capture and inspect web activity  | Browser and Memory Hub                           | Captured sources plus separate events | Listing a URL doesn't index its content                         |
| Browse Wiki and Projects          | Hub, View-capable service/RPC/MCP                | Bounded indexed derived documents     | Informational, not exhaustive, not approved                     |
| Edit and refresh knowledge        | Hub editing and family controls                  | Generated base plus protected edits   | Conflicts and limits are explicit. Privacy overrides protection |
| Build a timeline or guide         | Hub and typed View APIs                          | Selected full-evidence inputs         | Own validation and time rules. Nothing is executed              |
| Recover publication/index failure | Hub and View APIs                                | Exact published revision              | Retry the index. Don't rebuild to hide the failure              |
| Connect another application       | Configured MCP client                            | The owning service's typed operations | Authentication, configuration and store ownership are explicit  |

## Scenario 1: Find a previous conversation

Use `@conversation find` for an approximate name and `search` for what was
discussed. Use `summarize` for the conversations you pick, and `index` to backfill
from display logs. With the service, live turns become typed events, and content
search ranks those events and groups them by conversation.

Check that results point to current conversations and show their authority and
provenance. Assistant evidence is not a verified observation. Deleting a
conversation removes its events and records a tombstone.

## Scenario 2: Build and manage a Markdown knowledge base

1. Create a collection with `@memory corpus create`, then select it with
   `@memory corpus use`. Commands call a collection a _corpus_.
2. Submit files or folders with `@memory import`, then check the batch and job status.
3. Query with `@memory search` or `ask`. `ask --extractive` returns snippets.
4. Inspect source content, revisions and knowledge, and reopen citations with `explain`.
5. To replace or forget a source, preview the change and confirm that operation.

Imports use one `content` pipeline and have no profiles. The host validates paths,
including symlinks and junctions, and enforces glob, file-size, byte and concurrency
limits. MCP clients list their own files and submit the content.

Indexing a source and the automatic derived work succeed or fail separately. A
failed Wiki target doesn't invalidate a source that indexed correctly.

## Scenario 3: Remember web pages and activity

"Save this page", bookmarks, history and HTML imports all bring actual content
to the service. Listing URLs alone doesn't index them. Visit, bookmark, capture
and import events stay separate from the page sources they link to.

In the Hub, inspect acquired batches, members that failed, exact revision assets,
source synopses and knowledge. A synopsis helps you navigate, and the original
retained content is what you cite. When you compare searches, use the activity
and time filters. Capture time isn't the time a claim was true.

## Scenario 4: Carry verified outcomes across conversations

The dispatcher records user assertions, assistant evidence, verified tool results,
explicit decisions and task outcomes, each with its own authority label.
Reasoning combines conversation recall with saved-document search.

Look at each result's type and outcome and at its source and turn identity. A
failed tool action is evidence that it failed, not a fact that it worked. Reasoning
doesn't search saved procedures or derived Views, even though the service can.

<a id="scenario-5-preserve-personal-procedures"></a>

## Scenario 5: Browse automatically maintained Wiki and Projects

Save useful sources to a named collection. The enabled families find subjects in
the real index and produce bounded pages and briefs linked to their sources. You
don't pick every input or approve each informational page.

For each target, check whether it is updating, limited or in error, and check its
exact citations. Projects keep goals, owners, milestones and status dimensions
separate, and shared vocabulary doesn't merge two initiatives. One substantial
source can justify a page, but generated output isn't a complete inventory.

Instruction documents and troubleshooting Views provide guidance. To automate
a task, use [macros](../workflows/macros.md) or a provider-owned flow separately.

<a id="scenario-6-integrate-an-external-client"></a>

## Scenario 6: Integrate an external application

A configured MCP client uses the owning service's typed tools for content, events,
management and Views. The host's authenticated loopback endpoint doesn't mean
every client can discover its credentials automatically. A standalone owner needs
an explicitly configured store. Don't assume it shares a running profile, and
don't open that profile at the same time.

Use the native `@memory` agent for local commands and the runtime `@memory-mcp`
agent for MCP access to the same service. The workspace memory plugin has a
separate store; it does not share the profile's memory.

## Scenario 7: Edit knowledge and refresh without losing intent

In the Hub, edit a Wiki title, category, note or exclusion, or edit the prose.
The View keeps its stable identity. After new indexed evidence arrives, check the
updated page and its protected edit units. An explicit unlock lets maintenance
revise a protected unit. An edit that truly overlaps stays a recoverable conflict.

Use family update and rebuild to request maintenance, or pause and resume to
control automatic work. These settings persist when you reopen the collection.
Unchanged evidence does not trigger synthesis. Automatic consolidation applies
only to generated articles without human edits; old article IDs redirect to the
canonical article, while exact historical reads remain available. See
[Maintenance](view-maintenance.md).

## Scenario 8: Build a timeline or troubleshooting guide

In the Hub or the typed View API, select eligible exact revisions. For a timeline,
also select canonical events and time bounds. Inspect the job's receipt for each
target, the inventory and support results, the generated base and the exact
citations. An empty or blocked checkpoint never yields an invented document.

To keep a source scope current, preview maintenance before you start it.
Future events aren't discovered dynamically. You can edit the narrative,
but you can't invent a source-owned event identity or time. Resolve conflicts
explicitly. See [Derived Views](derived-views.md).

## Scenario 9: Recover a published but unsearchable document

Compare the built, published and indexed revision IDs. If the derived index
failed, the publication commit still stands, but the revision isn't searchable.
Retry the exact index, using the current concurrency guards. Don't generate
another document to hide the failure. Default derived search must leave out stale,
conflicted or ineligible evidence.

## Scenario 10: Forget a source across its derivatives

Preview the affected source, confirm the removal, and watch for progress and
errors. Once removal is authorized, corpus content reads stay withheld until the
dependent local index, View, history, asset, batch and context data are cleaned
up, and a restart resumes that cleanup. A protected human edit can't keep the
forgotten evidence, and neither can a late model response. External exports and
backups follow their own lifecycle.

## Evaluation checklist

- Citations reopen the exact source, revision and range, or the canonical event.
- Test query validity, citation identity and claim support separately. An output
  with the same shape isn't a quality pass.
- No-ops, family pause and restart, cancellation and partial failures stay visible.
- Source indexing doesn't wait for View synthesis to succeed.
- Explicit human edits survive a supported refresh, or they produce a conflict you can inspect.
- Retrying publication or indexing keeps exact versions. Derived content isn't
  counted as independent corroboration.
- Forgetting blocks queued and late reads and removes dependent local payloads.
- For any live qualification claim, record the model, corpus or fixture, commit,
  workload, time and limitations. Offline stubs and source inspection are not live runs.
