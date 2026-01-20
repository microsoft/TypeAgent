# Coder Wrapper

A pseudo terminal wrapper for CLI coding assistants (Claude Code, etc.) with caching support.

## Overview

The Coder Wrapper provides a transparent PTY (pseudo terminal) wrapper around CLI coding assistants. It:

- **Spawns assistants** in a pseudo terminal for proper TTY support
- **Transparently passes through** all I/O between the user and the assistant
- **Supports multiple assistants** with a pluggable configuration system
- **Will add caching** (future) to check TypeAgent cache before forwarding requests

## Installation

```bash
cd packages/coderWrapper
npm install
npm run build
```

## Usage

### Basic Usage

```bash
# Use Claude Code (default)
npm start

# Or using the built binary
node dist/cli.js
```

### Command Line Options

```bash
coder-wrapper [options]

Options:
  -a, --assistant <name>  Specify the assistant to use (default: claude)
  -d, --debug            Enable debug logging with cache timing information
  -h, --help             Show this help message
```

### Examples

```bash
# Use Claude Code
coder-wrapper

# Explicitly specify Claude
coder-wrapper -a claude

# Enable debug mode to see cache hit/miss timing
coder-wrapper --debug
```

## How It Works

1. **PTY Wrapper**: Uses `node-pty` to spawn the assistant in a pseudo terminal
2. **Cache Checking**: Intercepts user input and checks TypeAgent cache before forwarding to assistant
3. **Cache Hit**: Executes cached actions and returns results immediately (bypasses assistant)
4. **Cache Miss**: Forwards input to the assistant normally
5. **Transparent I/O**: All stdin/stdout/stderr is passed through unchanged
6. **Terminal Features**: Supports colors, cursor control, and terminal resizing
7. **Clean Exit**: Handles Ctrl+C and process termination gracefully

### Debug Mode

When `--debug` is enabled, the wrapper logs:
- Cache check attempts with command text
- Cache hit/miss status with timing (in milliseconds)
- Whether request was forwarded to assistant
- Total time for cache hits

Example debug output:
```
[CoderWrapper:Debug] Checking cache for: "play hello by adele"
[CoderWrapper:Debug] ✓ Cache HIT (234.56ms)
[Action result displayed here]
[CoderWrapper:Debug] Command completed from cache in 234.56ms
```

## Architecture

```
┌─────────────┐
│    User     │
└──────┬──────┘
       │ stdin/stdout
┌──────▼──────────┐
│  Coder Wrapper  │
│  (node-pty)     │
└──────┬──────────┘
       │ PTY
┌──────▼──────────┐
│ Claude Code CLI │
│  (or other)     │
└─────────────────┘
```

## Adding New Assistants

Edit `src/assistantConfig.ts` to add new assistants:

```typescript
export const ASSISTANT_CONFIGS: Record<string, AssistantConfig> = {
  claude: {
    name: "Claude Code",
    command: "claude",
    args: [],
  },
  aider: {
    name: "Aider",
    command: "aider",
    args: [],
  },
  // Add more...
};
```

## Features

- [x] Cache checking before forwarding to assistant
- [x] Debug mode with timing metrics for cache operations
- [x] Transparent PTY passthrough
- [x] Support for multiple CLI assistants

## Future Enhancements

- [ ] Request/response logging to file
- [ ] Cumulative cache hit/miss statistics
- [ ] Support for intercepting and modifying requests
- [ ] Configuration file support

## Development

```bash
# Build
npm run build

# Format
npm run prettier:fix

# Clean
npm run clean
```

## License

MIT

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
