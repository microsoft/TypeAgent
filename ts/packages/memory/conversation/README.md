# conversation-memory

**conversation-memory** is an **experimental prototype** and **sample code** with ongoing and _frequent_ changes.

- Explores how to impolement different memory [types](#memory-types) using **Structured RAG** and the [knowpro](../../knowPro) experimental library.
- Structured RAG uses [**knowledge extraction**](../../knowledgeProcessor/src/conversation/knowledgeSchema.ts) and other techniques to extract **salient information** from text. This salient information includes **structured** objects such as Entities, Actions and Topics and other data. It stores these objects and creates suitable indexes that allow them to be retrieved using **structured queries**. The retrieved objects can be also be used to retrieve the text they were found in.

## Memory types

### Conversational

Conversational memory treats text in the following domains like conversations. Conversations are defined as a sequence of timestamped **messages**.

- [Podcast Memory](./src/podcast.ts): Treat a podcast transcript like a conversation.
- [EmailMemory](./src//emailMemory.ts): Treat emails as messages in a conversation.
- [ConversationMemory](./src/conversationMemory.ts): conversational memory such as one used by chats
  - See [conversationManager](../../knowledgeProcessor/src/conversation/conversationManager.ts) in the [knowledgeProcessor](../../knowledgeProcessor) package for existing conversation memory implemented with structured RAG.

### Image

Images can treated as memory and retrieved using both their knowledge content as well their metadata.
[ImageMemory](../image/)

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
