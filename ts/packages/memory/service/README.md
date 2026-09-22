# @typeagent/memory-service

Transport-independent durable memory corpus service.

Phase 0 management APIs provide corpus status and revision/job counts,
deterministically paged source and job listings, bounded revision content reads,
source-scoped derived knowledge, optimistic source replacement, and atomic
source/corpus reindexing. Source deletion is a two-step operation: callers first
request a preview and short-lived confirmation token, then confirm deletion.
Confirmation survives a service restart, and activation rebuilds the complete
corpus index before removing superseded index generations.

The ingestion pipeline persists `mode` and `maxCharsPerChunk` with each
revision. `basic` mode is model-free and contributes bounded exact-search
evidence without semantic knowledge extraction; the remaining modes use the
structured KnowPro index. Nonterminal jobs found after a service restart are
marked failed with an explicit interruption reason so they are never left
permanently active.

`getCapabilities()` reports `management: true` and `groundedAnswer: true`.
`answer` is deliberately extractive: it returns bounded source-linked evidence
with explicit citations and does not claim model-generated synthesis.

The service also provides a shared episode/event substrate for conversation,
web-activity, and procedural producers. Events are appended to a per-corpus
log without rebuilding the document index and are deduplicated by producer and
idempotency key, including after restart. Typed provenance includes source
kind, producer, event type, conversation/run/turn, sender, action, observed
time, and event time. Events can link to durable document sources without
copying source content, and can be listed, searched, filtered, or forgotten
independently. Linked sources are deleted only when explicitly requested and
when no retained event still links to them.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
