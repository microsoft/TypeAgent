# conversation-memory

**conversation-memory** is an **experimental prototype and sample code** with ongoing and _frequent_ changes.

It explores how to implement different memory [types](#memory-types) using [**Structured RAG**](../../knowPro/README.md) implemented by the [knowpro](../../knowPro) library.

## Memory types

### Conversational

Conversational memory treats the following domains like conversations: a sequence of timestamped **messages** between senders and receivers.

- [Podcast](./src/podcast.ts)
- [Email](./src/emailMemory.ts)
- [Conversation](./src/conversationMemory.ts) such as chats
  - See [conversationManager](../../knowledgeProcessor/src/conversation/conversationManager.ts) in the [knowledgeProcessor](../../knowledgeProcessor) package for existing conversation memory implemented with structured RAG.

### Image

Images can treated as memory and retrieved using both their knowledge content as well their metadata.
[Image](../image/)

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
