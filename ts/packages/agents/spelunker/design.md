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
3. Send batches of chunks, in parallel, to a cheap, fast LLM
   with a prompt asking it to find chunks relevant to the user question.
4. Sort by relevance, keep top `N`. (E.g. `N = 30`)
5. Send the selected chunks as context to a smart model (the "oracle")
   with the request to answer the user question using those chunks as context.
6. Construct a result from the answer and the chunks used to come up with it.

## TO DO

- Prompt engineering (borrow from John Lam?)
- Evaluation of selection process (does the model do a good enough job?)
- Scaling. It takes 60-80 seconds to select from ~4000 chunks.
- Do we need a "global index" (of summaries) like John Lam's ask.py?
  How to make that scale?

- How easy is it to target other languages?
  - Need a chunker for each language; the rest is the same.
  - Chunking TypeScript was, realistically, a week's work.
