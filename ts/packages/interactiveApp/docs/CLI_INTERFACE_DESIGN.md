# Claude Code-like CLI Interface Design for TypeAgent

## Overview

This document outlines the design for enhancing TypeAgent's CLI interface to provide a more polished, Claude Code-like experience with:

1. Animated spinners during model calls
2. Horizontal separators for visual structure
3. Streaming output above the spinner
4. A well-defined prompt area

## Current State Analysis

### Existing Infrastructure

| Component        | Location                              | Features                                        |
| ---------------- | ------------------------------------- | ----------------------------------------------- |
| Spinner          | `agentSdkWrapper/src/spinner.ts`      | Basic Braille animation, cursor hiding          |
| ConsoleWriter    | `interactiveApp/src/InteractiveIo.ts` | Write helpers, inline updates, progress bar     |
| Console ClientIO | `dispatcher/src/helpers/console.ts`   | Color-coded output, append modes, notifications |
| CLI Commands     | `cli/src/commands/`                   | oclif-based interactive mode                    |

### Technologies in Use

- **chalk** (v5.4.1) - Terminal colors/styling
- **readline/promises** - Interactive input
- **string-width** - Terminal width calculation
- ANSI escape codes for cursor control

## Proposed Architecture

### New Module: `terminalUI`

Create a new module in `packages/interactiveApp/src/terminalUI.ts` that provides:

```
┌─────────────────────────────────────────────────────────────────┐
│ TypeAgent                                                       │
├─────────────────────────────────────────────────────────────────┤
│ [Output Area - scrollable content appears here]                 │
│                                                                 │
│ Tool output, model responses, status messages...                │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ ⠋ thinking... [status indicator line]                          │
├─────────────────────────────────────────────────────────────────┤
│ 🤖 TypeAgent > [prompt input area]                              │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. EnhancedSpinner Class

```typescript
interface SpinnerOptions {
  text?: string; // "thinking", "running tool", etc.
  color?: ChalkColor; // Spinner color
  frames?: string[]; // Animation frames
  interval?: number; // Animation speed (ms)
}

class EnhancedSpinner {
  private text: string;
  private outputBuffer: string[] = [];

  start(options?: SpinnerOptions): void;
  stop(): void;

  // Key feature: Output appears ABOVE the spinner
  addOutput(content: string): void;
  updateText(text: string): void;

  // For streaming responses
  appendStream(chunk: string): void;
}
```

#### 2. TerminalLayout Class

```typescript
interface LayoutOptions {
  showHeader?: boolean;
  headerText?: string;
  separatorChar?: string; // '─' by default
}

class TerminalLayout {
  private spinner: EnhancedSpinner;

  // Visual separators
  drawHorizontalLine(): void;
  drawHeader(text: string): void;

  // Output management
  writeAboveSpinner(content: string): void;

  // Prompt area
  showPrompt(prompt: string): Promise<string>;

  // Status line
  setStatus(status: string): void;
}
```

#### 3. ANSI Escape Code Utilities

```typescript
const ANSI = {
  // Cursor control
  hideCursor: "\x1B[?25l",
  showCursor: "\x1B[?25h",
  saveCursor: "\x1B7",
  restoreCursor: "\x1B8",

  // Line manipulation
  clearLine: "\x1B[2K",
  clearToEnd: "\x1B[K",
  carriageReturn: "\r",

  // Cursor movement
  moveUp: (n: number) => `\x1B[${n}A`,
  moveDown: (n: number) => `\x1B[${n}B`,
  moveToColumn: (n: number) => `\x1B[${n}G`,
  moveToStart: "\x1B[1G",

  // Screen
  clearScreen: "\x1Bc",

  // Scrolling region (key for output-above-spinner)
  setScrollRegion: (top: number, bottom: number) => `\x1B[${top};${bottom}r`,
  resetScrollRegion: "\x1B[r",
};
```

## Implementation Strategy

### Phase 1: Enhanced Spinner with Output Above

The key technique for showing output above a spinner:

```typescript
class EnhancedSpinner {
  private spinnerLine = 0;
  private outputLines: string[] = [];

  addOutput(content: string): void {
    // 1. Move cursor up to saved position
    process.stdout.write(ANSI.moveUp(1));

    // 2. Clear the spinner line
    process.stdout.write(ANSI.clearLine);

    // 3. Write the new content
    process.stdout.write(content + "\n");

    // 4. Redraw the spinner on the next line
    this.redrawSpinner();
  }

  private redrawSpinner(): void {
    process.stdout.write(
      ANSI.carriageReturn + ANSI.clearLine + this.getCurrentFrame(),
    );
  }
}
```

### Phase 2: Visual Separators

```typescript
function drawSeparator(char: string = "─"): void {
  const width = process.stdout.columns || 80;
  console.log(chalk.dim(char.repeat(width)));
}

function drawBoxedHeader(text: string): void {
  const width = process.stdout.columns || 80;
  const padding = Math.max(0, Math.floor((width - text.length - 4) / 2));
  const line = "─".repeat(width);

  console.log(chalk.dim(line));
  console.log(chalk.bold(`  ${text}`));
  console.log(chalk.dim(line));
}
```

### Phase 3: Integrated Prompt Area

```typescript
async function showPromptWithLayout(
  prompt: string,
  spinner: EnhancedSpinner,
): Promise<string> {
  // Stop spinner before showing prompt
  spinner.stop();

  // Draw separator above prompt
  drawSeparator();

  // Show styled prompt
  const result = await readline.question(chalk.cyan(prompt));

  // Draw separator below prompt (before processing)
  drawSeparator();

  return result;
}
```

## Animation Frames (Extended Options)

### Braille Spinner (Current)

```typescript
["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
```

### Dots Spinner

```typescript
["⠋", "⠙", "⠚", "⠞", "⠖", "⠦", "⠴", "⠲", "⠳", "⠓"];
```

### Line Spinner

```typescript
["|", "/", "-", "\\"];
```

### Bouncing Bar

```typescript
[
  "[    ]",
  "[=   ]",
  "[==  ]",
  "[=== ]",
  "[ ===]",
  "[  ==]",
  "[   =]",
  "[    ]",
];
```

### Growing Dots

```typescript
["   ", ".  ", ".. ", "...", " ..", "  .", "   "];
```

## Color Schemes

```typescript
const themes = {
  default: {
    spinner: chalk.cyan,
    status: chalk.dim,
    separator: chalk.dim,
    prompt: chalk.cyanBright,
    success: chalk.greenBright,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.gray,
  },
  minimal: {
    spinner: chalk.white,
    status: chalk.gray,
    separator: chalk.gray,
    prompt: chalk.white,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.gray,
  },
};
```

## Integration Points

### 1. Dispatcher Integration

Modify `dispatcher/src/helpers/console.ts`:

```typescript
import { TerminalLayout, EnhancedSpinner } from "@typeagent/interactive-app";

function createConsoleClientIO(rl?: readline.promises.Interface): ClientIO {
  const layout = new TerminalLayout();
  const spinner = new EnhancedSpinner();

  return {
    setDisplay(message: IAgentMessage): void {
      // Write above spinner if spinning
      if (spinner.isActive()) {
        layout.writeAboveSpinner(formatContent(message));
      } else {
        displayContent(message.message);
      }
    },

    // ... other methods using layout
  };
}
```

### 2. Request Processing Integration

```typescript
async function processCommand(request: string, context: T): Promise<void> {
  const spinner = new EnhancedSpinner();

  // Start spinner while processing
  spinner.start({ text: "Processing..." });

  try {
    // Hook into model calls to update spinner text
    context.onModelCall = () => spinner.updateText("Calling model...");
    context.onToolCall = (tool) => spinner.updateText(`Running ${tool}...`);
    context.onOutput = (text) => spinner.addOutput(text);

    await dispatcher.processCommand(request);
  } finally {
    spinner.stop();
  }
}
```

## Example Session

```
────────────────────────────────────────────────────────────────────
TypeAgent                                          [player, calendar]
────────────────────────────────────────────────────────────────────

User: play something by taylor swift

────────────────────────────────────────────────────────────────────

Searching for Taylor Swift tracks...
Found 47 matching tracks.

⠹ Selecting best match...

────────────────────────────────────────────────────────────────────
🎵 Now playing: "Shake It Off" by Taylor Swift
────────────────────────────────────────────────────────────────────

🤖 TypeAgent [🎵] > _
```

## Dependencies

No new external dependencies required. The implementation uses:

- Native Node.js APIs (`process.stdout`, `readline`)
- Existing `chalk` dependency
- ANSI escape codes (universal terminal support)

## Testing Considerations

1. **TTY Detection**: Check `process.stdout.isTTY` before using advanced features
2. **Fallback Mode**: Simple output for non-TTY environments (pipes, CI)
3. **Terminal Width**: Use `process.stdout.columns` with fallback to 80
4. **Color Support**: Chalk handles this automatically

## Next Steps

1. Create `terminalUI.ts` with EnhancedSpinner class
2. Add TerminalLayout class with separator methods
3. Integrate with existing console.ts ClientIO
4. Test with interactive mode
5. Add configuration options (themes, animations)
