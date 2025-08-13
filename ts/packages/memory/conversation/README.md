# Conversation Memory

The **conversation-memory** package is **experimental sample code** under active development with _frequent_ updates.

The **conversation-memory** package explores how to implement types of _conversational memory_ using the [KnowPro](../../knowPro/README.md) library.

**Memory** is defined as sequences of timestamped **messages** between senders and receivers. The following memory types can be considered conversations:

- [Conversation Memory](./src/conversationMemory.ts) such as interactive chats
- [Podcasts](./src/podcast.ts)
- [Email](./src/emailMemory.ts)
- [Document](./src/docMemory.ts)

Memories are added to and indexed **incrementally** and on the fly. This allows emails and conversation messages to be added to memory and indexed as they come in.

New memories are analyzed and salient knowledge such as entities, actions and topics extracted and indexed. This indexed knowledge allows memories to support precise [search](./src/memory.ts#search) and retrieval with **low latency**.

Memories can be searched using natural language or knowpro search expressions. You can search memory for discovered knowledge such as entities of a particular type.

Memories can also answer questions, return summaries, analysis, lists and so on using natural language.

Memories can be both persisted and loaded on demand.

See [knowpro](../../knowPro/README.md) for details on how memories are indexed and searched and how retrieved information is turned into human readable answers.

## Documents

A [DocMemory](../conversation/src/docMemory.ts) is a collection of Document Parts.

You can **import** an existing text file as a DocMemory. The importer infers the type of document from the file extension and parses the data accordingly. Supported formats:

- \*.vtt (transcripts)
- \*.md (markdown)
- \*.html/htm (html)
- \*.txt (raw text)

`
memory = DocMemory.importFromTextFile(textFilePath, ...);`

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
