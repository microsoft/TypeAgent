# Overview

## Focus management

The Spelunker context contains a list of folders considered the "focus".
This is set by the "setFocusToFolders" action, which takes a list of folder names,
normalizes them, and replaces the previous focus with this list.
Normalization first replaces leading `~` with `$HOME`, then makes paths absolute.
The list may be cleared.
Focus persists in a session (i.e., is preserved when cli or shell is killed and restarted).

# Generating answers

Questions about the focused code base are answered roughly as follows:

1. Gather all relevant files. (E.g. `**/*.py`)
2. Send each file separately, in parallel, to a cheap, fast LLM
   with a prompt asking it to find modules, classes and functions relevant to the user question.
3. Rank the selected chunks using some algorithm.
4. Select the N highest ranking chunks. (E.g., `N = 30`)
5. Send the selected chunks as context to a smarter model with the request to answer the user question using that context.
6. Construct a result from the answer and the chunks used to come up with it.

## TO DO

- How to identify chunks.
  - Use a strong hash from the chunk text, the line number range, and the filename?
  - Or just "Chunk 1", "Chunk 2", etc?
- Try to cache chunks we've encountered.
- Prompt engineering.
- Ranking chunks.
- Do we need a "global index" like John Lam's ask.py?

- How easy is it to target other languages?
