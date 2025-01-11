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
2. Chunkify locally (using chunker.py)
3. Send chunks for each file separately, in parallel, to a cheap, fast LLM
   with a prompt asking it to find chunks relevant to the user question.
4. Sort by relevance, keep top `N`. (E.g. `N = 30`)
5. Send the selected chunks as context to a smart model
   with the request to answer the user question using those chunks as context.
6. Construct a result from the answer and the chunks used to come up with it.

## TO DO

- Try to cache chunks we've encountered.
- Prompt engineering (burrow from John Lam?)
- Ranking chunks (does the model do a good enough job?)
- Do we need a "global index" like John Lam's ask.py?

- How easy is it to target other languages?
  - Need a chunker for each language; the rest is the same.
