import {
    AppAgentEvent,
    DisplayAppendMode,
    DisplayContent,
    MessageContent,
} from "@typeagent/agent-sdk";
import {
    ClientIO,
    IAgentMessage,
    NotifyExplainedData,
    RequestId,
} from "../handlers/common/interactiveIO.js";
import { TemplateEditConfig } from "../translation/actionTemplate.js";
import chalk from "chalk";
import readline from "readline/promises";
import stringWidth from "string-width";
import { askYesNo } from "../utils/interactive.js";

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

export function createConsoleClientIO(
    stdio?: readline.Interface | undefined,
): ClientIO {
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
        setDisplay(message: IAgentMessage): void {
            displayContent(message.message);
        },
        appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void {
            displayContent(message.message, mode);
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
            return askYesNo(message, stdio, defaultValue);
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
            throw new Error(`Action ${action} not supported`);
        },
    };
}
