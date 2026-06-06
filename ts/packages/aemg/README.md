# aemg-memory — Associative Episodic Memory Graph (ThreadWeave)

A competing assistant memory system to REM. It stores relationships, provenance,
confidence, and supersession history rather than embedding chunks alone, so
recall is grounded, correctable, and associative.

> Full architecture, module reference, RAG/REM comparison, and the benchmarking
> plan live in [DESIGN.md](./DESIGN.md).

## Implemented

The system works end-to-end, in memory, with no external dependencies:

- **Append-only observation log** — canonical state is a replayable fold.
- **Episodes** — compressed conversation segments indexed on topic, participants,
  time, and action-intent cue axes.
- **Versioned beliefs** — corrections add a new version and link the prior one via
  `supersededById`; nothing is deleted.
- **Trust tiers** — `user_asserted > tool_observed > extractor_inferred >
external_inferred` gate every supersession.
- **Typed knowledge graph + spreading activation** — associative recall that
  reaches memories sharing no words with the query (the RAG-beating capability).
- **Lazy decay + reinforcement + pinning** — salience fades over time unless an
  episode is recalled or pinned, keeping memory clean without sweeps.
- **Contradiction quarantine** — lower-trust conflicting facts stay live and are
  surfaced rather than silently overwritten.
- **Grounded recall** — every hit carries confidence + provenance pointers.

## Build & test

```bash
pnpm --filter aemg-memory build
pnpm --filter aemg-memory test
```

## Roadmap (build order)

1. Vertical slice (ingest → episode → correction → grounded recall). ✅
2. Hybrid retrieval: lexical + typed graph (vector slot reserved). ✅
3. Spreading activation for associative recall. ✅
4. Contradiction quarantine + confidence surfacing. ✅
5. Lazy decay + reinforcement + pinning. ✅
6. Eval harness vs an embedding-only RAG baseline (and REM). ⏳ see
   [DESIGN.md §8](./DESIGN.md#8-todo--benchmarking-not-yet-implemented).
