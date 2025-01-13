# Spelunker: Architecture and Design

Spelunker is currently best used to explore one project at a time.
The initial prototype can only handle Python files.

## Database structure

The database records a number of categories of information:

- **chunks** of program text (typically a function or class).
  The database holds the source text, some metadata,and a copy of the docs extracted from the chunk.
  Chunks have a tree-shaped hierarchy based on containment; the entire file is the root.
- **summaries**, **keywords**, **tags**, **synonyms**, **dependencies**:
  Various types of docs extracted from all chunks, indexed and with "nearest neighbors" search enabled.
- **answers**: conversation history, recording for each user interaction the question, the final AI answer, and a list of references (chunks that contributed to the answer).
  Indexed only by timestamp.

## Import process

The chunks and related indexes are written by an import pipeline that does the following:

1. Break each file into a hierarchy of chunks using a local script.
2. Split large files into several shorter files, guided by the chunk hierarchy (repeating part of the hierarchy).
3. Feed each file to an LLM to produce for each chunk a summary and lists of keywords, tags, synonyms, and dependencies. (The exact set of categories is still evolving.)
4. Store those in their respective indexes.

## Query process

A user query is handled using the following steps:

1. Feed the user query (and some recent conversation history from **answers**) as context to an LLM tasked with producing sensible queries for each index.
2. Search each local index (**summaries**, **keywords** etc.), keeping the top hits from each (scored by proximity to the query phrase produced by step 1).
3. Using some information retrieval magic (a variant of TF\*IDF), select the top "best" chunks among those hits.
4. Send the selected chunks (including parial metadata and summary), plus the same recent history from step 1, as context to an LLM tasked with producing the final answer from all the context it is given.
5. present the answer to the user and add it to the conversation history (**answers**).

## Open issues

### High level

- Is it worth pursueing this further? (Github Copilot does a better job summarizing a project.)
- How to integrate it as an agent with shell/cli?
  Especially since the model needs access to conversation history, and the current assumption is that you focus on spelunking exclusively until you say you are (temporarily) done with it.
  Does the cli/shell have UI features for that?
- Do what search engines do. (E.g. many parallelized specialized queries.)
- How to extract and encode **meaning**? (Beyond embeddings.)

### Testing

- How to measure the quality of the answers? This probably has to be a manual process.
  We might be able to have a standard set of queries about a particular code base and for each potential improvement decide which variant gives the better answer.
- Anecdotally, GitHub Copilot in VS Code does a better job (possibly because it can see the project docs)

### Import process open questions

- Should we give the LLM more guidance as to how to generate the best keywords, tags etc.?
- Do we need all five indexes? Or could we do with fewer, e.g. just **summaries** and **keywords**? Or **summaries** and **relationships**?
- Can we get it to produce better summaries and keywords (etc.) through different prompting?
- What are the optimal parameters for splitting long files?
- Can we tweak the splitting of large files to make the split files more cohesive?
- Would it help if we tweaked the chunking algorithm?
- Could we get the LLM to produce the chunking? (Chicken and egg for large files though.)

### Query process open questions

- Can we use a faster, cheaper (and dumber) model for step 1?
- How much conversation history to include in the context for steps 1 and 4, and if not all, how to choose (anither proximity search perhaps?).
- Prompt engineering to get the first LLM to come up with better queries. (Sometimes it puts stuff in the queries that feel poorly chosen.)
- How many hits to request from each index (**maxHits**). And possibly how to determine **minScore**.
- Algorithm for scoring chunks among hits. There are many possible ideas. E.g. different weight per index?
- How many chunks to pass in the context for step 4. (Can it be dynamic?)
- In which order to present the context for step 4.
- Prompt engineering for step 4.
- Sometimes the model isn't using the conversation history enough. How can we improve this?
  (E.g. I once had to battle her about whether she had access to history at all; she claimed she did not, even though I gave her the most recent 20 question/answer pairs.)

## Details of the current processes

### Scoring hits and chunks

- When scoring responses to a nearest neighbors query, the relevance score of each response is a number between -1 and 1 giving the "cosine similarity".
  (Which, given that all vectors are normalized already, is just the dot product of the query string's embedding and each potential match's embedding.)
  We sort all responses by relevance score, and keep the top maxHits responses and call them "hits". (Possibly also applying minScore, which defaults to 0.)
  Usually maxHits = 10; it can be influenced by a per-user-query setting and/or per index by the LLM in step 1.
  Each hit includes a list of chunk IDs that produced its key (e.g. all chunks whose topic was "database management").

- When computing the score of a chunk relative to a query result (consisting of multiple hits), we compute the score using TF\*IDF.

  - We keep a mapping from chunk IDs to TF\*IDF scores. Initially each chunk's score is 0.
  - For each index, for each hit, we compute the TF\*IDF score for each chunk referenced by the hit.
  - The TF\*IDF score for the chunk is then added to the previous cumulative score for that chunk in the mapping mentioned above.
  - TF (Term Frequency) is taken to be the hit's relevance score.
    Example: if "database management" scored 0.832 against the actual query, TF = 0.832 for that hit.
  - IDF (Inverse Document Frequency) is computed as 1 + log(totalNUmChunks / (1 + hitChunks)). (Using the natural logarithm.)
    Here totalNUmChunks is the total number of chunks indexed, and hitChunks is the number of chunks mentioned by this hit.
    Reference: "inverse document frequency smooth" in this [table in Wikipedia](https://en.wikipedia.org/wiki/Tf%E2%80%93idf#Inverse_document_frequency).
    Example: If there are 250 chunks in the database, and "database management" is mentioned by 5 chunks, IDF = 1 + log(250 / 6). I.e., 4.729.

- After processing all hits for all indexes, we end up with a cumulative TF\*IDF score for each chunk that appeared at least once in a hit.
  We sort these by score and keep the maxChunks highest-scoring chunks to send to the LLM in step 4.
  Currently maxChunks is fixed at 30; we could experiment with this value (and with maxHits).

### TODO

The rest is TODO. For now just see the code.
