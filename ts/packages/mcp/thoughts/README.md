# Thoughts MCP Server

Convert raw text, stream-of-consciousness, and unstructured notes into well-formatted markdown documents using Claude. Also supports audio transcription from WAV files.

## Features

- **MCP Server**: Expose thoughts processing as MCP tools
- **CLI Utility**: Use directly from command line
- **Audio Transcription**: Automatically transcribe WAV files using OpenAI's Whisper
- **Flexible Input**: Read from text files, audio files, or stdin
- **Custom Instructions**: Guide the formatting with additional instructions
- **Markdown Output**: Clean, well-organized markdown with proper structure

## Installation

```bash
npm install @typeagent/thoughts
```

## Environment Variables

For audio transcription support, set:
```bash
export OPENAI_API_KEY="your-api-key-here"
```

## Usage

### As CLI

```bash
# Read from stdin, write to stdout
echo "my raw thoughts here" | thoughts

# Read from text file
thoughts notes.txt

# Transcribe audio file and convert to markdown
thoughts recording.wav -o output.md

# Write to output file
thoughts -i notes.txt -o output.md

# With custom instructions
thoughts notes.txt -o output.md --instructions "Format as a technical document"

# Transcribe audio with custom formatting
thoughts voice_memo.wav -o notes.md --instructions "Format as meeting notes with action items"

# Using pipe
cat stream_of_consciousness.txt | thoughts > organized.md
```

### CLI Options

```
-i, --input <file>         Input file - text or .wav (or "-" for stdin, default: stdin)
-o, --output <file>        Output file (or "-" for stdout, default: stdout)
--instructions <text>      Additional formatting instructions
-m, --model <model>        Claude model to use (default: claude-sonnet-4-20250514)
-h, --help                 Show help message
```

**Note**: WAV files are automatically detected by the `.wav` extension and transcribed using OpenAI's Whisper API before being processed by Claude.

### As MCP Server

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "thoughts": {
      "command": "node",
      "args": [
        "/path/to/TypeAgent/ts/packages/mcp/thoughts/dist/index.js"
      ]
    }
  }
}
```

Or use with `npx`:

```json
{
  "mcpServers": {
    "thoughts": {
      "command": "npx",
      "args": ["-y", "@typeagent/thoughts"]
    }
  }
}
```

### Available MCP Tools

#### process_thoughts

Convert raw text into markdown:

```typescript
{
  "rawText": "your raw notes here...",
  "instructions": "Format as meeting notes", // optional
  "model": "claude-sonnet-4-20250514" // optional
}
```

#### save_markdown

Save markdown to a file:

```typescript
{
  "content": "# Your Markdown\n\nContent here...",
  "filePath": "/path/to/output.md"
}
```

## Examples

### Stream of Consciousness to Blog Post

```bash
thoughts raw_ideas.txt -o blog_post.md --instructions "Format as a blog post with engaging introduction"
```

### Voice Memo to Meeting Notes

```bash
thoughts meeting_recording.wav -o notes.md --instructions "Format as meeting notes with action items"
```

### Audio Brainstorm to Technical Documentation

```bash
thoughts voice_ideas.wav -o docs.md --instructions "Format as technical documentation with clear sections"
```

### Meeting Notes from Text

```bash
thoughts meeting_transcript.txt -o notes.md --instructions "Format as meeting notes with action items"
```

### Technical Documentation

```bash
thoughts tech_notes.txt -o docs.md --instructions "Format as technical documentation with code examples"
```

## Development

```bash
# Build
npm run build

# Watch mode
npm run watch

# Clean
npm run clean
```

## License

MIT
