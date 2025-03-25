# TODO for the Python knowpro port

## Big functionality

### Serialization and deserialization

Do this before queries, since fully re-indexing takes too long.

### Queries and searches

So we can finally do some end-to-end testing.

### Retries for embeddings

For robustness -- TypeChat already retries, but embeddings don't.

---

## Small functionality

- Implement sharing an embedding model between vectorbases (requires model and emb.size in TextEmbeddingSettings)
- Move the embeddings cache into the model so it can be shared between different vector bases
- Implement Podcast._build_caches(), by implementing create_term_embedding_cache()
  - But Umesh wants to redo this
  - Flag on add functionality whether to cache the key/embedding or not, so we don't cache full message text

## Refactoring implementations

- Change some inconsistent module names
- Rewrite podcast parsing without regexes

## Main/demo/test program support

- Unify various dotenv calls and make them search harder (relative to repo)

## Type checking stuff

- fuzzy_index type mismatch (could VectorBase be made to match the type?)
- Fix need for `# type: ignore` comments (usually need to make some I-interface generic in actual message/index/etc.)

## Low priority

- Tombstones for deletions.

## Maybe...

- Add docstrings etc.
