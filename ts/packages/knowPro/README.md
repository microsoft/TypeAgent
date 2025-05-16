# Knowpro

**Knowpro** is **experimental sample code** working towards a shared understanding of the MVP for **Structured RAG**.

- Knowpro is currently in **active** development with _frequent_ changes as the API evolves.
- Knowpro has been primarily tested with **gpt-4o**. Performance with other models is not guaranteed.
- Knowpro is used to implement various types of [**memory**](../memory)
- The [knowpro test app](../../examples/chat/) demonstrates how to use both memory APIs and knowpro.

## Structured RAG Overview

Structured RAG is defined as the following steps:

For each conversation turn (message):

- Extract short topic sentences and tree-structured entity and relationship information such as actions. 
- This structured information is stored with suitable indexes. Indexed entities, topics and actions also point back to messages.
- The indexes allow the information to be:
  - Searched and retrieved using structured queries.
  - Enumerated and filtered using API calls
- A message can also be an email message, a text chunk from a document, an image etc.
- Structured information may accompany a message. E.g. timestamps, to/from information for an e-mail thread or location information from an image description. 
- Add any structured information to a relational table associated with the conversation.

For each user request (including natural language):

- Convert the user request into a query expression
- Converting a natural language can use an LLM. The query expression is then transformed and _compiled_.
- For the unstructured data, the query expression consists of two parts: _scope_ expressions and _tree-pattern_ expressions. 
- Scope expressions, such as _time range_, restrict search results to a subset of the conversation.  Scope expressions can include topic descriptions, which specify the subset of the conversation that matches the description. Scope expressions can also define relationships such as actions.
- Tree-pattern expressions match specific trees extracted from the conversation and can be connected by logical operators. Tree expressions can match granular facets.
- If the user request refers to structured information, the query expression will include a relational query to be _joined_ with the unstructured data query result.  The relational query may include comparison operators.
- Execute the query, yielding lists of entities, topics and actions, ordered by _relevance_ score.
  - The matched artifacts reference the sources from which they were derived.
- Select the top entities and topics and add them to the answer prompt
- If the topics and entities do not use all of the token budget, add to the prompt the messages referenced by the top entities and topics. 
- Submit the answer prompt to a language model to generate the final answer.

**Knowpro** uses secondary indices for matching tree expressions efficiently. It also uses secondary scope expressions such as document range and time range.  Knowpro also uses secondary indices for related terms, such as "novel" for "book".  During query processing, the memory system discovers related terms and caches them. 

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
