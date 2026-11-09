## memory-storage

**Early sample code** that explores with how to implement a backing store for [KnowPro](../../knowPro/README.md) using sqlite.

This code is in active development with _frequent changes_ as the APIs evolve.

## Prepared indexing and frame projections

SQLite providers expose the optional KnowPro `createPreparedIndexStorage`
capability. Set `ConversationSettings.preparedIndexing` and attach the provider
to the conversation to use bounded preparation outside the write transaction.
Known, compatible embedding identities are required when embeddings are enabled.

One synchronous transaction replaces the complete candidate message/ref rows,
companion ref metadata, and a versioned artifact containing postings, vectors and
the accepted-message receipt. In-memory indexes are published only after commit.
This is whole-batch acceptance, not per-message publication or SQL vector search.
Caller-owned outer transactions are rejected.

Call `restorePreparedConversationIndex` before reading a reopened generic
conversation. Appended, unindexed messages can resume from the receipt; changed
accepted source content requires explicit `buildConversationIndex` rebuilding.
Unknown receipt versions fail closed. SQLite-backed `EmailMemory` restores the
receipt automatically during reload and incremental indexing, including after a
failed external index-file save. Legacy stores without a receipt need an explicit
rebuild before enabling incremental persistent preparation.

The frame projection store uses typed text/number indexes for temporal and other
scalar candidates. Version 2 backfills row eligibility transactionally on open.
Current-owner and eligibility metadata filter candidates before bounded full-row
hydration and the shared exact predicate. `TYPEAGENT_MEMORY_SEARCH_TRACE=1`
records metadata/exact-stage durations and candidate, hydration-query and match
counts without recording predicate or source text. Both query phases share a
read snapshot, including when another connection replaces an owner concurrently.
Prepared commits also report transaction duration and accepted row counts.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
