# Remote Client Example

Connect to a TypeAgent agent-server running on another machine via a Microsoft
Dev Tunnel.

## Prerequisites

On the **host machine** (where the agent-server runs):

```bash
cd D:\repos\TypeAgent\ts
pnpm run devtunnel:setup                        # one-time tunnel creation
cd packages/agentServer/server && pnpm run start:tunnel   # start server + tunnel
cd ../../.. && pnpm run devtunnel:status -- --token       # get URL + token
```

## Setup (on this machine)

Set environment variables with the URL and token from the host:

```powershell
$env:TYPEAGENT_SERVER_URL = "wss://typeagent-mybox-8999.usw2.devtunnels.ms"
$env:TYPEAGENT_TUNNEL_TOKEN = "eyJhbG..."
```

Or on Linux/macOS:

```bash
export TYPEAGENT_SERVER_URL="wss://typeagent-mybox-8999.usw2.devtunnels.ms"
export TYPEAGENT_TUNNEL_TOKEN="eyJhbG..."
```

## Build & Run

```bash
cd ts/examples/remoteClient
pnpm run build
pnpm run start                    # sends "hello"
pnpm run start -- what time is it # sends a custom message
```

## How it works

1. Reads `TYPEAGENT_SERVER_URL` (the tunnel's `wss://` address) and
   `TYPEAGENT_TUNNEL_TOKEN` (connect token for private tunnels)
2. Calls `connectAgentServer(url, onDisconnect, { headers })` with the tunnel
   token in the `X-Tunnel-Authorization` header
3. Joins a conversation and sends a dispatcher request
4. Prints agent responses and exits

## Environment Variables

| Variable                 | Required             | Description                                                  |
| ------------------------ | -------------------- | ------------------------------------------------------------ |
| `TYPEAGENT_SERVER_URL`   | Yes (for remote)     | The `wss://…devtunnels.ms` URL from the host                 |
| `TYPEAGENT_TUNNEL_TOKEN` | Yes (private tunnel) | Connect token from `devtunnel token <name> --scopes connect` |

For **local** testing (no tunnel), omit both variables — it defaults to
`ws://localhost:8999`.
