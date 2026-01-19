<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# VSCode Capabilities Available Through Command Executor

The Command Executor MCP server can control VSCode through the Coda extension. Below are the available capabilities organized by category.

## How It Works

```
User → Claude Code → execute_command MCP tool →
  → TypeAgent Dispatcher →
  → Coda Extension (WebSocket on port 8082) →
  → VSCode APIs
```

The Coda VSCode extension connects to TypeAgent's dispatcher and can execute various VSCode commands. Simply use natural language with the `execute_command` tool.

## Available Commands

### Theme & Appearance

**Change Color Theme:**

- "switch to monokai theme"
- "change theme to dark+"
- "change to light theme"
- "set theme to solarized dark"

**Display Controls:**

- "toggle full screen"
- "toggle zen mode"
- "zoom in" (zooms in 5 levels)
- "zoom out" (zooms out 5 levels)
- "reset zoom"

### Editor Layout

**Split Editor:**

- "split editor to the right" (splits currently focused editor)
- "split editor to the left"
- "split editor up"
- "split editor down"
- "split the first editor to the right" (splits leftmost editor)
- "split the last editor" (splits rightmost editor)
- "split app.tsx to the right" (splits editor with app.tsx file)
- "split the typescript file" (splits editor with a .ts file)

**Column Layout:**

- "change editor to single column"
- "change editor to double columns"
- "change editor to three columns"
- "toggle editor layout"

**Editor Management:**

- "close editor"

### File & Folder Operations

**Open Files:**

- "open file app.ts"
- "open main.py"
- "goto file index.html"

**Navigate:**

- "goto line 42"
- "goto file package.json"

**Create Files:**

- "create new file" (untitled)
- "create file hello.ts in src folder"

**Create Folders:**

- "create folder called components"
- "create folder utils in src"

**Open Folders:**

- "open folder src in explorer"
- "reveal packages folder"

### Views & Panels

**Show Views:**

- "show explorer"
- "open explorer view"
- "show search"
- "show source control"
- "show output panel"

**Special Views:**

- "toggle search details"
- "replace in files"
- "open markdown preview"
- "open markdown preview to side"

### Navigation & Commands

**Command Palette:**

- "show command palette"

**Quick Open:**

- "quick open file"

**Settings:**

- "open settings"
- "show user settings"
- "show keyboard shortcuts"

### Terminal

**Open Terminal:**

- "open integrated terminal"
- "open terminal in src folder"
- "open terminal and run npm install"

### Tasks & Build

**Run Tasks:**

- "build the project"
- "clean the project"
- "rebuild the project"
- "run build task in packages folder"

### Window Management

**New Windows:**

- "open new window"

## Usage Examples

### Example 1: Change Theme

**User to Claude Code:**

```
switch to monokai theme
```

**Claude Code calls:**

```json
{
  "tool": "execute_command",
  "arguments": {
    "request": "switch to monokai theme"
  }
}
```

**Result:**

```
Changed theme to Monokai
```

### Example 2: Open File and Split Editor

**User to Claude Code:**

```
open app.ts and split the editor to the right
```

**Claude Code can:**

1. Call execute_command with "open app.ts"
2. Call execute_command with "split editor to the right"

Or TypeAgent might handle both in one call.

### Example 3: Create Project Structure

**User to Claude Code:**

```
create folders called src, tests, and docs
```

**Claude Code calls:**

```json
{
  "tool": "execute_command",
  "arguments": {
    "request": "create folders called src, tests, and docs"
  }
}
```

## Implementation Details

### How Coda Extension Handles Commands

The Coda extension listens for WebSocket messages from TypeAgent's Code Agent:

```typescript
// Message format from TypeAgent
{
  id: "123",
  method: "code/changeColorScheme",
  params: {
    theme: "Monokai"
  }
}

// Response from Coda
{
  id: "123",
  result: "Changed theme to Monokai"
}
```

### Action Handlers

Commands are routed through several handlers:

1. **handleBaseEditorActions**: Theme, split, layout, new file
2. **handleGeneralKBActions**: Command palette, goto, settings
3. **handleDisplayKBActions**: Views, panels, zoom, full screen
4. **handleWorkbenchActions**: Files, folders, tasks, terminal
5. **handleDebugActions**: Debugging operations
6. **handleExtensionActions**: Extension management
7. **handleEditorCodeActions**: Code editing, refactoring

See source files in `packages/coda/src/handle*.ts` for full details.

### Available Action Names

Here are the internal action names (useful for understanding the code):

**Base Editor:**

- `changeColorScheme`
- `splitEditor`
- `changeEditorLayout`
- `newFile`

**Display:**

- `toggleFullScreen`
- `toggleEditorLayout`
- `zoomIn`, `zoomOut`, `fontZoomReset`
- `showExplorer`, `showSearch`, `showSourceControl`
- `showOutputPanel`
- `toggleSearchDetails`
- `replaceInFiles`
- `openMarkdownPreview`, `openMarkdownPreviewToSide`
- `zenMode`
- `closeEditor`
- `openSettings`

**General:**

- `showCommandPalette`
- `gotoFileOrLineOrSymbol`
- `newWindowFromApp`
- `showUserSettings`
- `showKeyboardShortcuts`

**Workbench:**

- `workbenchOpenFile`
- `workbenchOpenFolder`
- `workbenchCreateFolderFromExplorer`
- `workbenchBuildRelatedTask`
- `openInIntegratedTerminal`

## Prerequisites

To use these VSCode capabilities:

1. **TypeAgent Dispatcher** must be running:

   ```bash
   pnpm run start:agent-server
   ```

2. **Coda Extension** must be installed and activated in VSCode:

   - Published as `aisystems.copilot-coda`
   - Auto-connects to dispatcher on port 8082

3. **Command Executor MCP Server** configured in `.mcp.json`:
   ```json
   {
     "mcpServers": {
       "command-executor": {
         "command": "node",
         "args": ["packages/commandExecutor/dist/server.js"]
       }
     }
   }
   ```

## Limitations

1. **Natural Language Translation**: Commands must be clear enough for TypeAgent to translate to the correct action
2. **File/Folder Matching**: File and folder names are matched via search, so ambiguous names might require user selection
3. **Terminal Commands**: High-risk terminal commands are blocked for security
4. **Theme Names**: Theme names must match installed themes exactly

## Testing Commands

You can test these commands directly in Claude Code:

```
// Test theme changing
switch to monokai theme

// Test editor layout
split editor to the right

// Test file operations
open package.json

// Test views
show explorer

// Test terminal
open integrated terminal
```

## Extending Capabilities

To add new VSCode capabilities:

1. Add handler in `packages/coda/src/handle*.ts`
2. Register in `handleVSCodeActions` function
3. Update this documentation
4. No changes needed to MCP server (it forwards all commands to dispatcher)

The beauty of this architecture is that new capabilities added to Coda are automatically available through the MCP server without any code changes to the command executor.
