# Scaling ideas

These are very unformed thoughts.

## Local indexing with fuzzy matching

Directly after chunking, add embeddings for all chunks, just based on the code alone.
(Yes I know that's pretty lame, but it's what we can do without summarizing all chunks.)

Whenever a question is asked, _first_ search the embeddings for _k_ nearest neighbors,
where _k_ is pretty large (maybe start with 1000).
Then pass those chunks on to the usual AI-driven selection process.

Do we still need summaries if we do this? How would they be used?
(Possibly we could generate summaries for the query context on demand.)

### Implementation planning

- For now, skip the summarization phase.
- Copy vectorTable.ts from _examples/memoryProviders_ (which IMO isn't a real package).
- Maybe remove stuff we don't need, e.g. generics over `ValueType` and the other weird thing.
- Keep using `interface typeagent.VectorStore<ChunkId>` and put creation in one place.
- Add another file defining an `async` function to get an embedding (probably needs a model).
- After we've got `allChunks` filled (with all the chunks), batch compute and insert
  embeddings for each chunks into the vectore store.
- When prepping for a question, instead of sending all chunks off for selection,
  get the query's embedding and request a generous k nearest neighbors, and send _those_
  off to the selection process. Let's start with _k_=1000, and then see if reducing it
  by half or doubling by two makes much of a difference.
- The rest is the same.

### Again, with feeling

- Copy `vectorTable` from _examples/memoryProviders_, change to pass in the Database object.
  (We could import sqlite from memory-providers, but then the embeddings are in a different database.)
- BETTER: `import { sqlite } from "memory-providers"` and add a createStorageFromDb method.
- EVEN BETTER: Just extract the nearest-neighbors algorithm and do the rest myself. memory-providers is obsolete anyways.
- Create an embedding model when we initialize `QueryContext` (and put it there).
  (Look in old spelunker for example code.)
- Create a table named `ChunkEmbeddings (chunkId TEXT PRIMARY KEY, ebedding BLOB)` when creating the db.
- Use `generateTextEmbeddings` or `generateEmbedding` from `typeagent` to get embedding(s).
  Those are async and not free and might fail, but generally pretty reliable.
  (There are retry versions too if we need them.)
- IIUC these normalize, so we can use dot product instead of cosine similarity.
- Skip the summarizing step. (Keep the code and the Summaries table, we may need them later.)
- Manage embeddings as chunks are removed and added. Probably have to add something
  to remove all embeddings that reference a chunk for a given file (like we do for blobs).
- When processing a query, before the selection step, slim down the chunks using embeddings:
  - Get the embedding for the user query
  - Call `nearestNeighbors` on the `VectorTable`
  - Only read the selected chunk IDs from the Chunks table.

### TODO

- When fewer than maxConcurrency batches, create more batches and distribute evenly.
  (I have an algorithm in mind, this can go in `makeBatches`.)
