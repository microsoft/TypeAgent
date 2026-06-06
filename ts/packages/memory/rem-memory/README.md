# rem-memory

**REM — Recall Engram Memory.** A standalone entity/relationship memory system
for TypeAgent.

REM stores entities, their relationships, and the observations that produced
them. Unlike KnowPro (which REM may eventually replace), REM owns a mutable
canonical store and treats knowledge extraction as just one _feeder_. Other
feeders (direct user assertions, tool observations, external enrichment) share
the same observation interface.

## Storage model (hybrid)

REM splits storage by change-rate:

- **RDF graph (Oxigraph)** — slow-changing structure and provenance. Entities,
  relations (reified), and one _named graph per observation_ carrying feeder /
  timestamp / confidence / trust-tier provenance. Recall is a SPARQL
  `CONSTRUCT`/`SELECT`.
  - Note: the Oxigraph JS build is in-memory; REM persists via N-Quads
    snapshots (dump on flush, load on open).
- **SQLite (better-sqlite3)** — fast-changing decay signal. One row per relation
  holding `weight0`, `last_seen`, and decay parameters. Current weight is
  computed lazily: `w(t) = w0 * exp(-lambda * (t - last_seen))`.

RDF is authoritative for _existence_; SQLite is authoritative for _signal_.

## Status

v1 in progress: schema + stores → identity resolver → knowledge-extraction
feeder → recall → native answer + MCP tools → comparative eval vs KnowPro.

## Trademarks

This project may contain trademarks or logos for projects, products, or
services. Authorized use of Microsoft trademarks or logos is subject to and must
follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must
not cause confusion or imply Microsoft sponsorship.
