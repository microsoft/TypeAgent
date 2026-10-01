# @typeagent/memory-service

Transport-independent durable memory corpus service.

Phase 0 management APIs provide corpus status and revision/job counts,
deterministically paged source and job listings, bounded revision content reads,
source-scoped derived knowledge, optimistic source replacement, and atomic
source/corpus reindexing. Source deletion is a two-step operation: callers first
request a preview and short-lived confirmation token, then confirm deletion.
Confirmation survives a service restart, and activation rebuilds the complete
corpus index before removing superseded index generations.

Ingestion accepts only `content` mode and uses the structured KnowPro index
for all document search and knowledge extraction. Revisions retain their
pipeline settings and raw content; historical revisions with an older mode
are replayed as content when their derived index is rebuilt. Source listings
and lookups report their pipeline mode as `content` without rewriting retained
legacy revision metadata, so those records remain valid against the current
service protocol. Nonterminal jobs found after a service restart are marked
failed with an explicit interruption reason so they are never left permanently
active. The separate website-memory HTML/content-capture extraction modes are
not part of this service ingestion pipeline.

Each derived document, conversation-event, and procedure index generation
records `index-schema.json` with schema version 1, engine `knowpro`, and its
index kind. The descriptor is written after the semantic index persists and
before publication. Missing or older descriptors, and current generations
whose required semantic data is missing, trigger a scoped reset and rebuild
from retained revisions, events, or procedure versions. Malformed or
unreadable descriptors and future versions fail explicitly rather than
deleting an index the service cannot interpret. Canonical raw content,
histories, event ledgers, and forget tombstones are not migrated or removed
by a derived-index reset. Extraction failures remain errors and can be
retried against those canonical records. Persisted generation pointers must
name a generated index directory; malformed or out-of-root pointers fail
before any automatic reset.

`getCapabilities()` reports `management: true` and `groundedAnswer: true`.
`answer` is deliberately extractive: it returns bounded source-linked evidence
with explicit citations and does not claim model-generated synthesis.

The service also provides a shared episode/event substrate for conversation,
web-activity, and procedural producers. Events are appended to an authoritative
per-corpus log without requiring models and are deduplicated by producer and
idempotency key, including after restart. Typed provenance includes source
kind, producer, event type, conversation/run/turn, sender, action, observed
time, and event time. Events can link to durable document sources without
copying source content. `searchEvents` lazily reconciles a separate per-corpus
KnowPro content index of event projections with the log, including after
restart. It uses structured knowledge and message search rather than lexical
event scoring; a missing or outdated index is rebuilt, and model/indexing
failures are reported instead of silently falling back. An outdated generation
is physically removed before a rebuild, including when extraction subsequently
fails, so searches cannot recover or use that generation. Ledger-backed event
ID tags restrict all requested provenance and date filters before KnowPro
ranks and limits results. `authorities` filters by the producer-supplied
`metadata.authority` label before ranking, and that label is also indexed as
an immutable `event-authority:` tag. Events without a label do not match an
explicit authority filter. Supported labels are `user-assertion`,
`evidence-only`, `verified-observation`, `explicit`, and `producer-reported`;
unsupported labels are rejected. A failed action result retains its
`verified-observation` provenance alongside `metadata.outcome: "failed"`:
authority does not assert success. `eventIndexFactory` can
inject a deterministic
`CorpusIndexFactory` for offline tests; by default it uses the procedure
index factory (which defaults to the corpus KnowPro factory). Events can be
listed or forgotten independently of documents. Forgetting purges event index
generations before a later search can access them; linked sources are deleted
only when explicitly requested and when no retained event still links to them.
Forgetting also commits suppression tombstones to the event ledger: each
deleted producer/idempotency key and turn is suppressed, while a
`conversationIds` forget without `eventIds` or `turnIds` suppresses the whole
conversation (optionally scoped by `sourceKinds`). Supplying `eventIds` with
`conversationIds` instead narrows deletion to those events and does not mark
the whole conversation forgotten. `turnIds` can
explicitly suppress a turn (optionally scoped by `conversationIds` and
`sourceKinds` and `authorities`) even when no event is present yet. A suppressed append throws
`ForgottenEventError`
(`code: "EVENT_FORGOTTEN"`) instead of returning a replay or a fabricated
event. Tombstones survive restart and are excluded from listing and indexing.
Clearing a corpus retains tombstones and suppresses its previously indexed
conversations so retained upstream transcripts cannot backfill them.

Personal how-to storage is corpus-owned but persisted independently from the
source manifest, so importing, replacing, reindexing, or forgetting sources
cannot reset its settings. `getPersonalHowToSettings` and
`updatePersonalHowToSettings` use an optimistic settings revision. Procedure
candidates can be detected, drafted, rejected, or saved. Saved procedures are
immutable versions with canonical JSON, a deterministic Markdown projection,
content hashes, source-revision citations, and version lineage. Markdown saves
are parsed and validated while retaining additional free-form sections.

`listProcedures`, `getProcedure`, `searchProcedures`, `saveProcedure`, and
`archiveProcedure` provide the procedure lifecycle. Replacing or forgetting a
cited source creates a new `stale` procedure version while leaving every older
version unchanged. The transport-independent personal how-to API is also
available through the RPC facade.

`searchProcedures` searches the latest version of each procedure independently
of the source-revision index, using a separate KnowPro index within the same
corpus. Procedure Markdown is indexed in content mode, so natural-language
queries use the same structured-knowledge search and message reranking as
indexed documents. Saved, stale, and archived states are indexed as message
tags; requested states constrain KnowPro search before ranking and limiting.
Each commit publishes a new index generation containing only the latest
version of every procedure. Older versions remain available through
`getProcedure`, and a missing index generation is rebuilt from the committed
versions on search. Searches remain corpus-scoped and honor the requested
states and result limit; omitted states include all three states as before.
Procedure indexing requires the configured KnowPro extraction and search
models; it no longer has a separate embedding or lexical fallback.

When both personal how-to settings are enabled, successful Markdown and text
ingestion detects procedural sections containing ordered or checklist steps.
Detected candidates use deterministic source-revision identities and citations,
so unchanged imports and restarts do not create duplicates. Detection runs only
after the source commit; failures are reported in ingestion job warnings without
rolling back the committed source or changing authored procedures.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
