# Thoughts MCP Server

Convert raw text, stream-of-consciousness, and unstructured notes into well-formatted markdown documents using Claude. Also supports audio transcription from WAV files.

## Features

- **MCP Server**: Expose thoughts processing as MCP tools
- **CLI Utility**: Use directly from command line
- **Audio Transcription**: Automatically transcribe WAV files using Azure Cognitive Services
- **Flexible Input**: Read from text files, audio files, or stdin
- **Custom Instructions**: Guide the formatting with additional instructions
- **Keyword Tags**: Add tags for later lookup and organization
- **Inline Tags**: Say "tag this as X" during audio recording to mark specific sections
- **Markdown Output**: Clean, well-organized markdown with proper structure

## Installation

```bash
npm install @typeagent/thoughts
```

## Environment Variables

For audio transcription support, set:

```bash
export AZURE_SPEECH_KEY="your-azure-speech-key"
export AZURE_SPEECH_REGION="your-region"  # e.g., "eastus"
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

# Add tags for later lookup
thoughts notes.txt -o output.md --tags "meeting,q1-2026,planning"

# Transcribe audio with tags and instructions
thoughts meeting.wav -o notes.md --tags "team-meeting,2026-01-23" --instructions "Format as meeting notes"

# Using pipe
cat stream_of_consciousness.txt | thoughts > organized.md
```

### CLI Options

```
-i, --input <file>         Input file - text or .wav (or "-" for stdin, default: stdin)
-o, --output <file>        Output file (or "-" for stdout, default: stdout)
--instructions <text>      Additional formatting instructions
-t, --tags <tags>          Comma-separated tags/keywords (e.g., "meeting,q1-2026,planning")
-m, --model <model>        Claude model to use (default: claude-sonnet-4-20250514)
-h, --help                 Show help message
```

**Notes**:

- WAV files are automatically detected by the `.wav` extension and transcribed using Azure Cognitive Services before being processed by Claude
- Tags are added as a markdown heading section at the end of the document for easy searching and filtering

### Inline Tags

While recording audio or writing text, you can mark specific sections with inline tags by saying or writing phrases like:

- "tag this as marshmallow colors"
- "tag design ideas"
- "tag this as action item"

Claude will automatically:

1. Remove the tag phrase from the content
2. Insert a tag marker at that location: **🏷️ tag-name**
3. Convert the tag to lowercase with hyphens

**Example**:

```
Input: "I think we should use blue and purple. Tag this as color scheme. The fonts need to be modern..."

Output:
I think we should use blue and purple.

**🏷️ color-scheme**

The fonts need to be modern...
```

### As MCP Server

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "thoughts": {
      "command": "node",
      "args": ["/path/to/TypeAgent/ts/packages/mcp/thoughts/dist/index.js"]
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
thoughts meeting_recording.wav -o notes.md --instructions "Format as meeting notes with action items" --tags "team-meeting,2026-01-23,action-items"
```

### Audio Brainstorm to Technical Documentation

```bash
thoughts voice_ideas.wav -o docs.md --instructions "Format as technical documentation with clear sections" --tags "project-alpha,design,brainstorm"
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

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
