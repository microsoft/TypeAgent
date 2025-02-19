# Overview

## Focus management

The Spelunker context contains a list of folders considered the "focus".
This is set by the "setFocusToFolders" action, which takes a list of folder names,
normalizes them, and replaces the previous focus with this list.
Normalization first replaces leading `~` with `$HOME`, then makes paths absolute.
Entries that are not directories are skipped.
The list may be cleared.
Focus persists in a session (i.e., is preserved when cli or shell is killed and restarted).

# Generating answers

Questions about the focused code base are answered roughly as follows:

1. Gather all relevant source files. (E.g. `**/*.{py,ts}`)
2. Chunkify locally (using chunker.py or typescriptChunker.ts)
3. Send batches of chunks, in parallel batches, to a cheap, fast LLM
   with a prompt asking to summarize each chunk.

(Note that 1-3 need to be done only for new or changed files.)

4. Send batches of chunks, in parallel batches, to a cheap, fast LLM
   with a prompt asking it to find chunks relevant to the user question.
5. Sort selected chunks by relevance, keep top _N_.
   (_N_ is dynamically computed to fit in the oracle prompt size limit.)
6. Send the _N_ top selected chunks as context to a smart model ("the oracle")
   with the request to answer the user question using those chunks as context.
7. Construct a result from the answer and the chunks used to come up with it
   ("references").

## How easy is it to target other languages?

- Need a chunker for each language; the rest is the same.
- Chunking TypeScript was, realistically, a week's work, so not too terrible.

## Latest changes

The summaries are (so far, only) used to update so-called "breadcrumb" blobs
(placeholders for sub-chunks) to make the placeholder text look better
(a comment plus the full signature, rather than just e.g. `def foo ...`).

## TO DO

- Prompt engineering (borrow from John Lam?)
- Evaluation of selection process (does the model do a good enough job?)
- Scaling. It takes 20-50 seconds to select from ~4000 chunks (and $5).
  About the same to summarize that number of chunks.
- Do we need to send a "global index" (of summaries) like John Lam's ask.py?
  How to make that scale?
