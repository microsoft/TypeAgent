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
- Explicit CLI flags override user settings

### Shell (`packages/shell/src/main/instance.ts`)

- On startup, load user settings and apply to `ensureAgentServer()` calls
- Shell settings UI can be extended later

## Storage Layer

The settings module lives in `packages/dispatcher/dispatcher/src/helpers/userSettings.ts` alongside the existing `userData.ts`. It uses the same `getUserDataDir()` base path.

- Read: returns merged defaults + saved settings
- Write: deep-merges partial updates and persists
- File locking: not currently implemented; reads and writes use synchronous `fs` calls without locking. If concurrent access becomes a concern (e.g. multiple shell instances), consider adopting the `proper-lockfile` pattern from `userData.ts`.

## Migration Strategy

- If `user-settings.json` does not exist, all defaults apply
- New settings fields added in future versions get their defaults automatically via deep-merge
- No schema version field needed initially; the merge-with-defaults pattern handles forward compatibility
