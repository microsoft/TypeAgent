# Knowpro

**Knowpro** is **experimental sample code** working towards an MVP library for **Structured RAG**.

- Knowpro is used to implement various types of [**memory**](../memory)
- Knowpro is currently in **active** development with _frequent_ changes as the API evolves.
- The [knowpro test app](../../examples/chat/) demonstrates how to use both memory APIs and knowpro.
- Knowpro has been primarily tested with **gpt-4o**. Performance with other models is not guaranteed.

## Structured RAG overview

- Structured RAG (and knowpro) work with conversations. Conversations contains a sequence of messages.
- A message can be a conversation turn, a turn from a podcast or chat transcript, an email message, descriptions for images, etc.
- Structured RAG extracts dense information from the text of source messages.
- This dense information includes short topic sentences, tree-structured entities, and relationship information such as actions. Messages can also include timestamps and common metadata such as to/from information.
- Structured information may also accompany a message, such as the location information from an image description. This can be added to a relational table associated with the conversation.

- This structured information is stored with suitable indexes that allow it to be:
  - Searched and retrieved using **structured queries** for improved precision and low latency. Structured queries include term matching tree expressions as well as scoping
  - Enumerated and filtered using API calls
- Retrieved information can also be used to retrieve the source text it was originally found in.
- Indexes can be updated incrementally or in the background.
- Knowpro also supports:
  - Natural Language queries: translating _natural language user requests_ to structured queries.
  - Answer Generation: using the structured objects and (as needed) their source text (as needed) returned by structured queries to generate natural language **answers** to natural language user requests.

## Exploring thecode

- [Base interfaces and types](./src/interfaces.ts)
- [Search](./src/search.ts)

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
