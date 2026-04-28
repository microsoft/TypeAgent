# Persistent User Settings

## Overview

User settings provide persistent, cross-session defaults for startup behavior. They are stored in `~/.typeagent/user-settings.json` and surfaced via `@system settings` commands in the dispatcher's system agent (`@settings` is available as an alias).

## Settings Data Model

```typescript
interface UserSettings {
  server: {
    hidden: boolean; // Start AgentServer without a visible window
    idleTimeout: number; // Seconds before idle shutdown (0 = disabled)
  };
  conversation: {
    resume: boolean; // Resume last conversation on startup
  };
}
```

**File location:** `~/.typeagent/user-settings.json`

**Defaults:**

```json
{
  "server": {
    "hidden": false,
    "idleTimeout": 0
  },
  "conversation": {
    "resume": false
  }
}
```

## Commands

All under `@system settings`:

| Command                                              | Description                  |
| ---------------------------------------------------- | ---------------------------- |
| `@system settings`                                   | Show all current settings    |
| `@system settings server hidden [true\|false]`       | Toggle hidden server startup |
| `@system settings server idleTimeout <seconds>`      | Set idle timeout             |
| `@system settings conversation resume [true\|false]` | Toggle conversation resume   |
| `@system settings reset`                             | Reset all to defaults        |

## Startup Integration

### CLI (`packages/cli/src/commands/connect.ts`)

- On startup, load user settings as defaults for `--hidden`, `--idleTimeout`, and `--resume` flags
- Explicit CLI flags override user settings via nullish coalescing (`??`)
- Boolean flags support `--no-<flag>` (e.g., `--no-hidden`, `--no-resume`) to explicitly override a saved `true` setting
- Omitting a flag leaves it as `undefined`, which falls through to the saved user setting

### Shell (`packages/shell/src/main/instance.ts`)

- On startup, load user settings and apply to `ensureAgentServer()` calls
- Shell args support `--hidden`/`--no-hidden`, `--idle-timeout <n>`, `--resume`/`--no-resume`
- Shell settings UI can be extended later

## Storage Layer

The settings module lives in `packages/dispatcher/dispatcher/src/helpers/userSettings.ts` alongside the existing `userData.ts`. It uses the same `getUserDataDir()` base path.

- Read: returns merged defaults + saved settings
- Write: deep-merges partial updates and persists
- File locking: uses the same `proper-lockfile` pattern as `userData.ts`, acquiring a synchronous lock on the user data directory for all read/write/reset operations to prevent concurrent access races

## Migration Strategy

- If `user-settings.json` does not exist, all defaults apply
- New settings fields added in future versions get their defaults automatically via deep-merge
- No schema version field needed initially; the merge-with-defaults pattern handles forward compatibility

## Server Shutdown

### `@shutdown` command

Typing `@shutdown` in any client (CLI or Shell) shuts down the agent server and disconnects all clients. Unlike `@exit`, which only exits the current client.

In connect mode, the dispatcher runs on the server. When `@shutdown` is called, the server intercepts the `clientIO.shutdown()` call and shuts itself down directly — closing the WebSocket server, saving conversation state, removing the PID file, and exiting. All connected clients are disconnected via the WebSocket close event.

### `/shutdown` slash command (CLI only)

The `/shutdown` slash command sends a shutdown request over the existing connection, then exits the CLI.

### `agent-cli server stop`

Stops the agent server from the command line without joining a conversation:

```bash
agent-cli server stop              # graceful WebSocket shutdown
agent-cli server stop --force      # graceful first, then SIGKILL via PID file
```

### PID file tracking

The server writes `~/.typeagent/server-<port>.pid` on startup and removes it on graceful shutdown. This enables force-stop when the server is unreachable (hung, hidden, etc.). The `--force` flag reads the PID file and sends SIGKILL after a 5-second graceful timeout.

### Force-stop flow

```
stopAgentServer(port, force=true):
  1. Try graceful WebSocket RPC shutdown
  2. Wait up to 5 seconds
  3. If timeout/failure: read PID file, SIGKILL, clean up PID file
```
