# Memory architecture

TypeAgent memory uses a method called **Structured RAG** for indexing and querying agent conversations.

Classic RAG is defined as embedding each conversation turn into a vector, and then for each user request embedding the user request and then placing into the answer generation prompt the top conversation turns by cosine similarity to the user request.

Structured RAG is defined as the following steps:

- For each conversation turn (message):
  - Extract short topic sentences and tree-structured entity and relationship information.
  - Extract key terms from the entities and topics.
  - Add these terms to the primary index that maps terms to entities and topics which in turn point back to messages. Structured information may accompany a message, for example to/from information for an e-mail thread or location information from an image description.  Add any structured information to a relational table associated with the conversation.
- For each user request:
  - Convert the user request into a query expression.  If the user request refers to structured information, the query expression will include a relational query to be joined with the unstructured data query result.  The relational query may include comparison operators.
  - For the unstructured data, the query expression consists of two parts: scope expressions and tree-pattern expressions.
    - Scope expressions, such as time range, restrict search results to a subset of the conversation.  Scope expressions can include topic descriptions, which specify the subset of the conversation that matches the description.
    - Tree-pattern expressions match specific trees extracted from the conversation and can be connected by logical operators.
  - Execute the query, yielding lists of entities and topics, ordered by relevance score
  - Select the top entities and topics and add them to the answer prompt
  - If the topics and entities do not use all of the token budget, add to the prompt the messages referenced by the top entities and topics.
  - Submit the answer prompt to a language model to generate the final answer.

Structured RAG can use simple language models to extract entities and topics.  This enables Structured RAG to index large conversations, like sets of meeting transcripts.  With fine tuning, simple models deliver indices with only a small loss of precision and recall relative to indices built with large language models.

The current Structured RAG implementation in the [KnowPro](../../ts/packages/knowPro/README.md) package uses secondary indices for scope expressions such as document range and time range.  The implementation also uses secondary indices for related terms, such as "novel" for "book".  During query, the memory system discovers related terms and caches them.  Models also offer related terms during information extraction.

Structured RAG has the following advantages over state-of-the-art memory using classic RAG:

1. **Size**:  Structured RAG can retain all of the information extracted from every conversation with the agent.  Structured RAG uses a standard inverted index to map terms to entities, topics and messages.  This choice benefits from the 30 plus years of perfecting inverted indices for Internet search, in libraries like Lucene and services like Azure AI Search.  These indices are a fraction of the size of the vector databases used to index conversations in classic RAG.  For example, using current embedding models yields for each message a 4K vector of semantic information.  In contrast, structured RAG stores only the dense information extracted for each turn, and a back-pointer to the message. Consequently, structured RAG indices can often remain resident in RAM and use a single VM, whereas classic RAG can often require disk operations distributed over a set of VM instances.  For these reasons, on a large scale, Structured RAG is substantially faster at finding relevant information and requires substantially less cost to operate. Most importantly, while systems based on classic RAG will forget information over time and overlook information as more of it is crammed into a token window, Structured RAG retains all of its information, increases the density of that information, and uses a small prompt, increasing the probability that the model generating the answer can give attention to the most relevant information.
2. **Structure**:  Structured RAG extracts structured information from each conversation turn.  On average, this information is much denser than the text of the conversation turn, containing only the essential entities and relationships in the turn, plus a short topic sentence.  This information density enables Structured RAG to put more relevant information into the answer generation prompt.  The retention of structured semantics from each conversation turn enables higher specificity in queries, for example "what e-mail did Kevin send to Satya about new AI models?" or "who won the match where Messi used the crimson soccer ball?"  By relying on a single cosine similarity score, Classic RAG will include for example crimson t-shirts and blue soccer balls for the latter query, reducing the relevance of the information provided for answer generation.
3. **Inference**:  Because Structured RAG has dense, structured information, it can apply further inference to memories, expanding the number of queries it can handle.  For example, if the original index contains an entity such as "artist(Paul Simon)", inference can add additional type information to that entity such as "person(Paul Simon)", which will help in answering a question like "what people did we talk about yesterday?"
4. **Diverse knowledge sources**:  Structured RAG can combine extracted structure with pre-existing structure, for example the sender, receiver and subject of an e-mail message, or the location information provided with an image description.  This enables Structured RAG to return useful answers for queries that reference both the provided and extracted structure such as "what was the cactus I saw on my Arizona hike last month?"
5. **Associative memory**:  Structured RAG can support pre-fetching associations as a user types their request.  For example, if the user types "what was the cactus...", the agent can begin fetching memories associated with cactus even before the user finishes typing their request.  Having discrete index terms also enables agents to use completion hints when a user is typing or speaking a request.  For example a user may type or say "play walk..." and the agent can supply completions "walk this way", "walk on the wild side" etc.
6. **Tools for memory exploration and management**:  When memories are stored as embeddings, little can be done to manage the memories.  Structured indices and tables on the other hand can be explored and managed using additional tools that employ direct query languages or even natural language query coupled with a set of management and exploration tools.

## Implementations

- The [KnowPro](../../ts/packages//knowPro/README.md) package (in-development) contains the most recent implementation exploring the ideas of Structured RAG.

## Demos

- [One minute demo:](): A command-line test of Structured RAG vs Classic RAG recall.  With 3K input tokens, Structured RAG recalls all 63 books discussed in 25 Behind the Tech podcasts, while Classic RAG recalls 15 books using twice as many input tokens.  Not shown, at 128K input tokens, Classic RAG recalls 31 books.
- [Ninety second demo:]() Agent memory implemented using Structured RAG.
