# chat-rpc-server

Shared RPC server for agent chat communication. Extracted from TypeAgent Shell's `ProtocolChatServer` to enable reuse across multiple hosts (Shell, CLI).

## Features

- WebSocket-based RPC server
- Session management with automatic cleanup
- Host adapter pattern for flexible integration
- Support for Shell and CLI hosts
- Protocol message handling (init, request, ping, close)

## Usage

### With TypeAgent Shell

```typescript
import { ChatRpcServer, ShellHostAdapter } from "chat-rpc-server";

const server = new ChatRpcServer({ port: 3100 });

const adapter = new ShellHostAdapter(
  server,
  () => getDispatcher(),
  () => getShellWindow(),
);

server.attachHost(adapter);
await server.start();
```

### With TypeAgent CLI

```typescript
import { ChatRpcServer, CliHostAdapter } from "chat-rpc-server/adapters/cli";

const server = new ChatRpcServer({ port: 3100 });

const adapter = new CliHostAdapter(server, dispatcher);

server.attachHost(adapter);
await server.start();
```

## Architecture

The package follows a host adapter pattern:

```
ChatRpcServer (WebSocket handling)
    ↓
HostAdapter (interface)
    ├── ShellHostAdapter (Shell integration)
    └── CliHostAdapter (CLI integration)
```

## Protocol

The server implements the TypeAgent WebSocket protocol with these message types:

**Client → Server:**

- `initSession` - Initialize new session
- `userRequest` - User command
- `ping` - Health check
- `closeSession` - End session

**Server → Client:**

- `sessionAck` - Session acknowledged
- `response` - Command response
- `status` - Status update (ready, busy, error)
- `progress` - Progress update
- `pong` - Ping response
- `error` - Error message

## Development

Build:

```bash
pnpm build
```

Clean:

```bash
pnpm clean
```

## License

MIT

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
