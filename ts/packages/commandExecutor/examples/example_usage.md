# Command Executor MCP Server - Example Usage

## Configuration

To use this MCP server with Claude Desktop, add the following to your Claude Desktop configuration:

### Windows
Edit `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "command-executor": {
      "command": "node",
      "args": [
        "C:/Users/YOUR_USERNAME/src/TypeAgent/ts/packages/commandExecutor/dist/server.js"
      ]
    }
  }
}
```

### macOS
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "command-executor": {
      "command": "node",
      "args": [
        "/Users/YOUR_USERNAME/src/TypeAgent/ts/packages/commandExecutor/dist/server.js"
      ]
    }
  }
}
```

## Example Commands

Once configured, you can ask Claude to execute various commands:

### Music Commands
- "Play shake it off by taylor swift"
- "Skip to the next song"
- "Pause the music"
- "Set volume to 50%"

### List Management
- "Add ham to my grocery list"
- "Add milk, eggs, and bread to shopping list"
- "Remove bananas from grocery list"
- "Show me my grocery list"

### Calendar Operations
- "Add meeting tomorrow at 3pm"
- "Schedule dentist appointment for next Tuesday at 10am"
- "What's on my calendar today?"
- "Cancel my 2pm meeting"

## Testing

The server will log all incoming requests to the console. You can verify it's working by:

1. Restart Claude Desktop after updating the configuration
2. Send a command like "Add ham to my grocery list"
3. Claude will use the `execute_command` tool and receive: `Finished add ham to my grocery list`

## Current Behavior

The MCP server currently:
- Accepts command requests via the `execute_command` tool
- Logs the request to the console
- Returns a success message to Claude

Future versions will integrate with an actual command execution service to perform the requested actions.
