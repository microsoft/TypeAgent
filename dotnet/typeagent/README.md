# TypeAgent.NET

This **sample code** is in early stage experimental development with **frequent changes**. 

Working towards .NET versions of the following **TypeAgent** packages:
* [KnowPro](../../ts/packages/knowPro/README.md)
* [Memory](../../ts/packages/memory/README.md)
* [AIClient](../../ts/packages/aiclient/README.md)
* [TypeAgent Common Libs](../../ts/packages/typeagent/README.md)

TypeAgent.NET also incorporates [TypeChat.NET](https://github.com/microsoft/typechat.net).

## KnowPro.NET
KnowPro.NET will implement Structured RAG in C# for .NET platforms. This work is in curently in progress

It will improve on the Typescript implementation in the following ways:
* Storage and indexing using Storage providers
* Fully asynchronous
* Operators are/will be reworked for more efficient async operation
* Asynchronous storage providers with improved Sql schemas
* Larger index sizes

Libraries:
* [KnowPro](./src/knowpro): KnowPro Core
* [KnowProStorage](./src/knowproStorage): KnowPro Storage Providers
* [Conversation Memory](./src/conversationMemory): Implementations of memory types using KnowPro.NET
* [Vector](./src/vector)
* [AIClient](./src/aiclient)

## Completion lengths

OpenAI chat requests omit optional generation-token limits. `CompletionSettings`
and `TranslationSettings` no longer expose `MaxTokens`; use prompt guidance for
an approximate final-answer length, explicitly excluding reasoning. Model
capacity metadata used for input sizing remains separate from request settings.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark \& Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.


