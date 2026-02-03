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
import {
    EnhancedSpinner,
    ANSI,
    CompletionMenu,
    CompletionItem,
    getDisplayWidth,
} from "interactive-app";
import { createInterface } from "readline/promises";
import readline from "readline";
import { convert } from "html-to-text";

// Track current processing state
let currentSpinner: EnhancedSpinner | null = null;

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

        if (typeof content === "string" || Array.isArray(content)) {
            message = content;
        } else {
            message = content.content;
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

        const displayText = colorFn(messageContentToText(message));

        // If spinner is active, write above it
        if (currentSpinner?.isActive()) {
            if (appendMode === "inline") {
                currentSpinner.appendStream(displayText);
            } else {
                currentSpinner.writeAbove(displayText);
            }
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
        if (isHtmlContent(data)) {
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

            // Create completion items from choices
            const items: CompletionItem[] = choices.map((choice, index) => {
                const item: CompletionItem = {
                    value: String(index),
                    label: choice,
                };
                if (index === defaultId) {
                    item.description = "(default)";
                }
                return item;
            });

            // Use completion menu for selection
            const menu = new CompletionMenu({ maxVisible: 8 });
            menu.show({ char: "", items, header: "Select an option" }, "");

            // Since we can't do real keyboard input here, use readline
            // Show numbered options
            process.stdout.write(ANSI.moveUp(menu["linesDrawn"] || 0));
            for (let i = 0; i < (menu["linesDrawn"] || 0); i++) {
                process.stdout.write(ANSI.clearLine + "\n");
            }
            process.stdout.write(ANSI.moveUp(menu["linesDrawn"] || 0));

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
            wordwrap: 80,
            preserveNewlines: false,
            selectors: [
                {
                    selector: "div",
                    format: "block",
                    options: { leadingLineBreaks: 1, trailingLineBreaks: 1 },
                },
                {
                    selector: "p",
                    format: "block",
                    options: { leadingLineBreaks: 1, trailingLineBreaks: 1 },
                },
                {
                    selector: "a",
                    format: "inline",
                    options: {
                        linkBrackets: false,
                        hideLinkHrefIfSameAsText: true,
                        ignoreHref: true,
                    },
                },
            ],
        });

        return result.replace(/\n{3,}/g, "\n\n").trim();
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
 * Enhanced command processor with spinner support
 */
export async function processCommandsEnhanced<T>(
    interactivePrompt: string | ((context: T) => string | Promise<string>),
    processCommand: (request: string, context: T) => Promise<any>,
    context: T,
    inputs?: string[],
) {
    const fs = await import("node:fs");
    let history: string[] = [];
    if (fs.existsSync("command_history.json")) {
        const hh = JSON.parse(
            fs.readFileSync("command_history.json", { encoding: "utf-8" }),
        );
        history = hh.commands;
    }

    const rl = createInterface({
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

        // Draw separator before prompt
        const width = process.stdout.columns || 80;
        process.stdout.write(ANSI.dim + "─".repeat(width) + ANSI.reset + "\n");

        let request: string;
        if (inputs) {
            request = getNextInput(prompt, inputs, promptColor);
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
 */
export function getEnhancedConsolePrompt(text: string): string {
    return `${text}> `;
}
