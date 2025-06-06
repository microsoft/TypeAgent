## MCP Memory

Sample code and early exploration of using [knowpro memory](../../packages/memory/conversation/README.md) with **MCP**[(model context protocol)](https://github.com/modelcontextprotocol/typescript-sdk).

The example explores adding and recalling memories.

- Currently explores the [conversation-memory](../../packages/memory/conversation/src/conversationMemory.ts) only
  - Uses the StdioServerTransport, which spins up the MemoryServer in **node** and shuts it down **for each request**. This impacts performance as Azure OpenAI credentials must be fetched anew each time.
  - For stateful behavior and very fast performance, create a version of this app that uses an Http transport instead.
  - Memory Server is launched using the [server.js](./src/server.ts)
- Type @help for a list of commands.
  - Commands are implemented in [main.ts](./src/main.ts)
- The exploration is similar to that explored in the [knowpro sample](../chat/README.md)

Memories are stored on your filesystem in folder path: /data/testChat/knowpro/chat
Sample inputs: [input.txt](./src/input.txt)

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
