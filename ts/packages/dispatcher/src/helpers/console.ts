// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgentEvent,
    DisplayAppendMode,
    DisplayContent,
    MessageContent,
} from "@typeagent/agent-sdk";
import {
    ClientIO,
    IAgentMessage,
    RequestId,
} from "../context/interactiveIO.js";
import { TemplateEditConfig } from "../translation/actionTemplate.js";
import chalk from "chalk";
import stringWidth from "string-width";
import { createInterface } from "readline/promises";
import fs from "fs";
import readline from "readline";
import open from 'open';

function displayPadEnd(content: string, length: number): string {
    // Account for full width characters
    return `${content}${" ".repeat(length - stringWidth(content))}`;
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
                stringWidth(row[i]),
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

function createConsoleClientIO(rl?: readline.promises.Interface): ClientIO {
    let lastAppendMode: DisplayAppendMode | undefined;
    function displayContent(
        content: DisplayContent,
        appendMode?: DisplayAppendMode,
    ) {
        let message: MessageContent;
        if (typeof content === "string" || Array.isArray(content)) {
            message = content;
        } else {
            // TODO: should reject html content
            message = content.content;
            switch (content.kind) {
                case "status":
                    message = chalk.grey(content.content);
                    break;
                case "error":
                    message = chalk.red(content.content);
                    break;
                case "warning":
                    message = chalk.yellow(content.content);
                    break;
                case "info":
                    message = chalk.grey(content.content);
                    break;
                case "success":
                    message = chalk.greenBright(content.content);
                    break;
                default:
                    message = chalk.green(content.content);
                    break;
            }
        }

        const displayText = messageContentToText(message);
        if (appendMode !== "inline") {
            if (lastAppendMode === "inline") {
                process.stdout.write("\n");
            }
            process.stdout.write(displayText);
            process.stdout.write("\n");
        } else {
            process.stdout.write(displayText);
        }

        lastAppendMode = appendMode;
    }

    return {
        clear(): void {
            console.clear();
        },
        exit(): void {
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
            source: string,
            requestId: RequestId,
            actionIndex: number,
            displayId: string,
            nextRefreshMs: number,
        ): void {
            // REVIEW: Ignored.
        },

        // Input
        async askYesNo(
            message: string,
            requestId: RequestId,
            defaultValue?: boolean,
        ): Promise<boolean> {
            const input = await question(`${message} (y/n)`, rl);
            return input.toLowerCase() === "y";
        },
        async proposeAction(
            actionTemplates: TemplateEditConfig,
            requestId: RequestId,
            source: string,
        ): Promise<unknown> {
            // TODO: Not implemented
            return undefined;
        },

        // Notification (TODO: turn these in to dispatcher events)
        notify(
            event: string,
            requestId: RequestId,
            data: any,
            source: string,
        ): void {
            switch (event) {
                case AppAgentEvent.Error:
                    console.error(chalk.red(data));
                    break;
                case AppAgentEvent.Warning:
                    console.warn(chalk.yellow(data));
                    break;
                case AppAgentEvent.Info:
                    console.info(data);
                    break;
                default:
                // ignored.
            }
        },
        // Host specific (TODO: Formalize the API)
        takeAction(action: string, data: unknown): void {

            if (action === "open-folder") {
                open(data as string);
                return;
            }

            throw new Error(`Action ${action} not supported`);
        },
    };
}

function initializeConsole(rl?: readline.promises.Interface) {
    // set the input back to raw mode and resume the input to drain key press during action and not echo them
    process.stdin.setRawMode(true);
    process.stdin.on("keypress", (_, key) => {
        if (key?.ctrl && key.name === "c") {
            process.emit("SIGINT");
        } else if (key.name === "escape" && rl !== undefined) {
            // clear the input lien
            rl!.write(null, { ctrl: true, name: "u" });
        }
    });
    process.stdin.resume();
    readline.emitKeypressEvents(process.stdin);
}

let usingConsole = false;
export async function withConsoleClientIO(
    callback: (clientIO: ClientIO) => Promise<void>,
    rl?: readline.promises.Interface,
) {
    if (usingConsole) {
        throw new Error("Cannot have multiple console clients");
    }
    usingConsole = true;
    try {
        initializeConsole(rl);
        await callback(createConsoleClientIO(rl));
    } finally {
        process.stdin.pause();
        usingConsole = false;
    }
}

async function question(
    message: string,
    rl?: readline.promises.Interface,
    history?: string[],
): Promise<string> {
    // readline doesn't account for the right full width for some emojis.
    // Do manual adjustment.
    const adjust = (data: Buffer) => {
        if (data[0] === 13) {
            return;
        }

        process.stdout.cursorTo(
            stringWidth(message + rl!.line.slice(0, rl!.cursor)),
        );
    };
    process.stdin.on("data", adjust);

    try {
        const p = rl!.question(message);
        process.stdout.cursorTo(stringWidth(message));
        return await p;
    } finally {
        process.stdin.off("data", adjust);
    }
}

const promptColor = chalk.cyanBright;

function getNextInput(prompt: string, inputs: string[]): string {
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
        // Handle comments in files
        console.log(chalk.green(input));
    }
}

/**
 * A request processor for interactive input or input from a text file. If an input file name is specified,
 * the callback function is invoked for each line in file. Otherwise, the callback function is invoked for
 * each line of interactive input until the user types "quit" or "exit".
 * @param interactivePrompt Prompt to present to user.
 * @param inputFileName Input text file name, if any.
 * @param processRequest Async callback function that is invoked for each interactive input or each line in text file.
 */
export async function processCommands<T>(
    interactivePrompt: string | ((context: T) => string),
    processCommand: (request: string, context: T) => Promise<any>,
    context: T,
    inputs?: string[],
) {
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

    process.stdin.setRawMode(true);
    process.stdin.resume();

    while (true) {
        const prompt =
            typeof interactivePrompt === "function"
                ? interactivePrompt(context)
                : interactivePrompt;
        const request = inputs
            ? getNextInput(prompt, inputs)
            : await question(promptColor(prompt), rl, history);
        if (request.length) {
            if (
                request.toLowerCase() === "quit" ||
                request.toLowerCase() === "exit"
            ) {
                break;
            } else {
                try {
                    await processCommand(request, context);
                    history.push(request);
                } catch (error) {
                    console.log("### ERROR:");
                    console.log(error);
                }
            }
        }
        console.log("");

        // save command history
        fs.writeFileSync(
            "command_history.json",
            JSON.stringify({ commands: (rl as any).history }),
        );
    }
}
