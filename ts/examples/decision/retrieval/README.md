# Retrieval reranking pilot

Compares a frozen fixture retrieval order with a bounded decision score and predicate. Labels are pilot grades shipped with the fixtures. This directory does not compute embeddings and does not call a generative judge.

knowPro `compileMessageReRank` is the reference reranker: embedding similarity when a message embedding index exists, otherwise `SelectTopN`. It is not integrated or invoked here.

The ranking metric is tie-aware NDCG. Equal grades do not change NDCG when swapped. If every passage is labeled irrelevant, NDCG is 1 for every order and `ndcgInformative` is false; `noneRelevant` is the separate exact check. A decision prediction of no relevant passage requires every score below 0.5 and every relevance predicate below 0.35.

```powershell
node --check ts/examples/decision/retrieval/rerank.mjs
node --test ts/examples/decision/retrieval/rerank.spec.mjs
node ts/examples/decision/retrieval/rerank.mjs
node ts/examples/decision/retrieval/rerank.mjs --live --limit 1 --cli-path <copilot-executable>
```

Default mode is offline. `--live` calls `gpt-6-luna-decisions` through the existing decision client. Stdout is JSONL. Stderr summary counts calls only.

Not implemented: knowPro integration, embedding rerank, generative relevance judging, and package-script wiring.
