# Agent SDK Wrapper

Direct integration with the Anthropic Agent SDK with TypeAgent caching support.

## Overview

This package provides a CLI tool that uses the Anthropic Agent SDK (`@anthropic-ai/claude-agent-sdk`) directly, with intelligent caching through TypeAgent's cache infrastructure. It represents a different architectural approach compared to the PTY-based `coderWrapper`.

## Architecture Differences

### Agent SDK Wrapper (this package)

- **Direct API Integration**: Uses the Agent SDK's `query()` function directly
- **Programmatic Control**: Full control over the request/response cycle in TypeScript
- **Streaming Support**: Can leverage the SDK's streaming capabilities
- **Custom Tool Configuration**: Can specify which tools to enable per request
- **Simpler I/O**: Standard readline interface for user input
- **Cache-First**: Checks TypeAgent cache before making any API calls
- **Lightweight**: No pseudo-terminal overhead, just API calls

### PTY Wrapper (coderWrapper)

- **Process Wrapping**: Spawns Claude Code CLI in a pseudo-terminal
- **Transparent Passthrough**: Acts as a man-in-the-middle, intercepting I/O
- **Terminal Emulation**: Provides full terminal experience with colors, formatting
- **CLI-First**: Wraps existing CLI tools without modification
- **Cache Injection**: Intercepts commands and injects cached responses
- **Heavier**: Requires node-pty and terminal emulation

## Benefits of Direct Agent SDK Usage

1. **Better Performance**: No process spawning or PTY overhead
2. **More Control**: Can customize every aspect of the API call
3. **Easier Testing**: Pure TypeScript functions are easier to test
4. **Programmatic Access**: Can be imported and used in other TypeScript code
5. **Cleaner Code**: No terminal escape codes or PTY management
6. **Tool Selection**: Can dynamically enable/disable specific tools
7. **Streaming**: Can implement streaming responses efficiently

## Installation

From the TypeAgent repository root:

```bash
cd ts/packages/agentSdkWrapper
npm install
npm run build
```

## Usage

### Basic Usage

```bash
# Start the interactive CLI with defaults (Sonnet, cache enabled)
npm start

# Or use the binary directly
node dist/cli.js
```

### Command Line Options

```bash
# Use Claude Opus instead of Sonnet
npm start -- -m opus

# Use a specific model ID
npm start -- -m claude-sonnet-4-5-20250929

# Enable debug mode with timing information
npm start -- --debug

# Disable cache checking
npm start -- --no-cache

# Enable only specific tools
npm start -- -t bash,read,write

# Combine options
npm start -- -m opus --debug -t bash,read
```

### Interactive Commands

Once running, you can:

- Type your prompts and press Enter
- Type `exit`, `quit`, `.exit`, or `.quit` to quit
- Press Ctrl+C to exit

### Voice Input

The Agent SDK wrapper supports voice input with four transcription options:

**Option 1: Azure Speech Services (Recommended - Most Accurate)**

Set your Azure Speech credentials as environment variables:

```bash
export AZURE_SPEECH_KEY=your-speech-key
export AZURE_SPEECH_REGION=your-region  # e.g., westus2, eastus
```

Or create a `.env` file in the TypeAgent repository root (`ts` directory):

```
AZURE_SPEECH_KEY=your-speech-key
AZURE_SPEECH_REGION=your-region
```

This provides the best transcription accuracy using Azure Cognitive Services Speech-to-Text with built-in silence detection. No external tools or complex setup required!

**Option 2: Azure OpenAI (Enterprise Whisper)**

Set your Azure OpenAI credentials as environment variables:

```bash
export AZURE_OPENAI_API_KEY=your-key
export AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
export AZURE_OPENAI_DEPLOYMENT_NAME=whisper  # Optional, defaults to "whisper"
```

Or create a `.env` file in the TypeAgent repository root (`ts` directory):

```
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT_NAME=whisper
```

**Option 3: OpenAI Whisper API**

Set your OpenAI API key as an environment variable:

```bash
export OPENAI_API_KEY=sk-...
```

Or create a `.env` file in the TypeAgent repository root (`ts` directory):

```
OPENAI_API_KEY=sk-...
```

This provides excellent transcription accuracy and requires no local setup.

**Option 4: Local Whisper Service**

If you don't have cloud API credentials, start the local Whisper service (requires GPU for best performance):

```bash
cd python/stt/whisperService
python faster-whisper.py
```

The system will automatically detect and use the best available provider based on environment variables:

1. Azure Speech Services (if `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` are set)
2. Azure OpenAI (if `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_ENDPOINT` are set)
3. OpenAI (if `OPENAI_API_KEY` is set)
4. Local Whisper service (fallback)

**Note:**

- Azure Speech Services uses the Speech SDK's built-in audio capture - no external tools required!
- Other providers use Node.js native audio APIs (via the `mic` package) - no external tools required!

**Using Voice Input:**

- **Type `/voice` or `/v` or `:v`** - Press Enter to start recording
- **Press `Ctrl+V`** - Hotkey to start recording immediately

When recording:

- Speak your question naturally
- Wait 1 second of silence to end recording
- Your speech will be transcribed and processed automatically

**Example:**

```
> /voice
🎤 Recording... (speak now, 1 second of silence will end recording)

[speak: "what is the capital of France"]

🔇 Silence detected, processing...

📝 Transcribed: "what is the capital of France"

Claude will respond with the answer...
```

**Note:** If the Whisper service is not running, voice input will be disabled and you'll see a message on startup with instructions to enable it.

## How It Works

1. **User Input**: Reads prompts via readline interface
2. **Cache Check**: If cache is enabled, checks TypeAgent's cache first
3. **Cache Hit**: Returns cached result immediately with timing info, and stores the interaction for context injection
4. **Cache Miss**: Calls Agent SDK's `query()` function with configured options
5. **Context Injection**: When a cache hit occurs, the next user message automatically includes context about the cached interaction via a `UserPromptSubmit` hook
6. **Streaming**: Displays the response from Claude
7. **Debug Mode**: Logs detailed timing and cache information

### Cache Context Injection

When a cache hit occurs, the cached request and result are stored temporarily. On the next user message, a `UserPromptSubmit` hook automatically injects this context into the conversation, allowing Claude to reference the cached interaction in follow-up questions.

**Example:**

```
> get playlist brandenburg
(45ms)  # Cache hit
────────────────────────────────────────────────────────────────────────────────
[Playlist results...]
────────────────────────────────────────────────────────────────────────────────

> what's track 7 from that playlist?
# Claude now has context about the previous cache hit and can answer
```

This solves the problem where cache hits were invisible to Claude's conversation history.

## Cache Integration

The wrapper reuses the `CacheClient` from the `coderWrapper` package, which:

- Connects to TypeAgent's MCP server (`commandExecutor`)
- Checks if a command has been executed before
- Returns cached results instantly when available
- Falls back to API calls on cache misses

## Configuration

### Model Selection

- `sonnet`: Claude Sonnet 4.5 (default) - `claude-sonnet-4-5-20250929`
- `opus`: Claude Opus 4.5 - `claude-opus-4-5-20251101`
- Or provide any custom model ID

### Tool Selection

By default, all tools are enabled. You can restrict to specific tools:

```bash
# Enable only bash and file reading
npm start -- -t bash,read

# Enable only write operations
npm start -- -t write
```

Available tools depend on the Agent SDK configuration.

### MCP Server Integration

The Agent SDK wrapper automatically configures the `command-executor` MCP server, which provides access to:

- **Music & media control**: Play songs, control playback
- **List management**: Shopping lists, todo lists
- **Calendar operations**: Schedule events, view calendar
- **VSCode automation**: Change themes, open files, create folders, run tasks, manage editor layout

The MCP server is configured to use the TypeAgent dispatcher at `ws://localhost:8999`. Make sure the TypeAgent server is running:

```bash
# From the TypeAgent repository root
pnpm run start:agent-server
```

The command-executor tool is available with permission mode set to `acceptEdits`, meaning Claude can execute commands without asking for permission each time.

#### MCP Connection Lifecycle

**When used with Agent SDK wrapper (this package):**

- The Agent SDK spawns a new Claude Code process for each `query()` call (using `--continue` flag for session continuity)
- Each query spawns a fresh Claude Code process with a new command-executor MCP server instance
- MCP server connects to agentServer, executes tools, then disconnects when the query completes
- This transient connection pattern is normal and expected for the Agent SDK architecture

**When command-executor is called directly from Claude Code CLI:**

- The MCP server maintains a persistent connection throughout the session
- Connection persists across multiple user requests until the CLI exits

The agentServer logs "Client connected/disconnected" messages to help debug connection issues. The agentServer maintains a single persistent shared dispatcher that handles requests from all MCP connections (whether transient or persistent).

### Debug Mode

Debug mode provides:

- Timing information for cache checks
- Timing information for API calls
- Cache hit/miss logging
- Detailed log file in `~/.tmp/typeagent-coder-wrapper/`

## Examples

### Example 1: Quick Question (Cache Miss)

```
> What is TypeScript?
(1234ms)
────────────────────────────────────────────────────────────────────────────────
TypeScript is a strongly typed programming language that builds on JavaScript...
────────────────────────────────────────────────────────────────────────────────
```

### Example 2: Same Question (Cache Hit)

```
> What is TypeScript?
(45ms)
────────────────────────────────────────────────────────────────────────────────
TypeScript is a strongly typed programming language that builds on JavaScript...
────────────────────────────────────────────────────────────────────────────────
```

### Example 3: With Debug Mode

```
> npm start -- --debug

[AgentSDK] Debug log: /home/user/.tmp/typeagent-coder-wrapper/coder-wrapper-1234567890.log

> What is TypeScript?
(45ms)
────────────────────────────────────────────────────────────────────────────────
TypeScript is a strongly typed programming language that builds on JavaScript...
────────────────────────────────────────────────────────────────────────────────
```

## Development

### Build

```bash
npm run build
```

### Clean

```bash
npm run clean
```

### Format Code

```bash
npm run prettier:fix
```

## Dependencies

- `@anthropic-ai/claude-agent-sdk`: Direct API access to Claude via Agent SDK
- `@modelcontextprotocol/sdk`: MCP protocol for cache communication
- `coder-wrapper`: Reuses CacheClient and DebugLogger utilities

## Features

- ✅ **Voice Input**: Local Whisper transcription with silence detection
- ✅ **Cache Integration**: Automatic caching of requests and responses
- ✅ **MCP Server**: Integration with TypeAgent's command executor
- ✅ **Context Injection**: Cached results are available in conversation context
- ✅ **Multiple Models**: Support for Sonnet, Opus, and custom model IDs
- ✅ **Tool Selection**: Configurable tool permissions
- ✅ **Debug Mode**: Detailed timing and logging information

## Future Enhancements

Possible improvements:

1. **Cloud Transcription**: Add OpenAI Whisper API support for systems without GPU
2. **Streaming Output**: Implement real-time streaming of responses
3. **File Attachments**: Support uploading files with prompts
4. **Custom Tools**: Allow registering custom tool implementations
5. **Response Formatting**: Better markdown rendering in terminal
6. **History**: Command history with up/down arrows
7. **Auto-completion**: Tab completion for common commands

## License

MIT - Copyright (c) Microsoft Corporation

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
