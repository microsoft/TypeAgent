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

Memories can also **answer** questions, return summaries, analysis, lists and so on. You can ask for answers using natural language.

Memories can be both persisted and loaded on demand.

See [knowpro](../../knowPro/README.md) for details on how memories are indexed and searched and how retrieved information is turned into human readable answers.

## Conversation Memory

See example code in [knowproConversation.ts](../../../examples/chat/src/memory/knowproConversation.ts)

```
import * as cm from "conversation-memory";

memory = cm.createConversationMemory(
            {
                dirPath,
                baseFileName,
            },
            createNew,
        );
// Add a memory
message = new cm.ConversationMessage(memoryText);
await memory.addMessage(message);

// Answer a question using memory
answer = memory.getAnswerFromLanguage("Your question")

// Search
results = await memory.searchWithLanguage("Your question")
```

## Documents and Transcripts

See example code in [knowproDoc.ts](../../../examples/chat/src/memory/knowproDoc.ts)

A [DocMemory](../conversation/src/docMemory.ts) is a collection of Document Parts.

You can **import** an existing text file as a DocMemory. The importer infers the type of document from the file extension and parses the data accordingly. Supported formats:

- \*.vtt (transcripts)
- \*.md (markdown)
- \*.html/htm (html)
- \*.txt (raw text)

```
import * as cm from "conversation-memory";

memory = cm.DocMemory.importFromTextFile(textFilePath, ...);
await memory.buildIndex();
await memory.writeToFile(...);

memory.settings.useScopedSearch = true;
await memory.getAnswerFromLanguage("Summarize the section on XX...");
await memory.getAnswerFromLanguage("List all books in the section named YYY");
```

## Podcasts

See example code in [knowproPodcast.ts](../../../examples/chat/src/memory/knowproPodcast.ts)

## Email

See example code in [knowproEmail.ts](../../../examples/chat/src/memory/knowproEmail.ts)

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
