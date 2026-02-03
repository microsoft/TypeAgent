// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Terminal UI Module
 *
 * Provides Claude Code-like terminal interface features:
 * - Enhanced spinner with output-above capability
 * - Visual separators (horizontal lines)
 * - Structured layout with header, output area, and prompt
 * - Streaming text support
 */

import stringWidth from "string-width";

/**
 * Get the display width of a string, accounting for:
 * - Full-width characters (CJK)
 * - Emoji characters (including compound emojis)
 * - Zero-width characters
 * - ANSI escape codes (stripped)
 */
export function getDisplayWidth(str: string): number {
    return stringWidth(str);
}

/**
 * Pad a string to a specified display width
 * Accounts for variable-width characters
 */
export function padEndDisplay(str: string, targetWidth: number): string {
    const currentWidth = getDisplayWidth(str);
    if (currentWidth >= targetWidth) {
        return str;
    }
    return str + " ".repeat(targetWidth - currentWidth);
}

/**
 * ANSI escape code utilities for terminal control
 */
export const ANSI = {
    // Cursor visibility
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

    // Colors (fallback if chalk not available)
    gray: "\x1b[90m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    reset: "\x1b[0m",
} as const;

/**
 * Spinner animation frame sets
 */
export const SpinnerFrames: Record<string, string[]> = {
    braille: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    dots: ["⠋", "⠙", "⠚", "⠞", "⠖", "⠦", "⠴", "⠲", "⠳", "⠓"],
    line: ["|", "/", "-", "\\"],
    arc: ["◜", "◠", "◝", "◞", "◡", "◟"],
    circle: ["◐", "◓", "◑", "◒"],
    bounce: ["⠁", "⠂", "⠄", "⠂"],
    pulse: ["█", "▓", "▒", "░", "▒", "▓"],
    arrow: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
};

export type SpinnerFrameSet = string;

/**
 * Options for the enhanced spinner
 */
export interface SpinnerOptions {
    /** Text to display after the spinner */
    text?: string;
    /** Animation frame set to use */
    frames?: SpinnerFrameSet | string[];
    /** Animation interval in milliseconds */
    interval?: number;
    /** Color code (ANSI) for the spinner */
    color?: string;
    /** Output stream (defaults to stdout) */
    stream?: NodeJS.WriteStream;
}

/**
 * Enhanced Spinner with output-above capability
 *
 * Features:
 * - Multiple animation styles
 * - Dynamic text updates
 * - Ability to write content above the spinner
 * - Streaming text accumulation
 */
export class EnhancedSpinner {
    private frames: string[];
    private interval: number;
    private color: string;
    private stream: NodeJS.WriteStream;

    private currentFrame = 0;
    private text = "";
    private timer: NodeJS.Timeout | null = null;
    private isSpinning = false;
    private streamBuffer = "";
    private linesAbove = 0;

    constructor(options: SpinnerOptions = {}) {
        this.frames = Array.isArray(options.frames)
            ? options.frames
            : SpinnerFrames[options.frames ?? "braille"];
        this.interval = options.interval ?? 80;
        this.color = options.color ?? ANSI.cyan;
        this.stream = options.stream ?? process.stdout;
        this.text = options.text ?? "";
    }

    /**
     * Check if the spinner is currently active
     */
    isActive(): boolean {
        return this.isSpinning;
    }

    /**
     * Start the spinner animation
     */
    start(options?: Partial<SpinnerOptions>): void {
        if (this.isSpinning) {
            return;
        }

        if (options?.text) this.text = options.text;
        if (options?.frames) {
            this.frames = Array.isArray(options.frames)
                ? options.frames
                : SpinnerFrames[options.frames];
        }

        this.isSpinning = true;
        this.currentFrame = 0;
        this.linesAbove = 0;

        // Hide cursor for clean animation
        this.stream.write(ANSI.hideCursor);

        // Draw initial frame
        this.render();

        // Start animation loop
        this.timer = setInterval(() => {
            this.currentFrame = (this.currentFrame + 1) % this.frames.length;
            this.render();
        }, this.interval);
    }

    /**
     * Stop the spinner and clear the line
     */
    stop(): void {
        if (!this.isSpinning) {
            return;
        }

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        // Clear spinner line and show cursor
        this.stream.write(ANSI.carriageReturn + ANSI.clearLine);
        this.stream.write(ANSI.showCursor);

        this.isSpinning = false;
        this.streamBuffer = "";
        this.linesAbove = 0;
    }

    /**
     * Stop spinner and show a success message
     */
    succeed(text?: string): void {
        this.stopWithSymbol("✔", ANSI.green, text);
    }

    /**
     * Stop spinner and show a failure message
     */
    fail(text?: string): void {
        this.stopWithSymbol("✖", ANSI.red, text);
    }

    /**
     * Stop spinner and show a warning message
     */
    warn(text?: string): void {
        this.stopWithSymbol("⚠", ANSI.yellow, text);
    }

    /**
     * Stop spinner and show an info message
     */
    info(text?: string): void {
        this.stopWithSymbol("ℹ", ANSI.cyan, text);
    }

    private stopWithSymbol(symbol: string, color: string, text?: string): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        const message = text ?? this.text;
        this.stream.write(ANSI.carriageReturn + ANSI.clearLine);
        this.stream.write(`${color}${symbol}${ANSI.reset} ${message}\n`);
        this.stream.write(ANSI.showCursor);

        this.isSpinning = false;
        this.streamBuffer = "";
    }

    /**
     * Update the spinner text without stopping
     */
    updateText(text: string): void {
        this.text = text;
        if (this.isSpinning) {
            this.render();
        }
    }

    /**
     * Write content ABOVE the spinner (the key Claude Code-like feature)
     *
     * This moves the cursor up, writes the content, then redraws the spinner.
     */
    writeAbove(content: string): void {
        if (!this.isSpinning) {
            // Not spinning, just write normally
            this.stream.write(content + "\n");
            return;
        }

        // Move to start of spinner line and clear it
        this.stream.write(ANSI.carriageReturn + ANSI.clearLine);

        // Write the content
        this.stream.write(content + "\n");
        this.linesAbove++;

        // Redraw spinner on new line
        this.render();
    }

    /**
     * Append streaming text chunk
     *
     * Accumulates text and writes complete lines above the spinner.
     */
    appendStream(chunk: string): void {
        if (!this.isSpinning) {
            this.stream.write(chunk);
            return;
        }

        this.streamBuffer += chunk;

        // Check for complete lines
        const lines = this.streamBuffer.split("\n");
        if (lines.length > 1) {
            // Write all complete lines above spinner
            for (let i = 0; i < lines.length - 1; i++) {
                this.writeAbove(lines[i]);
            }
            // Keep the incomplete line in buffer
            this.streamBuffer = lines[lines.length - 1];
        }
    }

    /**
     * Flush any remaining stream buffer content
     */
    flushStream(): void {
        if (this.streamBuffer) {
            this.writeAbove(this.streamBuffer);
            this.streamBuffer = "";
        }
    }

    /**
     * Render the current spinner frame
     */
    private render(): void {
        const frame = this.frames[this.currentFrame];
        const line = this.text
            ? `${this.color}${frame}${ANSI.reset} ${ANSI.dim}${this.text}${ANSI.reset}`
            : `${this.color}${frame}${ANSI.reset}`;

        this.stream.write(ANSI.carriageReturn + ANSI.clearLine + line);
    }
}

/**
 * Options for drawing separators
 */
export interface SeparatorOptions {
    /** Character to use for the line */
    char?: string;
    /** Width of the separator (defaults to terminal width) */
    width?: number;
    /** Color for the separator */
    color?: string;
    /** Add newline before separator */
    marginTop?: boolean;
    /** Add newline after separator */
    marginBottom?: boolean;
}

/**
 * Terminal layout utilities for visual structure
 */
export class TerminalLayout {
    private stream: NodeJS.WriteStream;
    private spinner: EnhancedSpinner | null = null;

    constructor(stream?: NodeJS.WriteStream) {
        this.stream = stream ?? process.stdout;
    }

    /**
     * Get the terminal width
     */
    getWidth(): number {
        return this.stream.columns || 80;
    }

    /**
     * Draw a horizontal separator line
     */
    drawSeparator(options: SeparatorOptions = {}): void {
        const {
            char = "─",
            width = this.getWidth(),
            color = ANSI.dim,
            marginTop = false,
            marginBottom = false,
        } = options;

        if (marginTop) this.stream.write("\n");
        this.stream.write(`${color}${char.repeat(width)}${ANSI.reset}\n`);
        if (marginBottom) this.stream.write("\n");
    }

    /**
     * Draw a thin separator (using dots or light line)
     */
    drawThinSeparator(): void {
        this.drawSeparator({ char: "·", color: ANSI.dim });
    }

    /**
     * Draw a double-line separator
     */
    drawDoubleSeparator(): void {
        this.drawSeparator({ char: "═" });
    }

    /**
     * Draw a header with text
     */
    drawHeader(text: string, options: SeparatorOptions = {}): void {
        const { char = "─", color = ANSI.dim } = options;
        const width = this.getWidth();

        this.drawSeparator({ char, color, width });
        this.stream.write(`${ANSI.bold}${text}${ANSI.reset}\n`);
        this.drawSeparator({ char, color, width });
    }

    /**
     * Draw a boxed section
     */
    drawBox(
        title: string,
        content: string,
        options: { color?: string } = {},
    ): void {
        const { color = ANSI.dim } = options;
        const width = this.getWidth();
        const line = "─".repeat(width - 2);

        this.stream.write(`${color}┌${line}┐${ANSI.reset}\n`);
        this.stream.write(
            `${color}│${ANSI.reset} ${ANSI.bold}${title}${ANSI.reset}\n`,
        );
        this.stream.write(`${color}├${line}┤${ANSI.reset}\n`);

        const contentLines = content.split("\n");
        for (const contentLine of contentLines) {
            this.stream.write(
                `${color}│${ANSI.reset} ${contentLine}${ANSI.reset}\n`,
            );
        }

        this.stream.write(`${color}└${line}┘${ANSI.reset}\n`);
    }

    /**
     * Write a status line (right-aligned info)
     */
    writeStatus(leftText: string, rightText: string): void {
        const width = this.getWidth();
        const padding = width - leftText.length - rightText.length;
        const spaces = " ".repeat(Math.max(1, padding));

        this.stream.write(
            `${leftText}${spaces}${ANSI.dim}${rightText}${ANSI.reset}\n`,
        );
    }

    /**
     * Clear the screen
     */
    clear(): void {
        this.stream.write("\x1Bc");
    }

    /**
     * Create and return an enhanced spinner
     */
    createSpinner(options?: SpinnerOptions): EnhancedSpinner {
        this.spinner = new EnhancedSpinner({
            ...options,
            stream: this.stream,
        });
        return this.spinner;
    }

    /**
     * Get the current spinner (if any)
     */
    getSpinner(): EnhancedSpinner | null {
        return this.spinner;
    }

    /**
     * Write content, respecting active spinner
     */
    write(content: string): void {
        if (this.spinner?.isActive()) {
            this.spinner.writeAbove(content);
        } else {
            this.stream.write(content + "\n");
        }
    }
}

/**
 * Create a simple progress display
 */
export function createProgressDisplay(
    stream: NodeJS.WriteStream = process.stdout,
): {
    update: (current: number, total: number, message?: string) => void;
    complete: (message?: string) => void;
} {
    const update = (current: number, total: number, message?: string) => {
        const percent = Math.round((current / total) * 100);
        const bar =
            "█".repeat(Math.floor(percent / 5)) +
            "░".repeat(20 - Math.floor(percent / 5));
        const text = message
            ? `${bar} ${percent}% ${message}`
            : `${bar} ${percent}% (${current}/${total})`;

        // Clear previous line and write new
        stream.write(ANSI.carriageReturn + ANSI.clearLine + text);
    };

    const complete = (message?: string) => {
        stream.write(ANSI.carriageReturn + ANSI.clearLine);
        if (message) {
            stream.write(`${ANSI.green}✔${ANSI.reset} ${message}\n`);
        }
    };

    return { update, complete };
}

/**
 * Check if the output stream supports TTY features
 */
export function isTTY(stream: NodeJS.WriteStream = process.stdout): boolean {
    return stream.isTTY === true;
}

/**
 * Wrap a function to show a spinner while it executes
 */
export async function withSpinner<T>(
    options: SpinnerOptions & { successText?: string; failText?: string },
    fn: (spinner: EnhancedSpinner) => Promise<T>,
): Promise<T> {
    const spinner = new EnhancedSpinner(options);
    spinner.start();

    try {
        const result = await fn(spinner);
        spinner.succeed(options.successText);
        return result;
    } catch (error) {
        spinner.fail(options.failText ?? String(error));
        throw error;
    }
}

/**
 * Options for the input box
 */
export interface InputBoxOptions {
    /** Prompt text (e.g., "🤖 TypeAgent > ") */
    prompt?: string;
    /** Character for separator lines */
    separatorChar?: string;
    /** Color for the prompt */
    promptColor?: string;
    /** Color for the separator lines */
    separatorColor?: string;
    /** Cursor character (default: "_") */
    cursorChar?: string;
    /** Output stream */
    stream?: NodeJS.WriteStream;
}

/**
 * Interactive Input Box with visual separators
 *
 * Provides a Claude Code-like input area with:
 * - Horizontal lines above and below
 * - Styled prompt (supports emojis with proper width calculation)
 * - Integration with spinner for submitted input display
 */
export class InputBox {
    private stream: NodeJS.WriteStream;
    private prompt: string;
    private separatorChar: string;
    private promptColor: string;
    private separatorColor: string;
    private cursorChar: string;
    private currentInput: string = "";
    private cursorVisible: boolean = true;
    private isDrawn: boolean = false;

    constructor(options: InputBoxOptions = {}) {
        this.stream = options.stream ?? process.stdout;
        this.prompt = options.prompt ?? "🤖 > ";
        this.separatorChar = options.separatorChar ?? "─";
        this.promptColor = options.promptColor ?? ANSI.cyan;
        this.separatorColor = options.separatorColor ?? ANSI.dim;
        this.cursorChar = options.cursorChar ?? "_";
    }

    /**
     * Get the terminal width
     */
    private getWidth(): number {
        return this.stream.columns || 80;
    }

    /**
     * Get the display width of the prompt (accounts for emojis)
     */
    getPromptWidth(): number {
        return getDisplayWidth(this.prompt);
    }

    /**
     * Draw a separator line
     */
    private drawSeparator(): void {
        const width = this.getWidth();
        this.stream.write(
            `${this.separatorColor}${this.separatorChar.repeat(width)}${ANSI.reset}\n`,
        );
    }

    /**
     * Draw the input box with current input text
     */
    draw(inputText: string = ""): void {
        this.currentInput = inputText;
        this.drawSeparator();

        // Write prompt and input
        this.stream.write(
            `${this.promptColor}${this.prompt}${ANSI.reset}${inputText}`,
        );

        // Write cursor (simple underscore, no special characters that might flash)
        if (this.cursorVisible) {
            this.stream.write(`${ANSI.dim}${this.cursorChar}${ANSI.reset}`);
        }

        this.stream.write("\n");
        this.drawSeparator();
        this.isDrawn = true;
    }

    /**
     * Clear the input box (3 lines: separator, prompt, separator)
     */
    clear(): void {
        if (!this.isDrawn) return;

        // Move up 3 lines and clear each
        this.stream.write(ANSI.moveUp(3));
        this.stream.write(ANSI.clearLine);
        this.stream.write(ANSI.moveDown(1));
        this.stream.write(ANSI.clearLine);
        this.stream.write(ANSI.moveDown(1));
        this.stream.write(ANSI.clearLine);
        this.stream.write(ANSI.moveUp(2));
        this.isDrawn = false;
    }

    /**
     * Update just the input line without redrawing separators
     * This is smoother for typing animations - uses buffered write to prevent flashing
     */
    updateInputInPlace(inputText: string): void {
        if (!this.isDrawn) {
            this.draw(inputText);
            return;
        }

        this.currentInput = inputText;

        // Build the entire update as a single string to prevent flashing
        // Key: we write content FIRST, then clear to end (not clear first, then write)
        let output = "";

        // Hide cursor to prevent any flash during update
        output += ANSI.hideCursor;

        // Move to the prompt line (middle line of the 3)
        output += ANSI.moveUp(2);
        output += ANSI.carriageReturn;

        // Write prompt and input directly (no clear first)
        output += `${this.promptColor}${this.prompt}${ANSI.reset}${inputText}`;

        // Write cursor character
        if (this.cursorVisible) {
            output += `${ANSI.dim}${this.cursorChar}${ANSI.reset}`;
        }

        // Clear any remaining characters from previous longer input
        output += ANSI.clearToEnd;

        // Move back to end (past the bottom separator)
        output += "\n";
        output += ANSI.moveDown(1);

        // Show cursor again
        output += ANSI.showCursor;

        // Write everything in one operation
        this.stream.write(output);
    }

    /**
     * Update the input text (simulates typing)
     * Uses in-place update for smoother animation
     */
    updateInput(inputText: string): void {
        this.updateInputInPlace(inputText);
    }

    /**
     * Simulate typing character by character
     * Hides terminal cursor during animation for smooth display
     */
    async simulateTyping(text: string, delayMs: number = 50): Promise<void> {
        // Hide terminal cursor for the entire typing animation
        this.stream.write(ANSI.hideCursor);

        let typed = "";
        for (const char of text) {
            typed += char;
            this.updateInputInPlaceNoFlash(typed);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        // Show terminal cursor when done
        this.stream.write(ANSI.showCursor);
    }

    /**
     * Internal method for typing animation - minimal operations, no cursor show/hide
     */
    private updateInputInPlaceNoFlash(inputText: string): void {
        if (!this.isDrawn) {
            this.draw(inputText);
            return;
        }

        this.currentInput = inputText;

        // Build the entire update as a single string
        let output = "";

        // Move to the prompt line (middle line of the 3)
        output += ANSI.moveUp(2);
        output += ANSI.carriageReturn;

        // Write prompt and input directly
        output += `${this.promptColor}${this.prompt}${ANSI.reset}${inputText}`;

        // Write cursor character (visual underscore, not terminal cursor)
        if (this.cursorVisible) {
            output += `${ANSI.dim}${this.cursorChar}${ANSI.reset}`;
        }

        // Clear any remaining characters from previous longer input
        output += ANSI.clearToEnd;

        // Move back to end (past the bottom separator)
        output += "\n";
        output += ANSI.moveDown(1);

        // Write everything in one operation
        this.stream.write(output);
    }

    /**
     * Submit the current input and return a formatted block
     * Returns the submitted text and clears the input box
     */
    submit(): string {
        const submittedText = this.currentInput;
        this.currentInput = "";
        return submittedText;
    }

    /**
     * Format submitted input as a boxed user message
     */
    formatSubmittedInput(text: string): string {
        const width = this.getWidth();
        const line = this.separatorChar.repeat(width);
        return (
            `${this.separatorColor}${line}${ANSI.reset}\n` +
            `${ANSI.bold}You:${ANSI.reset} ${text}\n` +
            `${this.separatorColor}${line}${ANSI.reset}`
        );
    }

    /**
     * Hide the cursor indicator
     */
    hideCursor(): void {
        this.cursorVisible = false;
    }

    /**
     * Show the cursor indicator
     */
    showCursor(): void {
        this.cursorVisible = true;
    }

    /**
     * Set the prompt text (useful for changing agent emoji)
     */
    setPrompt(prompt: string): void {
        this.prompt = prompt;
    }
}

/**
 * Interactive session combining input box and spinner
 *
 * Demonstrates the full Claude Code-like interaction pattern:
 * 1. Show input box
 * 2. User types (or simulated typing)
 * 3. User submits
 * 4. Input moves above spinner
 * 5. Spinner shows while processing
 * 6. Response appears above spinner
 * 7. Input box refreshes for next input
 */
export class InteractiveSession {
    private stream: NodeJS.WriteStream;
    private inputBox: InputBox;
    private spinner: EnhancedSpinner;
    private layout: TerminalLayout;

    constructor(options: InputBoxOptions & SpinnerOptions = {}) {
        this.stream = options.stream ?? process.stdout;
        this.inputBox = new InputBox(options);
        this.spinner = new EnhancedSpinner({
            ...options,
            stream: this.stream,
        });
        this.layout = new TerminalLayout(this.stream);
    }

    /**
     * Show the initial input box
     */
    showInputBox(initialText: string = ""): void {
        this.inputBox.draw(initialText);
    }

    /**
     * Simulate user typing in the input box
     */
    async simulateTyping(text: string, delayMs: number = 50): Promise<void> {
        await this.inputBox.simulateTyping(text, delayMs);
    }

    /**
     * Submit input and start processing
     * Returns the submitted text
     */
    submitAndProcess(spinnerText: string = "Processing..."): string {
        const submitted = this.inputBox.submit();

        // Clear the input box
        this.inputBox.clear();

        // Write the submitted input as a formatted block
        this.stream.write(this.inputBox.formatSubmittedInput(submitted) + "\n");

        // Start spinner
        this.spinner.start({ text: spinnerText });

        return submitted;
    }

    /**
     * Add output above the spinner (like tool results or streaming response)
     */
    addOutput(content: string): void {
        this.spinner.writeAbove(content);
    }

    /**
     * Complete processing and show new input box
     */
    completeAndRefresh(
        resultText?: string,
        resultType: "success" | "fail" | "info" | "warn" = "success",
    ): void {
        // Stop spinner with appropriate symbol
        switch (resultType) {
            case "success":
                this.spinner.succeed(resultText);
                break;
            case "fail":
                this.spinner.fail(resultText);
                break;
            case "warn":
                this.spinner.warn(resultText);
                break;
            case "info":
                this.spinner.info(resultText);
                break;
        }

        // Add spacing
        this.stream.write("\n");

        // Show fresh input box
        this.inputBox.draw("");
    }

    /**
     * Get the spinner for direct manipulation
     */
    getSpinner(): EnhancedSpinner {
        return this.spinner;
    }

    /**
     * Get the input box for direct manipulation
     */
    getInputBox(): InputBox {
        return this.inputBox;
    }

    /**
     * Get the layout for drawing separators etc.
     */
    getLayout(): TerminalLayout {
        return this.layout;
    }
}

/**
 * A completion item for the completion menu
 */
export interface CompletionItem {
    /** The text to insert when selected */
    value: string;
    /** Display label (defaults to value if not specified) */
    label?: string;
    /** Optional description shown to the right */
    description?: string;
    /** Optional icon/emoji shown before the label */
    icon?: string;
}

/**
 * Options for the completion menu
 */
export interface CompletionMenuOptions {
    /** Maximum number of visible items (scrolls if more) */
    maxVisible?: number;
    /** Color for the selected item */
    selectedColor?: string;
    /** Color for unselected items */
    itemColor?: string;
    /** Color for descriptions */
    descriptionColor?: string;
    /** Border character for the menu box */
    borderChar?: string;
    /** Output stream */
    stream?: NodeJS.WriteStream;
}

/**
 * Completion trigger configuration
 */
export interface CompletionTrigger {
    /** The character that triggers this completion (e.g., "@", "/") */
    char: string;
    /** The list of completion items for this trigger */
    items: CompletionItem[];
    /** Optional header text shown above the menu */
    header?: string;
}

/**
 * Completion Menu for trigger-based autocompletion
 *
 * Features:
 * - Triggered by specific characters (e.g., "@" for mentions, "/" for commands)
 * - Filters items as user types
 * - Keyboard navigation (simulated in demo)
 * - Visual highlighting of selected item
 */
export class CompletionMenu {
    private stream: NodeJS.WriteStream;
    private maxVisible: number;
    private selectedColor: string;
    private itemColor: string;
    private descriptionColor: string;
    private borderChar: string;

    private items: CompletionItem[] = [];
    private filteredItems: CompletionItem[] = [];
    private selectedIndex: number = 0;
    private isVisible: boolean = false;
    private linesDrawn: number = 0;
    private filterText: string = "";
    private triggerChar: string = "";
    private header: string = "";

    constructor(options: CompletionMenuOptions = {}) {
        this.stream = options.stream ?? process.stdout;
        this.maxVisible = options.maxVisible ?? 6;
        this.selectedColor = options.selectedColor ?? ANSI.cyan;
        this.itemColor = options.itemColor ?? ANSI.reset;
        this.descriptionColor = options.descriptionColor ?? ANSI.dim;
        this.borderChar = options.borderChar ?? "│";
    }

    /**
     * Check if the menu is currently visible
     */
    isMenuVisible(): boolean {
        return this.isVisible;
    }

    /**
     * Get the currently selected item
     */
    getSelectedItem(): CompletionItem | null {
        if (this.filteredItems.length === 0) return null;
        return this.filteredItems[this.selectedIndex];
    }

    /**
     * Get the trigger character that opened this menu
     */
    getTriggerChar(): string {
        return this.triggerChar;
    }

    /**
     * Show the completion menu with the given trigger configuration
     */
    show(trigger: CompletionTrigger, initialFilter: string = ""): void {
        this.items = trigger.items;
        this.triggerChar = trigger.char;
        this.header = trigger.header ?? "";
        this.filterText = initialFilter;
        this.selectedIndex = 0;
        this.applyFilter();
        this.isVisible = true;
        this.render();
    }

    /**
     * Hide the completion menu and clear its display
     */
    hide(): void {
        if (!this.isVisible) return;
        this.clearDisplay();
        this.isVisible = false;
        this.filterText = "";
        this.triggerChar = "";
    }

    /**
     * Update the filter text and re-render
     */
    updateFilter(filterText: string): void {
        this.filterText = filterText;
        this.selectedIndex = 0;
        this.applyFilter();
        this.clearDisplay();
        this.render();
    }

    /**
     * Move selection up
     */
    selectPrevious(): void {
        if (this.filteredItems.length === 0) return;
        this.selectedIndex =
            (this.selectedIndex - 1 + this.filteredItems.length) %
            this.filteredItems.length;
        this.clearDisplay();
        this.render();
    }

    /**
     * Move selection down
     */
    selectNext(): void {
        if (this.filteredItems.length === 0) return;
        this.selectedIndex =
            (this.selectedIndex + 1) % this.filteredItems.length;
        this.clearDisplay();
        this.render();
    }

    /**
     * Select and return the current item, then hide the menu
     * Returns the full text to insert (trigger char + value)
     */
    confirm(): string | null {
        const item = this.getSelectedItem();
        if (!item) {
            this.hide();
            return null;
        }
        const result = this.triggerChar + item.value;
        this.hide();
        return result;
    }

    /**
     * Apply the current filter to the items
     */
    private applyFilter(): void {
        const filter = this.filterText.toLowerCase();
        this.filteredItems = this.items.filter((item) => {
            const label = (item.label ?? item.value).toLowerCase();
            const value = item.value.toLowerCase();
            return label.includes(filter) || value.includes(filter);
        });
    }

    /**
     * Clear the menu display from the terminal
     */
    private clearDisplay(): void {
        if (this.linesDrawn === 0) return;

        // Move up and clear each line we drew
        for (let i = 0; i < this.linesDrawn; i++) {
            this.stream.write(ANSI.moveUp(1));
            this.stream.write(ANSI.carriageReturn + ANSI.clearLine);
        }
        this.linesDrawn = 0;
    }

    /**
     * Render the completion menu
     */
    private render(): void {
        if (!this.isVisible) return;

        const width = this.stream.columns || 80;
        const menuWidth = Math.min(50, width - 4);

        // Hide cursor during render
        this.stream.write(ANSI.hideCursor);

        let lines: string[] = [];

        // Header
        if (this.header) {
            lines.push(
                `${ANSI.dim}${this.borderChar} ${ANSI.bold}${this.header}${ANSI.reset}`,
            );
        }

        // Top border
        lines.push(`${ANSI.dim}┌${"─".repeat(menuWidth - 2)}┐${ANSI.reset}`);

        if (this.filteredItems.length === 0) {
            // No matches
            lines.push(
                `${ANSI.dim}│${ANSI.reset} ${ANSI.dim}No matches${ANSI.reset}${" ".repeat(menuWidth - 13)}${ANSI.dim}│${ANSI.reset}`,
            );
        } else {
            // Calculate visible range
            const visibleCount = Math.min(
                this.maxVisible,
                this.filteredItems.length,
            );
            let startIndex = 0;

            // Adjust start index to keep selected item visible
            if (this.selectedIndex >= visibleCount) {
                startIndex = this.selectedIndex - visibleCount + 1;
            }

            // Show scroll indicator if needed
            if (startIndex > 0) {
                lines.push(
                    `${ANSI.dim}│ ↑ more items above${" ".repeat(menuWidth - 22)}│${ANSI.reset}`,
                );
            }

            // Render visible items
            for (let i = 0; i < visibleCount; i++) {
                const itemIndex = startIndex + i;
                const item = this.filteredItems[itemIndex];
                const isSelected = itemIndex === this.selectedIndex;

                const icon = item.icon ? `${item.icon} ` : "";
                const label = item.label ?? item.value;
                const desc = item.description ? ` ${item.description}` : "";

                // Calculate padding
                const contentWidth =
                    getDisplayWidth(icon) +
                    getDisplayWidth(label) +
                    getDisplayWidth(desc);
                const padding = Math.max(0, menuWidth - contentWidth - 4);

                let line: string;
                if (isSelected) {
                    line = `${ANSI.dim}│${ANSI.reset} ${this.selectedColor}${ANSI.bold}▶ ${icon}${label}${ANSI.reset}${this.descriptionColor}${desc}${ANSI.reset}${" ".repeat(padding)}${ANSI.dim}│${ANSI.reset}`;
                } else {
                    line = `${ANSI.dim}│${ANSI.reset}   ${this.itemColor}${icon}${label}${ANSI.reset}${this.descriptionColor}${desc}${ANSI.reset}${" ".repeat(padding + 2)}${ANSI.dim}│${ANSI.reset}`;
                }

                lines.push(line);
            }

            // Show scroll indicator if more items below
            if (startIndex + visibleCount < this.filteredItems.length) {
                lines.push(
                    `${ANSI.dim}│ ↓ more items below${" ".repeat(menuWidth - 22)}│${ANSI.reset}`,
                );
            }
        }

        // Bottom border
        lines.push(`${ANSI.dim}└${"─".repeat(menuWidth - 2)}┘${ANSI.reset}`);

        // Hint line
        lines.push(
            `${ANSI.dim}  ↑↓ navigate • Enter select • Esc cancel${ANSI.reset}`,
        );

        // Write all lines
        for (const line of lines) {
            this.stream.write(line + "\n");
        }

        this.linesDrawn = lines.length;
        this.stream.write(ANSI.showCursor);
    }
}

/**
 * Input box with completion support
 *
 * Extends InputBox functionality to support trigger-based completions
 * (e.g., "@" for agents, "/" for commands)
 */
export class InputBoxWithCompletion extends InputBox {
    private completionMenu: CompletionMenu;
    private triggers: Map<string, CompletionTrigger> = new Map();
    private completionStream: NodeJS.WriteStream;

    constructor(options: InputBoxOptions & CompletionMenuOptions = {}) {
        super(options);
        this.completionStream = options.stream ?? process.stdout;
        this.completionMenu = new CompletionMenu(options);
    }

    /**
     * Register a completion trigger
     */
    registerTrigger(trigger: CompletionTrigger): void {
        this.triggers.set(trigger.char, trigger);
    }

    /**
     * Check if a character is a registered trigger
     */
    isTriggerChar(char: string): boolean {
        return this.triggers.has(char);
    }

    /**
     * Get the completion menu
     */
    getCompletionMenu(): CompletionMenu {
        return this.completionMenu;
    }

    /**
     * Process input and manage completion state
     * Returns true if completion menu is active
     */
    processInput(fullInput: string): boolean {
        // Check if input starts with a trigger character
        if (fullInput.length > 0) {
            const firstChar = fullInput[0];
            const trigger = this.triggers.get(firstChar);

            if (trigger) {
                const filterText = fullInput.slice(1); // Text after trigger

                if (!this.completionMenu.isMenuVisible()) {
                    // Show menu for the first time
                    this.completionMenu.show(trigger, filterText);
                } else {
                    // Update filter
                    this.completionMenu.updateFilter(filterText);
                }
                return true;
            }
        }

        // No trigger - hide menu if visible
        if (this.completionMenu.isMenuVisible()) {
            this.completionMenu.hide();
        }
        return false;
    }

    /**
     * Select next item in completion menu
     */
    completionNext(): void {
        if (this.completionMenu.isMenuVisible()) {
            this.completionMenu.selectNext();
        }
    }

    /**
     * Select previous item in completion menu
     */
    completionPrevious(): void {
        if (this.completionMenu.isMenuVisible()) {
            this.completionMenu.selectPrevious();
        }
    }

    /**
     * Confirm completion selection
     * Returns the text to insert, or null if no selection
     */
    confirmCompletion(): string | null {
        if (this.completionMenu.isMenuVisible()) {
            return this.completionMenu.confirm();
        }
        return null;
    }

    /**
     * Cancel completion without selecting
     */
    cancelCompletion(): void {
        this.completionMenu.hide();
    }

    /**
     * Simulate typing with completion support
     */
    async simulateTypingWithCompletion(
        text: string,
        delayMs: number = 50,
    ): Promise<void> {
        this.completionStream.write(ANSI.hideCursor);

        let typed = "";
        for (const char of text) {
            typed += char;

            // Update input display
            this.updateInputInPlace(typed);

            // Process for completions
            this.processInput(typed);

            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        this.completionStream.write(ANSI.showCursor);
    }
}
