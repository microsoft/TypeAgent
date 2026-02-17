// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Enhanced Console with Terminal UI Features
 *
 * Provides a Claude Code-like terminal experience with:
 * - Spinner animation during processing
 * - Output-above-spinner pattern
 * - Styled yes/no prompts
 * - Multiple choice menus with arrow key navigation
 * - Visual separators and formatting
 */

import {
    AppAgentEvent,
    DisplayAppendMode,
    DisplayContent,
    MessageContent,
} from "@typeagent/agent-sdk";
import type {
    RequestId,
    ClientIO,
    IAgentMessage,
    TemplateEditConfig,
} from "agent-dispatcher";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { EnhancedSpinner, ANSI, getDisplayWidth } from "interactive-app";
import { createInterface } from "readline/promises";
import readline from "readline";
import { convert } from "html-to-text";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

// Track current processing state
let currentSpinner: EnhancedSpinner | null = null;

// Grammar log file path
const grammarLogPath = path.join(
    process.env.HOME || process.env.USERPROFILE || ".",
    ".typeagent",
    "grammar.log",
);

// Configure marked with terminal renderer for styled markdown output
marked.use(
    markedTerminal({
        // Customize colors and styles for terminal output
        code: chalk.yellow,
        blockquote: chalk.gray.italic,
        heading: chalk.bold.cyan,
        firstHeading: chalk.bold.magenta,
        strong: chalk.bold,
        em: chalk.italic,
        codespan: chalk.yellow,
        del: chalk.dim.strikethrough,
        link: chalk.blue.underline,
        href: chalk.blue.underline,
        listitem: chalk.reset,
        table: chalk.reset,
        tableHeader: chalk.bold,
    }),
);

/**
 * Convert markdown content to styled terminal output
 */
function convertMarkdownToTerminal(markdown: string): string {
    try {
        const result = marked.parse(markdown);
        // marked.parse can return string or Promise<string>
        // With markedTerminal it returns a string synchronously
        if (typeof result === "string") {
            return result.trim();
        }
        // Fallback if it somehow returns a promise
        return markdown;
    } catch (error) {
        console.warn("Markdown conversion failed:", error);
        return markdown;
    }
}

function logGrammarRule(message: string): void {
    try {
        // Ensure directory exists
        const dir = path.dirname(grammarLogPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // Append to log file with timestamp
        const timestamp = new Date().toISOString();
        fs.appendFileSync(grammarLogPath, `[${timestamp}] ${message}\n\n`);
    } catch {
        // Silently ignore logging errors
    }
}

function displayPadEnd(content: string, length: number): string {
    return `${content}${" ".repeat(length - getDisplayWidth(content))}`;
}

function messageContentToText(message: MessageContent): string {
    if (typeof message === "string") {
        return message;
    }

    if (message.length === 0) {
        return "";
    }
    if (typeof message[0] === "string") {
        return message.join("\n");
    }
    const table = message as string[][];
    let numColumns = 0;
    const maxColumnWidths: number[] = [];
    for (const row of table) {
        numColumns = Math.max(numColumns, row.length);
        for (let i = 0; i < row.length; i++) {
            maxColumnWidths[i] = Math.max(
                maxColumnWidths[i] ?? 0,
                getDisplayWidth(row[i]),
            );
        }
    }

    const displayRows = table.map((row) => {
        const items: string[] = [];
        for (let i = 0; i < numColumns; i++) {
            const content = i < row.length ? row[i] : "";
            items.push(displayPadEnd(content, maxColumnWidths[i]));
        }
        return `|${items.join("|")}|`;
    });
    displayRows.splice(
        1,
        0,
        `|${maxColumnWidths.map((w) => "-".repeat(w)).join("|")}|`,
    );
    return displayRows.join("\n");
}

/**
 * Start a processing spinner with the given message
 */
export function startProcessingSpinner(
    message: string = "Processing...",
): void {
    if (currentSpinner) {
        currentSpinner.stop();
    }
    currentSpinner = new EnhancedSpinner({ text: message });
    currentSpinner.start();
}

/**
 * Update the spinner text
 */
export function updateSpinnerText(message: string): void {
    if (currentSpinner) {
        currentSpinner.updateText(message);
    }
}

/**
 * Stop the spinner with a result
 */
export function stopSpinner(
    result: "success" | "fail" | "info" | "warn" = "success",
    message?: string,
): void {
    if (currentSpinner) {
        switch (result) {
            case "success":
                currentSpinner.succeed(message);
                break;
            case "fail":
                currentSpinner.fail(message);
                break;
            case "warn":
                currentSpinner.warn(message);
                break;
            case "info":
                currentSpinner.info(message);
                break;
        }
        currentSpinner = null;
    }
}

/**
 * Create an enhanced ClientIO with terminal UI features
 */
export function createEnhancedClientIO(
    rl?: readline.promises.Interface,
): ClientIO {
    let lastAppendMode: DisplayAppendMode | undefined;

    function displayContent(
        content: DisplayContent,
        appendMode?: DisplayAppendMode,
    ) {
        let message: MessageContent;
        let colorFn = (s: string) => s;
        let contentType: string = "text";

        if (typeof content === "string" || Array.isArray(content)) {
            message = content;
        } else {
            message = content.content;
            contentType = content.type || "text";
            switch (content.kind) {
                case "status":
                    colorFn = chalk.grey;
                    break;
                case "error":
                    colorFn = chalk.red;
                    break;
                case "warning":
                    colorFn = chalk.yellow;
                    break;
                case "info":
                    colorFn = chalk.grey;
                    break;
                case "success":
                    colorFn = chalk.greenBright;
                    break;
                default:
                    colorFn = chalk.green;
                    break;
            }
        }

        // Convert content based on type
        let displayText: string;
        const textContent =
            typeof message === "string"
                ? message
                : messageContentToText(message);

        if (contentType === "markdown") {
            // Render markdown with terminal styling (already has colors from marked-terminal)
            displayText = convertMarkdownToTerminal(textContent);
        } else if (contentType === "html") {
            // Convert HTML to formatted text
            displayText = colorFn(convertHtmlToText(textContent));
        } else {
            displayText = colorFn(textContent);
        }

        // If spinner is active, write above it
        if (currentSpinner?.isActive()) {
            if (appendMode === "inline") {
                currentSpinner.appendStream(displayText);
            } else {
                currentSpinner.writeAbove(displayText);
            }
        } else if (rl) {
            // Readline is active - write above the prompt
            // Clear current line, write content, then let readline redraw prompt
            readline.cursorTo(process.stdout, 0);
            readline.clearLine(process.stdout, 0);
            if (appendMode !== "inline") {
                if (lastAppendMode === "inline") {
                    process.stdout.write("\n");
                }
                process.stdout.write(displayText);
                process.stdout.write("\n");
            } else {
                process.stdout.write(displayText);
            }
            // Redraw the prompt
            rl.prompt(true);
        } else {
            if (appendMode !== "inline") {
                if (lastAppendMode === "inline") {
                    process.stdout.write("\n");
                }
                process.stdout.write(displayText);
                process.stdout.write("\n");
            } else {
                process.stdout.write(displayText);
            }
        }

        lastAppendMode = appendMode;
    }

    function displayInlineNotification(
        data: string | DisplayContent,
        source: string,
        timestamp: number,
    ): void {
        const time = new Date(timestamp).toLocaleTimeString();
        const header = chalk.dim(`[${time}] ${source}:`);

        let content: string;
        if (isMarkdownContent(data)) {
            const markdownContent = extractContentString(data);
            content = convertMarkdownToTerminal(markdownContent);
        } else if (isHtmlContent(data)) {
            const htmlContent = extractHtmlString(data);
            content = convertHtmlToText(htmlContent);
        } else {
            content = formatDisplayContent(data);
        }

        const formattedMessage = `${header}\n  ${content}`;

        if (currentSpinner?.isActive()) {
            currentSpinner.writeAbove(formattedMessage);
        } else {
            displayContent(formattedMessage);
        }
    }

    function displayToastNotification(
        data: string | DisplayContent,
        source: string,
        timestamp: number,
    ): void {
        const toastHeader = chalk.bgCyan.black(" \u25B6 NOTIFICATION ");

        if (currentSpinner?.isActive()) {
            currentSpinner.writeAbove("");
            currentSpinner.writeAbove(toastHeader);
        } else {
            displayContent("");
            displayContent(toastHeader);
        }

        displayInlineNotification(data, source, timestamp);

        if (currentSpinner?.isActive()) {
            currentSpinner.writeAbove("");
        } else {
            displayContent("");
        }
    }

    return {
        clear(): void {
            console.clear();
        },
        exit(): void {
            if (currentSpinner) {
                currentSpinner.stop();
                currentSpinner = null;
            }
            process.exit(0);
        },

        // Display
        setDisplayInfo() {
            // Ignored
        },
        setDisplay(message: IAgentMessage): void {
            displayContent(message.message);
        },
        appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void {
            displayContent(message.message, mode);
        },
        appendDiagnosticData(_requestId: RequestId, _data: any) {
            // Ignored
        },
        setDynamicDisplay(
            requestId: RequestId,
            source: string,
            actionIndex: number,
            displayId: string,
            nextRefreshMs: number,
        ): void {
            // REVIEW: Ignored.
        },

        // Input - Enhanced yes/no with visual styling
        async askYesNo(
            requestId: RequestId,
            message: string,
            defaultValue?: boolean,
        ): Promise<boolean> {
            // Pause spinner during input
            const wasSpinning = currentSpinner?.isActive();
            if (wasSpinning) {
                currentSpinner!.stop();
            }

            // Draw styled prompt
            const width = process.stdout.columns || 80;
            const line = ANSI.dim + "─".repeat(width) + ANSI.reset;

            process.stdout.write("\n");
            process.stdout.write(line + "\n");

            const defaultHint =
                defaultValue === undefined
                    ? ""
                    : defaultValue
                      ? " (default: yes)"
                      : " (default: no)";

            const prompt = `${chalk.cyan("?")} ${message}${chalk.dim(defaultHint)} ${chalk.dim("(y/n)")} `;

            const input = await question(prompt, rl);
            process.stdout.write(line + "\n");

            // Resume spinner if it was active
            if (wasSpinning) {
                currentSpinner = new EnhancedSpinner({ text: "Processing..." });
                currentSpinner.start();
            }

            if (input.toLowerCase() === "y" || input.toLowerCase() === "yes") {
                return true;
            }
            if (input.toLowerCase() === "n" || input.toLowerCase() === "no") {
                return false;
            }
            return defaultValue ?? false;
        },

        async proposeAction(
            requestId: RequestId,
            actionTemplates: TemplateEditConfig,
            source: string,
        ): Promise<unknown> {
            // TODO: Not implemented
            return undefined;
        },

        // Multiple choice with visual menu
        async popupQuestion(
            message: string,
            choices: string[],
            defaultId: number | undefined,
            source: string,
        ): Promise<number> {
            // Pause spinner during input
            const wasSpinning = currentSpinner?.isActive();
            if (wasSpinning) {
                currentSpinner!.stop();
            }

            const width = process.stdout.columns || 80;
            const line = ANSI.dim + "─".repeat(width) + ANSI.reset;

            process.stdout.write("\n");
            process.stdout.write(line + "\n");
            process.stdout.write(`${chalk.cyan("?")} ${message}\n`);
            process.stdout.write(line + "\n\n");

            // Display choices with numbers
            choices.forEach((choice, index) => {
                const isDefault = index === defaultId;
                const prefix = isDefault
                    ? chalk.cyan(`▶ ${index + 1}.`)
                    : chalk.dim(`  ${index + 1}.`);
                const suffix = isDefault ? chalk.dim(" (default)") : "";
                process.stdout.write(`${prefix} ${choice}${suffix}\n`);
            });

            process.stdout.write("\n");
            const prompt = `${chalk.dim("Enter number (1-" + choices.length + "):")} `;
            const input = await question(prompt, rl);

            process.stdout.write(line + "\n");

            // Resume spinner if it was active
            if (wasSpinning) {
                currentSpinner = new EnhancedSpinner({ text: "Processing..." });
                currentSpinner.start();
            }

            const selectedIndex = parseInt(input, 10) - 1;
            if (
                isNaN(selectedIndex) ||
                selectedIndex < 0 ||
                selectedIndex >= choices.length
            ) {
                return defaultId ?? 0;
            }
            return selectedIndex;
        },

        // Notification with visual styling
        notify(
            requestId: RequestId,
            event: string,
            data: any,
            source: string,
        ): void {
            const timestamp = Date.now();

            switch (event) {
                case AppAgentEvent.Error:
                    if (currentSpinner?.isActive()) {
                        currentSpinner.writeAbove(
                            `${chalk.red("✖")} ${chalk.red(data)}`,
                        );
                    } else {
                        console.error(chalk.red(`✖ ${data}`));
                    }
                    break;
                case AppAgentEvent.Warning:
                    if (currentSpinner?.isActive()) {
                        currentSpinner.writeAbove(
                            `${chalk.yellow("⚠")} ${chalk.yellow(data)}`,
                        );
                    } else {
                        console.warn(chalk.yellow(`⚠ ${data}`));
                    }
                    break;
                case AppAgentEvent.Info:
                    if (currentSpinner?.isActive()) {
                        currentSpinner.writeAbove(
                            `${chalk.cyan("ℹ")} ${data}`,
                        );
                    } else {
                        console.info(`ℹ ${data}`);
                    }
                    break;

                case AppAgentEvent.Inline:
                    displayInlineNotification(data, source, timestamp);
                    break;

                case AppAgentEvent.Toast:
                    displayToastNotification(data, source, timestamp);
                    break;

                case "grammarRule":
                    // Grammar rule notifications - log to file to avoid disrupting prompt
                    // View with: cat ~/.typeagent/grammar.log
                    if (data.success && data.rule) {
                        logGrammarRule(`+RULE ${data.message}\n${data.rule}`);
                    } else if (!data.success && data.rule) {
                        logGrammarRule(
                            `REJECTED ${data.message}\n${data.rule}`,
                        );
                    }
                    break;

                default:
                // ignored.
            }
        },

        async openLocalView(requestId: RequestId, port: number): Promise<void> {
            const { default: open } = await import("open");
            await open(`http://localhost:${port}`);
        },
        async closeLocalView(
            requestId: RequestId,
            port: number,
        ): Promise<void> {
            // TODO: Ignored
        },
        takeAction(requestId: RequestId, action: string, data: unknown): void {
            if (action === "open-folder") {
                import("open").then(({ default: open }) =>
                    open(data as string),
                );
                return;
            }
            throw new Error(`Action ${action} not supported`);
        },
    };
}

// Helper functions

function isMarkdownContent(data: string | DisplayContent): boolean {
    if (typeof data === "object" && data !== null && "type" in data) {
        return data.type === "markdown";
    }
    return false;
}

function isHtmlContent(data: string | DisplayContent): boolean {
    if (typeof data === "object" && data !== null && "type" in data) {
        return data.type === "html";
    }
    if (typeof data === "string") {
        return /<[^>]+>/.test(data);
    }
    if (typeof data === "object" && data !== null && "content" in data) {
        const content = data.content;
        if (typeof content === "string") {
            return /<[^>]+>/.test(content);
        }
    }
    return false;
}

function extractContentString(data: string | DisplayContent): string {
    if (typeof data === "string") {
        return data;
    }
    if (typeof data === "object" && data !== null && "content" in data) {
        if (typeof data.content === "string") {
            return data.content;
        }
        if (Array.isArray(data.content)) {
            return data.content.join("\n");
        }
    }
    return String(data);
}

function extractHtmlString(data: string | DisplayContent): string {
    if (typeof data === "string") {
        return data;
    }
    if (typeof data === "object" && data !== null && "content" in data) {
        if (typeof data.content === "string") {
            return data.content;
        }
    }
    return String(data);
}

function convertHtmlToText(html: string): string {
    try {
        const result = convert(html, {
            wordwrap: 100,
            preserveNewlines: false,
            selectors: [
                // Skip images - we can't display them in terminal
                {
                    selector: "img",
                    format: "skip",
                },
                // Skip CSS animations and loading indicators
                {
                    selector: ".loading",
                    format: "skip",
                },
                {
                    selector: ".wait-dot",
                    format: "skip",
                },
                // Style tags should be stripped
                {
                    selector: "style",
                    format: "skip",
                },
                // General div and p formatting
                {
                    selector: "div",
                    format: "block",
                    options: { leadingLineBreaks: 1, trailingLineBreaks: 0 },
                },
                {
                    selector: "p",
                    format: "block",
                    options: { leadingLineBreaks: 1, trailingLineBreaks: 1 },
                },
                // Links - show text only
                {
                    selector: "a",
                    format: "inline",
                    options: {
                        linkBrackets: false,
                        hideLinkHrefIfSameAsText: true,
                        ignoreHref: true,
                    },
                },
                // Spans - inline
                {
                    selector: "span",
                    format: "inline",
                },
            ],
        });

        // Clean up excessive whitespace while preserving structure
        let cleaned = result
            .replace(/\n{3,}/g, "\n\n") // Max 2 consecutive newlines
            .replace(/[ \t]+/g, " ") // Collapse horizontal whitespace
            .replace(/^ +/gm, "") // Remove leading spaces on lines
            .trim();

        // Apply terminal colors for track formatting
        // Track titles get highlighted
        cleaned = cleaned.replace(
            /^(\d+\.\s*)(.+?)(\s+Artists:)/gm,
            (_, num, title, artists) =>
                `${chalk.cyan(num)}${chalk.bold(title)}${chalk.dim(artists)}`,
        );

        // Album lines get dimmed
        cleaned = cleaned.replace(/^(Album:.+)$/gm, chalk.dim("$1"));

        return cleaned;
    } catch (error) {
        console.warn("HTML-to-text conversion failed:", error);
        return extractHtmlString(html)
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }
}

function formatDisplayContent(content: string | DisplayContent): string {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return messageContentToText(content);
    }
    if (content && typeof content === "object" && "content" in content) {
        return messageContentToText(content.content);
    }
    return String(content);
}

/**
 * Interactive input with inline gray completion suggestions (like GitHub Copilot)
 * Shows first completion grayed out after cursor, arrows cycle through, Tab accepts
 */
async function questionWithCompletion(
    message: string,
    getCompletions: (input: string) => Promise<any>,
): Promise<string> {
    return new Promise<string>((resolve) => {
        let input = "";
        let cursorPos = 0; // Position within input string (0 = before first char)
        let allCompletions: string[] = []; // All available completions
        let filteredCompletions: string[] = []; // Filtered based on user typing
        let completionIndex = 0;
        let filterStartIndex = -1; // Where filtering begins
        let completionPrefix = ""; // Fixed prefix before completions
        let updatingCompletions = false;
        const stdin = process.stdin;
        const stdout = process.stdout;

        // Enable raw mode for character-by-character input
        const wasRaw = stdin.isRaw;
        if (stdin.isTTY) {
            stdin.setRawMode(true);
        }
        stdin.resume();
        stdin.setEncoding("utf8");

        // Filter completions based on what user typed after the trigger point
        const filterCompletions = () => {
            if (allCompletions.length === 0 || filterStartIndex < 0) {
                filteredCompletions = [];
                return;
            }

            // Get the filter text (what user typed after the space/trigger)
            const filterText = input.substring(filterStartIndex).toLowerCase();

            if (filterText === "") {
                // No filter text, show all
                filteredCompletions = allCompletions;
            } else {
                // Filter completions that start with the filter text
                filteredCompletions = allCompletions.filter((comp) =>
                    comp.toLowerCase().startsWith(filterText),
                );
            }

            // Reset index if out of bounds
            if (completionIndex >= filteredCompletions.length) {
                completionIndex = 0;
            }
        };

        // Render the prompt and input with inline gray suggestion
        const render = () => {
            // Build entire output as a single string to prevent cursor flashing
            const promptText = chalk.cyanBright(message);

            // Calculate cursor column based on cursorPos within input
            const cursorCol =
                getDisplayWidth(message) +
                getDisplayWidth(input.substring(0, cursorPos)) +
                1;

            // Don't clear whole line first - overwrite in place, then clear to end
            // This avoids the brief "blank line" flash
            let output = ANSI.hideCursor;
            output += "\r"; // Move to column 0 (carriage return)
            output += promptText + input;

            // Show inline completion if available
            if (
                filteredCompletions.length > 0 &&
                completionIndex < filteredCompletions.length
            ) {
                const completion = filteredCompletions[completionIndex];
                // Build full completion from prefix + completion text
                const fullCompletion =
                    completionPrefix +
                    (filterStartIndex > completionPrefix.length ? " " : "") +
                    completion;
                if (fullCompletion.length > input.length) {
                    const suggestion = fullCompletion.slice(input.length);
                    const counter = ` ${completionIndex + 1}/${filteredCompletions.length}`;
                    output += chalk.dim(suggestion + counter);
                }
            }

            // Clear from cursor to end of line (removes leftover chars from previous longer content)
            output += "\x1b[K";

            // Position cursor at end of input using absolute positioning
            output += `\x1b[${cursorCol}G`;
            output += ANSI.showCursor;

            // Write everything in one call
            stdout.write(output);
        };

        // Fetch completions for current input
        const updateCompletions = async () => {
            if (updatingCompletions) {
                return; // Skip if already updating
            }
            updatingCompletions = true;
            try {
                const result = await getCompletions(input);
                if (result) {
                    allCompletions = result.allCompletions || [];
                    filterStartIndex = result.filterStartIndex;
                    completionPrefix = result.prefix;
                    filterCompletions();
                } else {
                    allCompletions = [];
                    filteredCompletions = [];
                    filterStartIndex = -1;
                    completionPrefix = "";
                }
                completionIndex = 0;
            } catch (e) {
                allCompletions = [];
                filteredCompletions = [];
                filterStartIndex = -1;
                completionPrefix = "";
                completionIndex = 0;
            }
            updatingCompletions = false;
            render();
        };

        // Initial render
        render();

        // Handle keypresses
        const onData = async (chunk: Buffer) => {
            const data = chunk.toString();

            // Handle multi-byte sequences
            if (data.startsWith("\x1b[")) {
                // Arrow keys
                if (data === "\x1b[A") {
                    // Arrow Up - cycle to previous completion
                    if (filteredCompletions.length > 0) {
                        completionIndex =
                            (completionIndex - 1 + filteredCompletions.length) %
                            filteredCompletions.length;
                        render();
                    }
                    return;
                } else if (data === "\x1b[B") {
                    // Arrow Down - cycle to next completion
                    if (filteredCompletions.length > 0) {
                        completionIndex =
                            (completionIndex + 1) % filteredCompletions.length;
                        render();
                    }
                    return;
                } else if (data === "\x1b[C") {
                    // Arrow Right - move cursor right
                    if (cursorPos < input.length) {
                        cursorPos++;
                        render();
                    }
                    return;
                } else if (data === "\x1b[D") {
                    // Arrow Left - move cursor left
                    if (cursorPos > 0) {
                        cursorPos--;
                        render();
                    }
                    return;
                } else if (data === "\x1b") {
                    // Esc - clear completions
                    allCompletions = [];
                    filteredCompletions = [];
                    filterStartIndex = -1;
                    render();
                    return;
                }
            }

            const code = data.charCodeAt(0);

            if (code === 3) {
                // Ctrl+C
                cleanup();
                process.exit(0);
            } else if (code === 13) {
                // Enter - accept completion (if any) AND submit
                if (
                    filteredCompletions.length > 0 &&
                    completionIndex < filteredCompletions.length
                ) {
                    const completion = filteredCompletions[completionIndex];
                    input =
                        completionPrefix +
                        (filterStartIndex > completionPrefix.length
                            ? " "
                            : "") +
                        completion;
                }
                // Windows Terminal ConPTY echoes in raw mode
                // Move cursor up one line, clear it, and write clean output
                stdout.write("\x1b[1A"); // Move cursor up 1 line
                stdout.write("\r" + ANSI.clearLine); // Clear the line
                stdout.write(chalk.cyanBright(message) + input + "\n");
                cleanup();
                resolve(input);
            } else if (code === 9) {
                // Tab - accept current completion and continue
                if (
                    filteredCompletions.length > 0 &&
                    completionIndex < filteredCompletions.length
                ) {
                    const completion = filteredCompletions[completionIndex];
                    input =
                        completionPrefix +
                        (filterStartIndex > completionPrefix.length
                            ? " "
                            : "") +
                        completion;
                    cursorPos = input.length; // Move cursor to end
                    allCompletions = [];
                    filteredCompletions = [];
                    filterStartIndex = -1;
                    render();
                }
            } else if (code === 127 || code === 8) {
                // Backspace - delete character before cursor
                if (cursorPos > 0) {
                    input =
                        input.slice(0, cursorPos - 1) + input.slice(cursorPos);
                    cursorPos--;
                    // Update completions state
                    if (
                        filterStartIndex < 0 ||
                        input.length < filterStartIndex
                    ) {
                        filteredCompletions = [];
                        allCompletions = [];
                        filterStartIndex = -1;
                    } else {
                        filterCompletions();
                    }
                    // Just render - skip async updateCompletions to avoid double render/flash
                    render();
                }
            } else if (code >= 32 && code < 127) {
                // Printable ASCII character - insert at cursor position
                input =
                    input.slice(0, cursorPos) + data + input.slice(cursorPos);
                cursorPos++;
                // If typing a space, always fetch new completions (new context)
                if (data === " ") {
                    // Clear completions and render immediately to prevent flashing
                    filteredCompletions = [];
                    render();
                    await updateCompletions();
                } else if (
                    filterStartIndex >= 0 &&
                    input.length > filterStartIndex
                ) {
                    // If we have completions and are within filter range, just refilter
                    filterCompletions();
                    render();
                } else {
                    // Clear completions and render immediately to prevent flashing
                    filteredCompletions = [];
                    render();
                    await updateCompletions();
                }
            }
        };

        const cleanup = () => {
            stdin.removeListener("data", onData);
            if (stdin.isTTY) {
                stdin.setRawMode(wasRaw || false);
            }
            stdin.pause();
        };

        stdin.on("data", onData);
    });
}

async function question(
    message: string,
    rl?: readline.promises.Interface,
): Promise<string> {
    const closeOnExit = !rl;
    if (!rl) {
        rl = createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
        });
    }

    try {
        // Let readline handle cursor positioning natively
        return await rl.question(message);
    } finally {
        if (closeOnExit) {
            rl.close();
        }
    }
}

/**
 * Initialize enhanced console
 * Note: Raw mode is intentionally NOT used to avoid conflicts with readline input.
 * Ctrl+C is handled by the default SIGINT handler.
 */
function initializeEnhancedConsole(_rl?: readline.promises.Interface) {
    // Set up SIGINT handler for spinner cleanup
    process.on("SIGINT", () => {
        if (currentSpinner) {
            currentSpinner.stop();
            currentSpinner = null;
        }
        process.exit(0);
    });
}

let usingEnhancedConsole = false;

/**
 * Wrapper for using enhanced console ClientIO
 */
export async function withEnhancedConsoleClientIO(
    callback: (clientIO: ClientIO) => Promise<void>,
    rl?: readline.promises.Interface,
) {
    if (usingEnhancedConsole) {
        throw new Error("Cannot have multiple enhanced console clients");
    }
    usingEnhancedConsole = true;

    try {
        initializeEnhancedConsole(rl);

        // Show welcome header
        const width = process.stdout.columns || 80;
        console.log(ANSI.dim + "═".repeat(width) + ANSI.reset);
        console.log(
            chalk.bold(" TypeAgent Interactive Mode ") +
                chalk.dim("(Enhanced UI)"),
        );
        console.log(ANSI.dim + "═".repeat(width) + ANSI.reset);
        console.log("");

        await callback(createEnhancedClientIO(rl));
    } finally {
        if (currentSpinner) {
            currentSpinner.stop();
            currentSpinner = null;
        }
        process.stdin.pause();
        usingEnhancedConsole = false;
    }
}

/**
 * Enhanced command processor with spinner support and tab completion
 */
export async function processCommandsEnhanced<T>(
    interactivePrompt: string | ((context: T) => string | Promise<string>),
    processCommand: (request: string, context: T) => Promise<any>,
    context: T,
    inputs?: string[],
    getCompletions?: (line: string, context: T) => Promise<any>,
) {
    const fs = await import("node:fs");
    let history: string[] = [];
    if (fs.existsSync("command_history.json")) {
        const hh = JSON.parse(
            fs.readFileSync("command_history.json", { encoding: "utf-8" }),
        );
        history = hh.commands;
    }

    // Create completer function for tab completion
    const completer = getCompletions
        ? async (line: string): Promise<[string[], string]> => {
              try {
                  const completions = await getCompletions(line, context);
                  return [completions, line];
              } catch {
                  return [[], line];
              }
          }
        : undefined;

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        history,
        terminal: true,
        completer,
    });

    const promptColor = chalk.cyanBright;

    while (true) {
        const prompt =
            typeof interactivePrompt === "function"
                ? await interactivePrompt(context)
                : interactivePrompt;

        // Draw separator before prompt
        const width = process.stdout.columns || 80;
        process.stdout.write(ANSI.dim + "─".repeat(width) + ANSI.reset + "\n");

        let request: string;
        if (inputs) {
            request = getNextInput(prompt, inputs, promptColor);
        } else if (getCompletions) {
            // Use inline completion system
            request = await questionWithCompletion(
                promptColor(prompt),
                (line: string) => getCompletions(line, context),
            );
        } else {
            request = await question(promptColor(prompt), rl);
        }

        // Skip empty input - just loop back to show prompt again
        if (!request.length) {
            continue;
        }

        // Draw separator after input
        process.stdout.write(ANSI.dim + "─".repeat(width) + ANSI.reset + "\n");

        if (
            request.toLowerCase() === "quit" ||
            request.toLowerCase() === "exit"
        ) {
            break;
        }

        try {
            // Start spinner for processing
            startProcessingSpinner("Processing request...");

            await processCommand(request, context);

            // Stop spinner on success
            stopSpinner("success", "Complete");

            history.push(request);
        } catch (error) {
            stopSpinner("fail", "Error");
            console.log(chalk.red("### ERROR:"));
            console.log(error);
        }

        console.log("");

        // save command history
        fs.writeFileSync(
            "command_history.json",
            JSON.stringify({ commands: (rl as any).history }),
        );
    }
}

function getNextInput(
    prompt: string,
    inputs: string[],
    promptColor: (s: string) => string,
): string {
    while (true) {
        let input = inputs.shift();
        if (input === undefined) {
            return "exit";
        }
        input = input.trim();
        if (input.length === 0) {
            continue;
        }
        if (!input.startsWith("#")) {
            console.log(`${promptColor(prompt)}${input}`);
            return input;
        }
        console.log(chalk.green(input));
    }
}

/**
 * Get styled console prompt
 * Returns a clean prompt regardless of status text
 */
export function getEnhancedConsolePrompt(_text: string): string {
    return "> ";
}
