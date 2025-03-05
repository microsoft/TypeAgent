# Spelunker evaluation design

## Purpose of the eval

We need to be able to compare different algorithms for selecting chunks
for the oracle context. (For example, using a local fuzzy index based on
embeddings, or sending everything to a cheap model to select; we can
also evaluate prompt engineering attempts.)

Evaluating the oracle is too complicated, we assume that the key to
success is providing the right context. So we evaluate that.

The proposed evaluation approach is thus:

- Take a suitable not-too-large codebase and make a copy of it.
  (We don't want the sample code base to vary.)
- Write some questions that are appropriate for the codebase.
  (This requires intuition, though an AI might help.)
- Chunk the codebase (fortunately, chunking is deterministic.)
- **Manually** review each chunk for each question, scoring yes/no.
  (Or maybe a refined scale like irrelevant, possibly relevant,
  likely relevant, or extremely relevant.)
- Now, for each question:
  - Send it through the chosen selection process (this is variable).
  - Compare the selected chunks with the manual scores.
  - Produce an overall score from this.
- Repeat the latter for different selection algorithms

# Building the eval architecture

- Sample codebase stored in test-data/sample-src/\*_/_.{py,ts}
- Permanently chunked into database at test-data/evals.db
  - Same schema as main db
  - Don't bother with summaries (they're probably totally obsolete)
- There's an extra table with identifying info about the sample
  codebase (so we can move the whole sqlite db elsewhere).
- There's also an extra table giving the sample questions for this
  sample codebase.
- Then there's a table giving the manual scores for each chunk
  and each sample question. (We may have to version this too somehow.)
- Finally there's a table of eval runs, each identifying the algorithm,
  its version, head commit, start time, end time,
  whether completed without failure, and F1 score.
  (We keep all runs, for historical comparisons.)
- We should add the hash of the chunk (including filename,
  but excluding chunk IDs) so we can re-chunk the code and not lose
  the already scored chunks.
  Should lineno be included in this table? Yes if we only expect changes
  to the chunking algorithm, no if we expect extensive edits to the
  sample codebase.
- Must support multiple codebases, with separate lists of questions.
  (Or maybe just separate directories with their own database?)

## Exact schema design

For now we assume a single codebase (maybe mixed-language).

We keep the tables `Files`, `Chunks` and `Blobs` **unchanged** from
the full spelunker app. We run Spelunker with one question over our
sample codebase and copy the database files to the eval directory.
We then add more tables for the following purposes:

- Eval info (start timestamp, end scoring timestamp,
  free format notes).
- Table mapping hash to chunk ID.
- Table of test questions, with unique ID (1, 2, etc.).
- Table for manual scores: (question ID, chunk hash, score (0/1), timestamp)
- Table for eval runs (schema TBD)

### Hashing chunks

We hash chunks so that we can keep the scores and eval run results
even when the sample codebase is re-chunked for some reason
(which assigns new chunks everywhere).

However, sometimes unrelated hashes have the same text, e.g.

```py
    def __len__(self):
        return len(self._data)
```

occurring in multiple classes written using the same design pattern.

How to disambiguate? I propose to include the names of the containing
chunk(s), up to the module root, and also the full filename of the
file where the chunk occurs (in case there are very similar files).

So, for example, the input to the hash function could be:

```
# <filename>
# <great-grandparent> <grandparent> <parent>
<text of chunk>
```

MD5 is a fine, fast hash function, since we're not worried about crypto.

## Manual scoring tool

This is a tedious task, so want to make its UI ergonomic.
Should it use a web UI or command line?

Should be safe to stop and resume at that point later.

Should be possible to remove certain entries to be redone.
(Maybe just delete rows manually using sqlite3 cmd.)

Basically in a loop:

- If the chunk has already been scored for all questions, skip it.
- Display the chunk (mostly from its blobs).
  - We use _Pygments_ to colorize and _less_ to page through the text.
- For each question that hasn't been scored yet:
  - Ask for yes/no, corresponding to "should it be included in the
    oracle context"
- As soon as you answer it moves to the next chunk
- Record scores in database immediately, with chunk hash and timestamp

Once we've scored all chunks (hopefully not more than a few 100)
we can move on to the next stage, running the evals:

## Automatic eval runs

An eval run needs to do the following:

- Use the eval database as ground truth for files, chunks and blobs.
- (Not sure yet what to do if the run needs e.g. summaries.)
- For each question in the Questions table:
  - Run the full chunk selection process using that question.
  - This includes the part that keeps the top N selected chunks only.
  - Compute the F1 score by comparing the precision and recall
    based on the scores in the Scores table: `F1 = 2 * (p*r) / (p+r)`
  - Print some JSON with the question, the F1 score, and the algorithm
    (and perhaps a timestamp).

### Schema for evaluation scoring

The database needs to store for each run, for each question,
for each chunk, whether it was selected or not. Runs identify
the algorithm and its variations. Run names must be unique.
Since most algorithms have it available, we also store the score.

```sql
CREATE TABLE IF NOT EXISTS Runs (
  runId TEXT PRIMARY KEY,
  runName TEXT UNIQUE,
  comments TEXT,
  startTimestamp TEXT,
  endTimestamp TEXT
);
CREATE TABLE IF NOT EXISTS RunScores (
  runId TEXT REFERENCES Runs(runId),
  questionId TEXT REFERENCES Questions(questionId),
  chunkHash TEXT REFERENCES Hashes(chunkHash),
  score INTEGER,  -- 0 or 1
  relevance FLOAT,  -- Range [0.0 ... 1.0]
  CONSTRAINT triple UNIQUE (runId, questionId, chunkHash)
);
```

To compute precision and recall (all numbers in range [0.0 ... 1.0])

- p(recision) = fraction of selected chunks that have score==1 in Scores
- r(ecall) = fraction of chunks with score==1 in Scores that were selected
- `f1 = 2 * (p * r) / (p + r)`

## Tooling needed for automatic eval runs

We need to write a new TypeScript program that reuses much of
`searchCode.ts`, setting the database to the right file
(given on the command line),
and running variants of the selection algorithm
(another command line flag).
This should be straightforward.
We may need small tweaks to the existing algorithms to make the right
APIs available.

# Random notes

Do we need more versatility in the scoring tool? E.g.

- A way to set a fixed score for all chunks in a given file
  (or a file pattern).
- A way to review scores (possibly by date range).
- A way to set a fixed score for a list of chunk IDs
  (e.g. the References section of an actual answer).

# Refactoring the selector

Currently we have these steps:

1. Using embeddings for fuzzy matching, select N nearest neighbors
2. For those N chunks, ask an AI for a relevance score
3. Pick the highest-scoring K chunks

We can envision other steps:

a. Ask an AI to construct a set of words or phrases to select nearest
neighbors
b. Ask an AI to select which files to pay attention to (bool or score?)

In a sense we are collecting multiple types of scores, and we should
combine them using
[RRF ranking](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking#how-rrf-ranking-works).

For this to work, everything that returns a list of chunks/chunk IDs,
should return a list of _scored_ chunk/chunk IDs. In practice, this
just means that we have to change (1) (embeddings) to return the score.
Or perhaps we just sort the results from highest to lowest score,
since the RRF algorithm just takes the rank order for each score type.
