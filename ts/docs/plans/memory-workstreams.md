# Memory Workstreams

This branch introduces **two standalone, competing assistant-memory systems** for
TypeAgent, plus a shared LLM-judge evaluation harness. Both go beyond
embedding-chunk RAG: they store entities, relationships, provenance, confidence,
and trust tiers, and decay salience over time.

| System   | Package                                                | Backing store                                  | Distinguishing idea                                              |
| -------- | ------------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------------- |
| **REM**  | [`rem-memory`](../../packages/memory/rem-memory)       | RDF (Oxigraph) + SQLite decay signals          | Extract → RDF triples → lexical / fuzzy / type-aggregation recall |
| **AEMG** | [`aemg-memory`](../../packages/aemg)                   | In-memory typed graph + append-only log        | Spreading activation for associative, word-overlap-free recall   |

Shared design themes: **trust tiers** (`user_asserted > tool_observed >
extractor_inferred > external_inferred`), **decaying salience signals**,
**provenance / grounded recall**, and a **structure-vs-signal store split**.

---

## REM — Recall Engram Memory

Ingest text → extract entities & relations → store as RDF (Oxigraph) with
SQLite-backed decay "signals" → recall relevant facts (lexical + type
aggregation) → answer questions with an LLM grounded only on recalled memory.

- **Code:** [`packages/memory/rem-memory`](../../packages/memory/rem-memory)
- **Status & handoff:** [rem-memory/STATUS.md](./rem-memory/STATUS.md)
- **Eval harness:** [`examples/memoryEval`](../../examples/memoryEval)

## AEMG — Associative Episodic Memory Graph (ThreadWeave)

A competitor to REM (built independently, not on top of it). Append-only
observation log as canonical state, compressed episodes, versioned beliefs with
non-destructive corrections, a typed knowledge graph with spreading activation,
lazy decay + reinforcement + pinning, and contradiction quarantine.

- **Code:** [`packages/aemg`](../../packages/aemg)
- **Design & module reference:** [aemg DESIGN.md](../../packages/aemg/DESIGN.md)
- **Overview:** [aemg README.md](../../packages/aemg/README.md)

---

## Evaluation

Both systems are intended to be benchmarked head-to-head against each other and
against an embedding-only RAG baseline. The REM eval harness
([`examples/memoryEval`](../../examples/memoryEval)) generates graded-difficulty
questions, produces closed-book oracle answers, and scores responses with an
LLM judge. AEMG's own RAG/REM benchmark is still pending (see
[DESIGN.md §8](../../packages/aemg/DESIGN.md)).
