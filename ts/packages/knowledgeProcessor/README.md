# knowledge-processor

The knowledge-processor package is **sample code** that explores _early_ ideas in **Structured RAG**.

The knowledge-processor package is currently used by the TypeAgent Dispatcher to implement **Agent Memory** for the Agent Shell. The dispatcher does so by using a [ConversationManager](./src/conversation/conversationManager.ts).

See the [knowpro](../knowPro/README.md) package for the **latest** on Structured RAG.

## Overview

Knowledge-processor explores how to:

- Extract **_knowledge_**: from conversations, transcripts, images, and documents.
- Index the extracted knowledge and source text for retrieval.
- Generate queries: translate natural language questions into **queries** to retrieve this knowledge.
- Generate answers: use query results to generate natural language **_answer_** questions.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
