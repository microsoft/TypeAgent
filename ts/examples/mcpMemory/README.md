## MCP Memory

Sample code that demonstrates how to implement Structured RAG and [knowPro](../../packages/knowPro/README.md) memory as [**MCP**](https://github.com/modelcontextprotocol/typescript-sdk) _tools_.

- Implements a simple [conversation-memory](../../packages/memory/conversation/src/conversationMemory.ts) [**MemoryServer**](./src/memoryServer.ts) with two basic tools: **remember and recall**.
- MemoryServer is implemented using the [MCP Typescript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
  - MemoryServer currently uses the _stateless_ StdioServerTransport and node.js host for simplicity.
  - For stateful behavior and _very fast performance_, create a version of MemoryServer that uses a express host with http transport instead.
  - MemoryServer is launched in node.js using the [server.js](./src/server.ts) script.
- MemoryServer _tools_ are called using the app CLI.
  - Type @help for a list of commands.
  - Commands are implemented in [main.ts](./src/main.ts)
- You can find more detailed examples of using [knowPro](../../packages/knowPro/README.md) and [Structured RAG](../../../docs/content/architecture/memory.md) in the [knowPro sample](../chat/README.md).

**Note**: Memories are stored on your filesystem in folder path: /data/testChat/knowpro/chat

### Usage

Sample inputs: [input.txt](./src/input.txt)

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
