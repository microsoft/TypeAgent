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
import { getContentForType } from "@typeagent/agent-sdk/helpers/display";
import type {
    RequestId,
    ClientIO,
    Dispatcher,
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
import {
    isSlashCommand,
    handleSlashCommand,
    getVerboseIndicator,
} from "./slashCommands.js";
import {
    setSpinnerAccessor,
    getDebugPanel,
    PromptRenderer,
} from "./debugInterceptor.js";

// Track current processing state
let currentSpinner: EnhancedSpinner | null = null;

// Wire up the debug interceptor's spinner access
setSpinnerAccessor(() => currentSpinner);

// Pending choice promise — main loop awaits this before showing next prompt
let pendingChoicePromise: Promise<void> | null = null;

// Active custom prompt renderer (set by questionWithCompletion)
let activePromptRenderer: PromptRenderer | null = null;

/**
 * Manages an ANSI scroll region so the prompt is anchored to the
 * bottom of the terminal.  Content written via writeContent() scrolls
 * naturally in the upper region; the prompt is redrawn in-place in the
 * fixed lower region.
 */
class TerminalLayout {
    private promptRows = 0;
    private active = false;
    private resizeHandler: (() => void) | undefined;

    /** Activate the scroll region, reserving `rows` at the bottom. */
    setup(rows: number) {
        this.promptRows = rows;
        this.active = true;
        // Push existing content upward so the fixed prompt region at
        // the bottom doesn't overwrite the last lines of output.
        // When the cursor is near the bottom of the terminal, these
        // newlines force the terminal to scroll, creating blank space
        // for the prompt area.
        process.stdout.write("\n".repeat(this.promptRows));
        const height = process.stdout.rows || 24;
        const scrollHeight = Math.max(1, height - this.promptRows);
        process.stdout.write(`\x1b[${scrollHeight};1H`);
        this.applyScrollRegion();
        // Listen for terminal resize
        this.resizeHandler = () => {
            if (this.active) {
                this.applyScrollRegion();
            }
        };
        process.stdout.on("resize", this.resizeHandler);
    }

    /** Update the number of reserved prompt rows (e.g. when input wraps). */
    setPromptRows(rows: number) {
        if (rows !== this.promptRows) {
            this.promptRows = rows;
            if (this.active) this.applyScrollRegion();
        }
    }

    private inlineBuffer: string = "";

    /** Write content into the scroll region (appears above the prompt). */
    writeContent(text: string) {
        if (!this.active) {
            process.stdout.write(text);
            return;
        }
        this.inlineBuffer = "";
        const height = process.stdout.rows || 24;
        const scrollBottom = height - this.promptRows;
        const promptStart = scrollBottom + 1;
        // Move to bottom of scroll region, scroll the region up by one line
        // with "\n", write the content, then reposition to the start of the
        // fixed region so render() can finalise the exact cursor position.
        process.stdout.write(
            `\x1b[${scrollBottom};1H` + "\n" + text + `\x1b[${promptStart};1H`,
        );
    }

    /** Append inline (streaming) text. Accumulates tokens in a buffer without
     *  writing to stdout. An empty-string flush signal (sent when streaming
     *  ends) commits the full buffer as a single block via writeContent().
     *  This avoids repeated in-place rewrites that produce duplicate output
     *  on passive observer clients sharing the same scroll-region state. */
    writeInline(text: string) {
        if (!this.active) {
            process.stdout.write(text);
            return;
        }
        if (text === "") {
            // End-of-stream flush signal — commit the accumulated buffer.
            this.flushInline();
        } else {
            this.inlineBuffer += text;
        }
    }

    /** Flush the inline buffer as a committed block line (called when the
     *  next message is a non-inline block). */
    flushInline() {
        if (!this.active || this.inlineBuffer === "") {
            return;
        }
        // writeContent() clears inlineBuffer as its first step.
        this.writeContent(this.inlineBuffer);
    }

    /** Draw content in the fixed bottom region at a given row offset (0-based from prompt start). */
    drawFixed(row: number, text: string) {
        if (!this.active) return;
        const height = process.stdout.rows || 24;
        const promptStart = height - this.promptRows + 1;
        process.stdout.write(`\x1b[${promptStart + row};1H\x1b[2K` + text);
    }

    /** Clear the entire fixed region. */
    clearFixed() {
        if (!this.active) return;
        const height = process.stdout.rows || 24;
        const promptStart = height - this.promptRows + 1;
        for (let r = promptStart; r <= height; r++) {
            process.stdout.write(`\x1b[${r};1H\x1b[2K`);
        }
    }

    /** Move cursor to a specific column on a given row of the fixed region. */
    moveCursorToFixed(row: number, col: number) {
        if (!this.active) return;
        const height = process.stdout.rows || 24;
        const promptStart = height - this.promptRows + 1;
        process.stdout.write(`\x1b[${promptStart + row};${col}H`);
    }

    /** Tear down the scroll region and restore normal terminal behavior. */
    cleanup() {
        if (!this.active) return;
        this.active = false;
        if (this.resizeHandler) {
            process.stdout.removeListener("resize", this.resizeHandler);
            this.resizeHandler = undefined;
        }
        // Reset scroll region to full terminal first
        process.stdout.write("\x1b[r");
        // Move to the row just after the scroll region ended and clear
        // everything from there to the bottom of the screen. This wipes
        // the old fixed region content (prompt/rule/hint).
        const height = process.stdout.rows || 24;
        const scrollBottom = Math.max(1, height - this.promptRows);
        process.stdout.write(`\x1b[${scrollBottom};1H`);
        // Emit a newline to advance past the last content line, then
        // clear from cursor to end of screen to remove all stale content.
        process.stdout.write("\n\x1b[J");
    }

    get isActive() {
        return this.active;
    }

    private applyScrollRegion() {
        const height = process.stdout.rows || 24;
        const scrollHeight = Math.max(1, height - this.promptRows);
        process.stdout.write(`\x1b[1;${scrollHeight}r`);
    }
}

// Shared terminal layout instance — activated when questionWithCompletion is running
let terminalLayout: TerminalLayout | null = null;

// Track the active request for cancellation support
let currentRequestId: string | undefined;
let isProcessing = false;
let lastCtrlCTime = 0;

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
    dispatcherRef?: { current?: Dispatcher },
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
            // CLI prefers text alternates when available
            const textContent = getContentForType(content, "text");
            if (textContent !== undefined && content.type !== "text") {
                message = textContent;
                contentType = "text";
            } else {
                message = content.content;
                contentType = content.type || "text";
            }
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
                // Flush any inline stream content before writing block content
                currentSpinner.flushStream();
                currentSpinner.writeAbove(displayText);
            }
        } else if (terminalLayout?.isActive && activePromptRenderer) {
            // Scroll region is active — write content into the scroll region.
            // The prompt stays anchored at the bottom automatically.
            if (appendMode !== "inline") {
                // Any accumulated inline buffer is intentionally discarded here —
                // writeContent() clears inlineBuffer before writing, so partial
                // streaming tokens won't be re-emitted with the new block content.
                terminalLayout.writeContent(displayText);
            } else {
                terminalLayout.writeInline(displayText);
            }
            activePromptRenderer.redraw();
        } else if (activePromptRenderer) {
            // Fallback: scroll region not active but prompt renderer is.
            const rows = activePromptRenderer.rows();
            for (let i = 0; i < rows; i++) {
                process.stdout.write("\x1b[1A\x1b[2K");
            }
            if (appendMode !== "inline") {
                if (lastAppendMode === "inline") {
                    process.stdout.write("\n");
                }
                process.stdout.write(displayText);
                process.stdout.write("\n");
            } else {
                process.stdout.write(displayText);
            }
            const dp = getDebugPanel();
            if (dp && dp.lineCount > 0) {
                dp.renderStaticSummary();
            }
            activePromptRenderer.redraw();
            process.stdout.write("\x1b[J");
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
                // Ensure content starts on a fresh line (cursor may be
                // mid-line after a spinner was cleared without a newline)
                process.stdout.write("\r\x1b[2K");
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
        setUserRequest(requestId: RequestId) {
            currentRequestId = requestId.requestId;
        },
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
        requestChoice(
            _requestId: RequestId,
            choiceId: string,
            type: "yesNo" | "multiChoice",
            message: string,
            choices: string[],
            source: string,
        ): void {
            // Set up a promise so the main loop waits before
            // showing "Complete" and the next prompt.
            let resolveChoice: () => void;
            pendingChoicePromise = new Promise<void>((resolve) => {
                resolveChoice = resolve;
            });

            (async () => {
                try {
                    // Stop and clear spinner — the main loop will
                    // handle completion after the choice resolves.
                    if (currentSpinner) {
                        currentSpinner.stop();
                        currentSpinner = null;
                    }

                    const width = process.stdout.columns || 80;
                    const line = ANSI.dim + "─".repeat(width) + ANSI.reset;

                    process.stdout.write("\n");
                    process.stdout.write(line + "\n");

                    let response: boolean | number[];
                    if (type === "yesNo") {
                        const prompt = `${chalk.cyan("?")} ${chalk.dim(`[${source}]`)} ${message} ${chalk.dim("(y/n)")} `;
                        const input = await question(prompt, rl);
                        response =
                            input.toLowerCase() === "y" ||
                            input.toLowerCase() === "yes";
                    } else {
                        // multiChoice — show numbered list, accept comma-separated
                        process.stdout.write(
                            `${chalk.cyan("?")} ${chalk.dim(`[${source}]`)} ${message}\n`,
                        );
                        for (let i = 0; i < choices.length; i++) {
                            process.stdout.write(
                                `  ${chalk.cyan(`${i + 1}.`)} ${choices[i]}\n`,
                            );
                        }
                        const input = await question(
                            `${chalk.dim("Enter choice numbers (comma-separated):")} `,
                            rl,
                        );
                        response = input
                            .split(",")
                            .map((s) => parseInt(s.trim(), 10) - 1)
                            .filter(
                                (n) =>
                                    !isNaN(n) && n >= 0 && n < choices.length,
                            );
                    }

                    process.stdout.write(line + "\n");

                    if (dispatcherRef?.current) {
                        await dispatcherRef.current.respondToChoice(
                            choiceId,
                            response,
                        );
                    }
                } catch (err) {
                    console.error(chalk.red(`Choice error: ${err}`));
                } finally {
                    resolveChoice!();
                }
            })();
        },
        // Async deferred pattern stubs (used by server, no-op in CLI)
        requestInteraction(): void {
            // CLI does not support deferred interactions
        },
        interactionResolved(): void {
            // CLI does not support deferred interactions
        },
        interactionCancelled(): void {
            // CLI does not support deferred interactions
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
    history: string[] = [],
): Promise<string> {
    return new Promise<string>((resolve) => {
        let input = "";
        let cursorPos = 0; // Position within input string (0 = before first char)
        let allCompletions: string[] = []; // All available completions
        let filteredCompletions: string[] = []; // Filtered based on user typing
        let completionIndex = 0;
        let historyIndex = history.length; // Start past the end (current empty input)
        let savedInput = ""; // Saves current input when navigating history
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

        let prevInputRows = 1;
        const layout = new TerminalLayout();
        terminalLayout = layout;

        // Fixed region layout:
        //   row 0: separator (─)
        //   row 1..inputRows: prompt + input (may wrap)
        //   row inputRows+1: bottom rule (─)
        //   row inputRows+2: hint line
        const EXTRA_ROWS = 3; // separator + bottom rule + hint

        const render = () => {
            const promptText = chalk.cyanBright(message);
            const width = process.stdout.columns || 80;

            const inputLineWidth =
                getDisplayWidth(message) + getDisplayWidth(input);
            const inputRows = Math.max(1, Math.ceil(inputLineWidth / width));
            const totalRows = inputRows + EXTRA_ROWS;

            // Update scroll region if prompt height changed
            layout.setPromptRows(totalRows);

            // drawFixed() clears each line before writing, so a separate
            // clearFixed() pass is not needed and would cause visible
            // flicker (blank frame between clear and redraw).  Only clear
            // stale rows left over when the prompt shrinks (e.g. input
            // un-wraps to fewer lines).
            const prevTotal = prevInputRows + EXTRA_ROWS;
            if (totalRows < prevTotal) {
                for (let r = totalRows; r < prevTotal; r++) {
                    layout.drawFixed(r, "");
                }
            }

            // Row 0: separator
            layout.drawFixed(0, ANSI.dim + "─".repeat(width) + ANSI.reset);

            // Row 1: prompt + input + ghost completion text
            let inputLine = promptText + input;
            if (
                filteredCompletions.length > 0 &&
                completionIndex < filteredCompletions.length
            ) {
                const completion = filteredCompletions[completionIndex];
                const fullCompletion =
                    completionPrefix +
                    (filterStartIndex > completionPrefix.length ? " " : "") +
                    completion;
                if (fullCompletion.length > input.length) {
                    const suggestion = fullCompletion.slice(input.length);
                    const counter = ` ${completionIndex + 1}/${filteredCompletions.length}`;
                    inputLine += chalk.dim(suggestion + counter);
                }
            }
            layout.drawFixed(1, inputLine);

            // Bottom rule
            layout.drawFixed(
                inputRows + 1,
                ANSI.dim + "─".repeat(width) + ANSI.reset,
            );

            // Hint line
            let hint: string;
            if (filteredCompletions.length > 0) {
                hint = "↑↓ completions · tab accept · esc clear";
            } else if (input.length > 0) {
                hint = "↑↓ history · esc clear";
            } else {
                hint = "↑↓ history · /help commands";
            }
            layout.drawFixed(inputRows + 2, "  " + chalk.dim(hint));

            // Position cursor in the input line
            const cursorAbsCol =
                getDisplayWidth(message) +
                getDisplayWidth(input.substring(0, cursorPos));
            const cursorRow = Math.floor(cursorAbsCol / width);
            layout.moveCursorToFixed(1 + cursorRow, (cursorAbsCol % width) + 1);
            stdout.write(ANSI.showCursor);

            prevInputRows = inputRows;
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

        // Activate the scroll region and draw initial prompt
        layout.setup(prevInputRows + EXTRA_ROWS);
        render();

        const panel = getDebugPanel();
        const promptRenderer: PromptRenderer = {
            rows: () => prevInputRows + EXTRA_ROWS,
            redraw: () => render(),
        };
        panel?.setPromptRenderer(promptRenderer);
        activePromptRenderer = promptRenderer;

        // Handle keypresses
        const onData = async (chunk: Buffer) => {
            const data = chunk.toString();

            // Auto-dismiss framed debug panel on any key except Ctrl+D
            const dpForDismiss = getDebugPanel();
            if (dpForDismiss?.isPanelVisible && data.charCodeAt(0) !== 4) {
                dpForDismiss.dismissPanel();
            }

            // Handle multi-byte sequences
            if (data.startsWith("\x1b[")) {
                // Arrow keys
                if (data === "\x1b[A") {
                    if (filteredCompletions.length > 0) {
                        // Cycle to previous completion
                        completionIndex =
                            (completionIndex - 1 + filteredCompletions.length) %
                            filteredCompletions.length;
                        render();
                    } else if (history.length > 0 && historyIndex > 0) {
                        // Navigate to previous history entry
                        if (historyIndex === history.length) {
                            savedInput = input;
                        }
                        historyIndex--;
                        input = history[historyIndex];
                        cursorPos = input.length;
                        render();
                    }
                    return;
                } else if (data === "\x1b[B") {
                    if (filteredCompletions.length > 0) {
                        // Cycle to next completion
                        completionIndex =
                            (completionIndex + 1) % filteredCompletions.length;
                        render();
                    } else if (historyIndex < history.length) {
                        // Navigate to next history entry
                        historyIndex++;
                        input =
                            historyIndex === history.length
                                ? savedInput
                                : history[historyIndex];
                        cursorPos = input.length;
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
                }
                return;
            }

            if (data === "\x1b") {
                if (filteredCompletions.length > 0) {
                    // Esc with completions showing — clear completions
                    allCompletions = [];
                    filteredCompletions = [];
                    filterStartIndex = -1;
                } else {
                    // Esc with no completions — clear input
                    input = "";
                    cursorPos = 0;
                    historyIndex = history.length;
                }
                render();
                return;
            }

            const code = data.charCodeAt(0);

            if (code === 3) {
                // Ctrl+C — clear bottom rule + hint before exit
                stdout.write("\n\n\x1b[K\n");
                cleanup();
                process.exit(0);
            } else if (code === 4) {
                // Ctrl+D — cycle debug panel: off → compact → full → off
                const dp = getDebugPanel();
                if (dp && dp.lineCount > 0) {
                    if (!dp.isPanelVisible) {
                        // Off → compact
                        dp.toggleAtPrompt();
                        const panelLines = dp.renderFramedPanel();
                        for (const line of panelLines) {
                            layout.writeContent(line);
                        }
                    } else if (!dp.isPanelFull) {
                        // Compact → full
                        dp.toggleFullMode();
                        const panelLines = dp.renderFramedPanel(true);
                        for (const line of panelLines) {
                            layout.writeContent(line);
                        }
                    } else {
                        // Full → off
                        dp.toggleFullMode();
                        dp.toggleAtPrompt();
                    }
                    render();
                }
                return;
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
                // Tear down the scroll region and write the finalized input
                // into the normal terminal flow so it appears in scrollback.
                cleanup();
                const width = process.stdout.columns || 80;
                const inputDisplay = `❯ ${input}`;
                const visibleLen = getDisplayWidth(inputDisplay);
                const pad = Math.max(0, width - visibleLen);
                stdout.write(
                    "\n" +
                        chalk.bgGray.white.bold(
                            inputDisplay + " ".repeat(pad),
                        ) +
                        "\n\n",
                );
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
            layout.cleanup();
            terminalLayout = null;
            panel?.setPromptRenderer(null);
            activePromptRenderer = null;
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
 * Initialize enhanced console with cancellation support.
 * During command execution, Escape and Ctrl+C trigger command cancellation.
 * Double Ctrl+C within 1 second exits the process.
 */
function initializeEnhancedConsole(
    _rl?: readline.promises.Interface,
    dispatcherRef?: { current?: Dispatcher },
) {
    process.on("SIGINT", () => {
        if (isProcessing && dispatcherRef?.current && currentRequestId) {
            const now = Date.now();
            if (now - lastCtrlCTime < 1000) {
                // Double Ctrl+C — force exit
                if (currentSpinner) {
                    currentSpinner.stop();
                    currentSpinner = null;
                }
                process.exit(0);
            }
            lastCtrlCTime = now;
            dispatcherRef.current.cancelCommand(currentRequestId);
            return;
        }
        if (currentSpinner) {
            currentSpinner.stop();
            currentSpinner = null;
        }
        process.exit(0);
    });
}

let usingEnhancedConsole = false;

// ── Startup Banner ──────────────────────────────────────────────────────

// Logo mark — hexagonal badge with floating "T" (4 lines tall, 12 chars wide)
const LOGO_LINES = [
    "  ╱▔▔▔▔▔╲   ",
    " ╱ ▀▀█▀▀ ╲  ",
    " ╲   █   ╱  ",
    "  ╲▁▁▁▁▁╱   ",
];
const LOGO_WIDTH = 12;

function renderStartupBanner(): void {
    const width = process.stdout.columns || 80;
    const innerWidth = width - 4; // "│  " + "  │"
    const version = "0.0.1";

    // Content lines to render alongside the logo
    const contentLines = [
        chalk.cyan.bold("TypeAgent") + chalk.dim(` v${version}`),
        chalk.dim("Your personal AI assistant"),
        "",
        chalk.dim("Type a request or use /help to see commands."),
    ];

    const hintLine =
        "  " +
        chalk.dim(
            "/help commands · /verbose debug · ctrl+d debug · ctrl+c exit",
        );

    // Build the box
    const top = chalk.dim("╭" + "─".repeat(width - 2) + "╮");
    const bottom = chalk.dim("╰" + "─".repeat(width - 2) + "╯");

    const lines: string[] = [];
    lines.push(top);
    // Empty line before logo
    lines.push(chalk.dim("│") + " ".repeat(width - 2) + chalk.dim("│"));

    // Render logo + content side by side
    const totalRows = Math.max(LOGO_LINES.length, contentLines.length);
    for (let i = 0; i < totalRows; i++) {
        const logo =
            i < LOGO_LINES.length ? LOGO_LINES[i] : " ".repeat(LOGO_WIDTH);
        const coloredLogo = chalk.cyan(logo);
        const content = i < contentLines.length ? contentLines[i] : "";
        const contentVisible = content.replace(
            // eslint-disable-next-line no-control-regex
            /\x1b\[[0-9;]*m/g,
            "",
        );
        const padding = Math.max(
            0,
            innerWidth - LOGO_WIDTH - contentVisible.length,
        );
        lines.push(
            chalk.dim("│") +
                "  " +
                coloredLogo +
                content +
                " ".repeat(padding) +
                chalk.dim("│"),
        );
    }

    // Empty line before close
    lines.push(chalk.dim("│") + " ".repeat(width - 2) + chalk.dim("│"));
    lines.push(bottom);
    lines.push(hintLine);
    lines.push("");

    for (const line of lines) {
        process.stdout.write(line + "\n");
    }
}

/**
 * Wrapper for using enhanced console ClientIO
 */
export async function withEnhancedConsoleClientIO(
    callback: (
        clientIO: ClientIO,
        bindDispatcher: (d: Dispatcher) => void,
    ) => Promise<void>,
    rl?: readline.promises.Interface,
) {
    if (usingEnhancedConsole) {
        throw new Error("Cannot have multiple enhanced console clients");
    }
    usingEnhancedConsole = true;

    try {
        const dispatcherRef: { current?: Dispatcher } = {};
        initializeEnhancedConsole(rl, dispatcherRef);

        // Show welcome banner
        renderStartupBanner();
        await callback(
            createEnhancedClientIO(rl, dispatcherRef),
            (d: Dispatcher) => {
                dispatcherRef.current = d;
            },
        );
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
 * Enable raw mode on stdin during command execution so we can detect
 * Escape and Ctrl+C for cancellation. Returns a cleanup function.
 */
function startExecutionKeyListener(
    dispatcher: Dispatcher | undefined,
): () => void {
    if (!dispatcher || !process.stdin.isTTY) {
        return () => {};
    }

    const onData = (data: Buffer | string) => {
        // stdin encoding may be set to utf8 by questionWithCompletion,
        // so data can be a string. Use charCodeAt for consistent handling.
        const code = typeof data === "string" ? data.charCodeAt(0) : data[0];
        if (data.length === 1 && code === 0x1b && currentRequestId) {
            // Escape key — cancel current command
            dispatcher.cancelCommand(currentRequestId);
        } else if (data.length === 1 && code === 4) {
            // Ctrl+D — toggle debug panel expand/collapse
            const panel = getDebugPanel();
            if (panel && panel.lineCount > 0) {
                panel.toggle();
            }
        } else if (data.length === 1 && code === 3 && currentRequestId) {
            // Ctrl+C during raw mode — cancel or double-press exit
            const now = Date.now();
            if (now - lastCtrlCTime < 1000) {
                if (currentSpinner) {
                    currentSpinner.stop();
                    currentSpinner = null;
                }
                process.exit(0);
            }
            lastCtrlCTime = now;
            dispatcher.cancelCommand(currentRequestId);
        }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);

    return () => {
        process.stdin.removeListener("data", onData);
        // Don't change raw mode or pause here — let the next input handler
        // (questionWithCompletion) manage stdin state when it starts.
    };
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
    dispatcherForCancel?: Dispatcher,
) {
    const fs = await import("node:fs");
    let history: string[] = [];
    if (fs.existsSync("command_history.json")) {
        const hh = JSON.parse(
            fs.readFileSync("command_history.json", { encoding: "utf-8" }),
        );
        history = hh.commands;
    }

    // Only create readline when not using inline completions.
    // questionWithCompletion manages stdin directly; a readline attached
    // to the same stdin would consume events and break input.
    const rl = getCompletions
        ? undefined
        : createInterface({
              input: process.stdin,
              output: process.stdout,
              history,
              terminal: true,
          });

    const promptColor = chalk.cyanBright;

    while (true) {
        const prompt =
            typeof interactivePrompt === "function"
                ? await interactivePrompt(context)
                : interactivePrompt;

        const width = process.stdout.columns || 80;

        let request: string;
        if (inputs) {
            process.stdout.write(
                ANSI.dim + "─".repeat(width) + ANSI.reset + "\n",
            );
            request = getNextInput(prompt, inputs, promptColor);
        } else if (getCompletions) {
            // Use inline completion system with scroll region anchored prompt
            request = await questionWithCompletion(
                promptColor(prompt),
                (line: string) => getCompletions(line, context),
                history,
            );
        } else {
            process.stdout.write(
                ANSI.dim + "─".repeat(width) + ANSI.reset + "\n",
            );
            request = await question(promptColor(prompt), rl);
            if (request.length) {
                process.stdout.write(
                    ANSI.dim + "─".repeat(width) + ANSI.reset + "\n",
                );
            }
        }

        // Skip empty input - just loop back to show prompt again
        if (!request.length) {
            continue;
        }

        if (
            request.toLowerCase() === "quit" ||
            request.toLowerCase() === "exit"
        ) {
            break;
        }

        // Handle slash commands before sending to dispatcher
        if (isSlashCommand(request)) {
            try {
                const slashResult = await handleSlashCommand(request, (cmd) =>
                    processCommand(cmd, context),
                );
                if (slashResult.exit) {
                    break;
                }
            } catch (error) {
                console.log(chalk.red(`Error: ${error}`));
            }
            history.push(request);
            console.log("");
            continue;
        }

        try {
            // Reset debug panel for this command
            const panel = getDebugPanel();
            panel?.reset();

            // Start spinner for processing
            startProcessingSpinner("Processing request...");
            // Show execution hint below spinner
            const debugHint = panel ? " · ctrl+d debug" : "";
            const execHint = chalk.dim(
                `  esc cancel · ctrl+c cancel (2× exit)${debugHint}`,
            );
            process.stdout.write("\n" + execHint + "\x1b[K\x1b[1A\r");

            isProcessing = true;
            currentRequestId = undefined;
            const stopKeyListener =
                startExecutionKeyListener(dispatcherForCancel);
            let result: any;
            try {
                result = await processCommand(request, context);
            } finally {
                stopKeyListener();
                isProcessing = false;
            }

            // Stop live panel rendering but keep the buffer for post-command review
            panel?.stopRendering();
            process.stdout.write("\n\x1b[K\x1b[1A");

            // Wait for any pending choice prompt to complete
            // before showing "Complete" and the next prompt.
            if (pendingChoicePromise) {
                await pendingChoicePromise;
                pendingChoicePromise = null;
            }

            if (result?.cancelled) {
                stopSpinner("warn", "Cancelled");
            } else {
                stopSpinner("success", "Complete");
            }

            // Show static collapsed debug summary after spinner result
            if (panel && panel.lineCount > 0) {
                panel.renderStaticSummary();
            }

            history.push(request);
        } catch (error) {
            isProcessing = false;
            getDebugPanel()?.stopRendering();
            stopSpinner("fail", "Error");
            console.log(chalk.red("### ERROR:"));
            console.log(error);
        }

        console.log("");

        // save command history
        fs.writeFileSync(
            "command_history.json",
            JSON.stringify({ commands: history }),
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
    return `${getVerboseIndicator()}❯ `;
}

/**
 * Replay display history entries from a previous (or concurrent) session onto
 * the given clientIO so that the user sees the chat history when joining.
 *
 * User requests are printed as styled prompt lines; agent display entries are
 * forwarded through setDisplay / appendDisplay exactly as live messages would
 * be. Notifications and display-info entries are skipped — they are ephemeral.
 */
export async function replayDisplayHistory(
    dispatcher: Dispatcher,
    clientIO: ClientIO,
): Promise<void> {
    const entries = await dispatcher.getDisplayHistory();
    if (entries.length === 0) {
        return;
    }

    const width = process.stdout.columns || 80;
    process.stdout.write(
        chalk.dim(
            "─── session history " + "─".repeat(Math.max(0, width - 20)),
        ) + "\n",
    );

    for (const entry of entries) {
        switch (entry.type) {
            case "user-request":
                process.stdout.write(
                    chalk.cyanBright(`❯ `) + chalk.dim(entry.command) + "\n",
                );
                break;
            case "set-display":
                clientIO.setDisplay(entry.message);
                break;
            case "append-display":
                clientIO.appendDisplay(entry.message, entry.mode);
                break;
            // notify and set-display-info are ephemeral — skip them
        }
    }

    process.stdout.write(
        chalk.dim("─── now " + "─".repeat(Math.max(0, width - 8))) + "\n",
    );
}
