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
  -h, --help             Show this help message
```

### Examples

```bash
# Use Claude Code
coder-wrapper

# Explicitly specify Claude
coder-wrapper -a claude
```

## How It Works

1. **PTY Wrapper**: Uses `node-pty` to spawn the assistant in a pseudo terminal
2. **Transparent I/O**: All stdin/stdout/stderr is passed through unchanged
3. **Terminal Features**: Supports colors, cursor control, and terminal resizing
4. **Clean Exit**: Handles Ctrl+C and process termination gracefully

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

## Future Enhancements

- [ ] Cache checking before forwarding to assistant
- [ ] Request/response logging
- [ ] Performance metrics
- [ ] Cache hit/miss statistics
- [ ] Support for intercepting and modifying requests

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
