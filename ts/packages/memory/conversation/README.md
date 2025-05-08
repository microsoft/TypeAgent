# conversation-memory

**Experimental prototype**:

- Working toward a shared understanding of implementing different memory types using **Structured RAG** and the [knowpro](../../knowPro) experimental library.
- Work in progress; **_frequent changes_**.
- Structured RAG leverages [**knowledge extraction**](../../knowledgeProcessor/src/conversation/knowledgeSchema.ts) and other techniques to create index structures over source text. This allows for more precise querying as well as direct access to the **salient information** encoded in text.
- This is **sample code** only.

## Memory being explored

### Conversational

The following treat text as conversations: a sequence of **messages**.

- Podcast or Transcript
  - Treat a podcast transcript like a conversation
- Conversations
  - See [conversationManager](../../knowledgeProcessor/src/conversation/conversationManager.ts) in the [knowledgeProcessor](../../knowledgeProcessor) package for existing conversation memory implemented with structured RAG.
- Emails

### Image

Images can treated as memory and retrieved using both their knowledge content as well their metadata.
[ImageMemory](../image/)

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
