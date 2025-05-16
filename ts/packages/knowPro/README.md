# Knowpro

**Knowpro** is **experimental sample code** working towards an MVP library for **Structured RAG**.

- Knowpro is used to implement various types of [**memory**](../memory)
- Knowpro is currently in **active** development with _frequent_ changes as the API and feature set evolves.
- The [knowpro test app](../../examples/chat/) demonstrates how to use both memory APIs and knowpro.
- Knowpro has been primarily tested with **gpt-4o**. Performance with other models is not guaranteed.

## Structured RAG overview

- Structured RAG (and knowpro) work with conversations. Conversations contains a sequence of messages.
- A message can be a turn in a conversation, podcast or chat transcript. It can also be an email message, the description of an image, etc.
- Structured RAG extracts dense information from the text of messages. The extracted information includes short topic sentences, tree-structured entities, and relationship information such as actions.
- Structured information may also accompany a message. This can be timestamps, metadata such as to/from information, or the location information associated with an image. Structured information may be added to a relational table associated with the conversation as needed.
- Structured RAG stores the information associated with a message in suitable indexes. These indexes allow the information to be:
  - Searched and retrieved using _structured queries_ for improved precision and low latency.
  - Enumerated and filtered using API calls
  - Retrieved information can be further used to retrieve the source text it was originally found in.
- Indexes can be updated incrementally or in the background.

## Knowpro implementation

Knowpro implements the ideas of Structured RAG described above. Knowpro uses [TypeChat](https://github.com/microsoft/Typechat) to implement many core features.

Knowpro also provides support for:

- Natural language queries: translating natural language user requests to structured queries.
- Answer generation: using the structured objects and (as needed) their source text (as needed) returned by structured queries to generate natural language **answers** to natural language user requests.

### Knowpro API

- [Base interfaces and types](./src/interfaces.ts)
- [Search](./src/search.ts)
- [Natural Language Querying](./src/searchLang.ts)
- [Answer Generation](./src/answerGenerator.ts)

### Examples

- [Memory Implemented using Knowpro](../memory)
- [Knowpro example](../../examples/chat/README.md)

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
