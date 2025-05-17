# Knowpro

**Knowpro** is **experimental sample code** working towards an MVP library for [**Structured RAG**](#structured-rag-overview). Knowpro is in **active** development with frequent updates.

- The knowpro implementation of Structured RAG is used to explore types of [**memory**](../memory/README.md)
- The [knowpro test app](../../examples/chat/) demonstrates knowpro and memory APIs.

## API

- [Base interfaces and types](./src/interfaces.ts)
- [Search](./src/search.ts)
- [Natural language querying](./src/searchLang.ts)
- [Answer generation](./src/answerGenerator.ts)

## Examples

- [Memory with knowpro](../memory/README.md)
- [Knowpro example](../../examples/chat/README.md)

## Structured RAG overview

- Structured RAG works with conversations. A conversations is a sequence of messages.
- A message can be a turn in a conversation, podcast or chat transcript. It can also be an email message, the description of an image, etc.
- Structured RAG extracts dense information from the text of messages. The extracted information includes short topic sentences, tree-structured entities, and relationship information such as actions.
- Structured information may also accompany a message. This can be timestamps, metadata such as to/from information, or the location information associated with an image. Structured information may be added to a relational table associated with the conversation as needed.
- The information associated with a message is stored in suitable indexes. These indexes allow the information to be:
  - Searched and retrieved using _query expressions_ for improved precision and low latency.
  - Enumerated and filtered.
- Indexes can be updated incrementally or in the background.
- Information retrieved by executing a query can also be used to retrieve the messages it originated in.
- Natural language user requests are translated to search query expressions. Query results are used to generate answers to user requests.

## Knowpro implementation

Knowpro implements the ideas of Structured RAG. Knowpro uses structured prompting and LLM to implement many core features.

Knowpro also supports:

- Natural language queries: translating natural language user requests and questions to queries.
- Answer generation: using query results from executing queries to generate natural language **answers** to user requests.

Knowpro has been primarily tested with **GPT-4o**. Results with other models are not guaranteed.

### Query flow

For each user request (including natural language):

#### Search

- Convert the user request into a query expression. Converting a natural language to query expressions can use a language model.
- For the unstructured data, the query expression consists of two parts: _scope_ expressions and _tree-pattern_ expressions. 
- Scope expressions, such as _time range_, restrict search results to a subset of the conversation.  Scope expressions can include topic descriptions, which specify the subset of the conversation that matches the description. Scope expressions can also define relationships such as actions.
- Tree-pattern expressions match specific trees extracted from the conversation and can be connected by logical operators. Tree expressions can match granular facets.
- If the user request refers to structured information, the query expression will include a relational query to be _joined_ with the unstructured data query result.  The relational query may include comparison operators.
- Execute the query, yielding lists of entities, topics and actions, ordered by _relevance_ score.

  - The matched artifacts reference the sources from which they were derived.

- **Knowpro** uses secondary indices for matching tree expressions efficiently. It also uses secondary scope expressions such as document range and time range.  Knowpro also uses secondary indices for related terms, such as "novel" for "book". 

#### Generate Answers

- Select the top entities and topics returned by Search and add them to the answer prompt
- If the topics and entities do not use all of the token budget, add to the prompt the messages referenced by the top entities and topics. 
- Submit the answer prompt to a language model to generate the final answer.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
