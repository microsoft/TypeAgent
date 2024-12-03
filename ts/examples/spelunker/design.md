# Spelunker: Architecture and Design

Spelunker is currently best used to explore one project at a time.
The initial prototype can only handle Python files.

## Database structure

The database records a number of categories of information:

- **chunks** of program text (typically a function or class).
  The database holds the source text, some metadata,and a copy of the docs extracted from the chunk.
  Chunks have a tree-shaped hierarchy based on containment; the entire file is the root.
- **summaries**, **keywords**, **topics**, **goals**, **dependencies**:
  Various types of docs extracted from all chunks, indexed and with "nearest neighbors" search enabled.
- **answers**: conversation history, recording for each user interaction the question, the final AI answer, and a list of references (chunks that contributed to the answer).
  Indexed only by timestamp.

## Import process

The chunks and related indexes are written by an import pipeline that does the following:

1. Break each file into a hierarchy of chunks using a local script.
2. Split large files into several shorter files, guided by the chunk hierarchy (repeating part of the hierarchy).
3. Feed each file to an LLM to produce for each chunk a summary and lists of keywords, topics, goals and dependencies.
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

- Is it worth pursueing this further?
- How to integrate it as an agent with shell/cli?
  Especially since the model needs access to conversation history, and the current assumption is that you focus on spelunking exclusively until you say you are (temporarily) done with it.
  Does the cli/shell have UI features for that?
- Do what search engines do. (E.g. many parallelized specialized queries.)
- How to extract and encode **meaning**? (Beyond embeddings.)

### Testing

- How to measure the quality of the answers? This probably has to be a manual process.
  We might be able to have a standard set of queries about a particular code base and for each potential improvement decide which variant gives the better answer.

### Import process open questions

- Should we give the LLM more guidance as to how to generate the best keywords, topics etc.?
- Do we need all five indexes? Or could we do with fewer, e.g. just **summaries** and **topics**?
- Can we get it to produce better summaries and topics (etc.) through different prompting?
- What are the optimal parameters for splitting long files?
- Can we tweak the splitting of large files to make the split files more cohesive?
- Would it help if we tweaked the chunking algorithm?
- Could we get the LLM to produce the chunking? (Chicken and egg for large files though.)

### Query process open questions

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

E.g. my TF\*IDF variant, etc.

This is TODO. For now just see the code.
