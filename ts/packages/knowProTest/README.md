# KnowProTest

KnowProTest is **experimental sample code and wrappers** used by [test apps](../../examples/chat/README.md) and evaluation tooling for the [KnowPro](../knowPro/README.md) package.

[KnowProContext](./src/knowproContext) demonstrates how to set up:

- LLM and embedding models to use with KnowPro
- Create query translators and answer generators.

The [knowProCommands.ts](./src/knowCommands.ts) file demonstrates the following KnowPro use cases:

- Searching memory using natural language: _execSearchRequest_ method.
- Answering a natural question about memory with a natural language answer: _execGetAnswerRequest_ method.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
