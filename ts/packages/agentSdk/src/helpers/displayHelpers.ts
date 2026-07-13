// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "../agentInterface.js";
import {
    DisplayAppendMode,
    DisplayContent,
    DisplayMessageKind,
    DisplayType,
    MessageContent,
    StructuredBlock,
    StructuredContent,
    TableBlock,
    TableCell,
    TableColumn,
    TypedDisplayContent,
} from "../display.js";

/**
 * Given a TypedDisplayContent, find the content for a preferred type.
 * Checks alternates first, then falls back to the primary content if it matches.
 * Returns undefined if the preferred type is not available.
 */
export function getContentForType(
    content: TypedDisplayContent,
    preferredType: DisplayType,
): MessageContent | undefined {
    if (content.alternates) {
        for (const alt of content.alternates) {
            if (alt.type === preferredType) {
                return alt.content;
            }
        }
    }
    if (content.type === preferredType) {
        return content.content;
    }
    return undefined;
}

function gatherMessages(callback: (log: (message?: string) => void) => void) {
    const messages: (string | undefined)[] = [];
    callback((message?: string) => {
        messages.push(message);
    });

    return messages.join("\n");
}

type LogFn = (log: (message?: string) => void) => void;
export function getMessage(
    input: MessageContent | LogFn,
    kind?: DisplayMessageKind,
): DisplayContent {
    const content = typeof input === "function" ? gatherMessages(input) : input;
    return kind ? { type: "text", content, kind } : content;
}

function displayMessage(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
    kind?: DisplayMessageKind,
    appendMode: DisplayAppendMode = "block",
) {
    context.actionIO.appendDisplay(getMessage(message, kind), appendMode);
}

export async function displayInfo(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "info");
}

export async function displayStatus(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "status", "temporary");
}

export async function displayWarn(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "warning");
}

export async function displayError(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "error");
}

export async function displaySuccess(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "success");
}

/*
 * Displays a message without any adornment.
 */
export async function displayResult(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context);
}

// ---------------------------------------------------------------------------
// Structured content — builders + fallback derivation.
// See docs/plans/structured-output/PLAN.md.
// ---------------------------------------------------------------------------

// Options shared by the table builders.
export interface TableBuildOptions {
    caption?: string;
    sortable?: boolean;
    filterable?: boolean;
    readonly?: boolean;
    pageSize?: number;
}

// A column definition for `fromRecords` — a `TableColumn` plus a `value`
// accessor that maps a record to its cell for this column.
export interface ColumnSpec<T> extends TableColumn {
    value: (record: T) => TableCell;
}

/**
 * Build a `TableBlock` from explicit columns and rows.
 */
export function createTable(
    columns: TableColumn[],
    rows: TableCell[][],
    options?: TableBuildOptions,
): TableBlock {
    return {
        kind: "table",
        columns,
        rows,
        ...options,
    };
}

/**
 * Build a single-table `StructuredContent` from an array of domain records
 * and a column spec, stashing the records as `rawData` in the same call so the
 * rendered table and the machine-readable payload can't drift apart.
 */
export function fromRecords<T>(
    objects: T[],
    columnSpec: ColumnSpec<T>[],
    options?: TableBuildOptions & {
        rawData?: unknown; // override the default rawData (the objects)
        dataSchema?: unknown;
        kind?: DisplayMessageKind | undefined;
        speak?: boolean | undefined;
    },
): StructuredContent {
    const columns: TableColumn[] = columnSpec.map(
        ({ value, ...column }) => column,
    );
    const rows: TableCell[][] = objects.map((object) =>
        columnSpec.map((column) => column.value(object)),
    );
    const { rawData, dataSchema, kind, speak, ...tableOptions } =
        options ?? {};
    const table = createTable(columns, rows, tableOptions);
    return createStructuredContent([table], {
        rawData: rawData ?? objects,
        dataSchema,
        kind,
        speak,
    });
}

/**
 * Assemble a `StructuredContent` from blocks, auto-deriving markdown + text
 * `alternates` so clients that don't understand `type: "structured"` degrade
 * gracefully via `getContentForType`.
 */
export function createStructuredContent(
    blocks: StructuredBlock[],
    options?: {
        rawData?: unknown;
        dataSchema?: unknown;
        kind?: DisplayMessageKind | undefined;
        speak?: boolean | undefined;
    },
): StructuredContent {
    const content: StructuredContent = {
        type: "structured",
        blocks,
        alternates: [
            { type: "markdown", content: structuredToMarkdown(blocks) },
            { type: "text", content: structuredToText(blocks) },
        ],
    };
    if (options?.rawData !== undefined) {
        content.rawData = options.rawData;
    }
    if (options?.dataSchema !== undefined) {
        content.dataSchema = options.dataSchema;
    }
    if (options?.kind !== undefined) {
        content.kind = options.kind;
    }
    if (options?.speak !== undefined) {
        content.speak = options.speak;
    }
    return content;
}

// Flatten a MessageContent (string | string[] | string[][]) to a single
// string for derivation purposes.
function messageContentToString(content: MessageContent): string {
    if (typeof content === "string") {
        return content;
    }
    return content
        .map((row) => (Array.isArray(row) ? row.join(" | ") : row))
        .join("\n");
}

// The display text of a cell, ignoring link/badge decoration.
function cellText(cell: TableCell): string {
    if (cell === null || cell === undefined) {
        return "";
    }
    if (typeof cell === "object") {
        return cell.text;
    }
    return String(cell);
}

// The markdown rendering of a cell, honoring an optional link target.
function cellMarkdown(cell: TableCell): string {
    const text = cellText(cell);
    if (typeof cell === "object" && cell.href) {
        return `[${text}](${cell.href})`;
    }
    return text;
}

/**
 * Derive a markdown representation of a block document. Used to build the
 * `alternates` a rich client falls back to, and for history/TTS text.
 */
export function structuredToMarkdown(blocks: StructuredBlock[]): string {
    const sections: string[] = [];
    for (const block of blocks) {
        switch (block.kind) {
            case "heading":
                sections.push(
                    `${"#".repeat(block.level ?? 1)} ${block.text}`,
                );
                break;
            case "text":
                sections.push(messageContentToString(block.text));
                break;
            case "table": {
                const header = `| ${block.columns
                    .map((c) => c.header)
                    .join(" | ")} |`;
                const separator = `| ${block.columns
                    .map(() => "---")
                    .join(" | ")} |`;
                const rows = block.rows.map(
                    (row) => `| ${row.map(cellMarkdown).join(" | ")} |`,
                );
                const lines = [header, separator, ...rows];
                if (block.caption) {
                    lines.unshift(`**${block.caption}**`);
                }
                sections.push(lines.join("\n"));
                break;
            }
            case "list": {
                const items = block.items.map((item, index) => {
                    const marker = block.ordered ? `${index + 1}.` : "-";
                    const label = item.href
                        ? `[${item.text}](${item.href})`
                        : item.text;
                    const subtitle = item.subtitle ? ` — ${item.subtitle}` : "";
                    return `${marker} ${label}${subtitle}`;
                });
                sections.push(items.join("\n"));
                break;
            }
            case "keyValue":
                sections.push(
                    block.pairs
                        .map(
                            (pair) =>
                                `- **${pair.label}:** ${cellMarkdown(pair.value)}`,
                        )
                        .join("\n"),
                );
                break;
            case "card": {
                const lines: string[] = [];
                if (block.title) {
                    lines.push(
                        block.href
                            ? `### [${block.title}](${block.href})`
                            : `### ${block.title}`,
                    );
                }
                if (block.subtitle) {
                    lines.push(`*${block.subtitle}*`);
                }
                if (block.fields) {
                    lines.push(
                        ...block.fields.map(
                            (pair) =>
                                `- **${pair.label}:** ${cellMarkdown(pair.value)}`,
                        ),
                    );
                }
                sections.push(lines.join("\n"));
                break;
            }
            case "image": {
                let image = `![${block.alt ?? ""}](${block.src})`;
                if (block.caption) {
                    image += `\n\n*${block.caption}*`;
                }
                sections.push(image);
                break;
            }
            case "code":
                sections.push(
                    `\`\`\`${block.language ?? ""}\n${block.code}\n\`\`\``,
                );
                break;
            case "divider":
                sections.push("---");
                break;
        }
    }
    return sections.join("\n\n");
}

/**
 * Derive a plain-text representation of a block document, for clients (CLI,
 * MCP, copilot) that render text only.
 */
export function structuredToText(blocks: StructuredBlock[]): string {
    const sections: string[] = [];
    for (const block of blocks) {
        switch (block.kind) {
            case "heading":
                sections.push(block.text);
                break;
            case "text":
                sections.push(messageContentToString(block.text));
                break;
            case "table":
                sections.push(tableToText(block));
                break;
            case "list": {
                const items = block.items.map((item, index) => {
                    const marker = block.ordered ? `${index + 1}.` : "-";
                    const subtitle = item.subtitle ? ` — ${item.subtitle}` : "";
                    return `${marker} ${item.text}${subtitle}`;
                });
                sections.push(items.join("\n"));
                break;
            }
            case "keyValue":
                sections.push(
                    block.pairs
                        .map((pair) => `${pair.label}: ${cellText(pair.value)}`)
                        .join("\n"),
                );
                break;
            case "card": {
                const lines: string[] = [];
                if (block.title) {
                    lines.push(block.title);
                }
                if (block.subtitle) {
                    lines.push(block.subtitle);
                }
                if (block.fields) {
                    lines.push(
                        ...block.fields.map(
                            (pair) => `${pair.label}: ${cellText(pair.value)}`,
                        ),
                    );
                }
                sections.push(lines.join("\n"));
                break;
            }
            case "image":
                sections.push(
                    `[image: ${block.alt ?? block.caption ?? block.src}]`,
                );
                break;
            case "code":
                sections.push(block.code);
                break;
            case "divider":
                sections.push("----");
                break;
        }
    }
    return sections.join("\n\n");
}

// Render a table block as a monospace-friendly aligned text table.
function tableToText(block: TableBlock): string {
    const headers = block.columns.map((c) => c.header);
    const rows = block.rows.map((row) => row.map(cellText));
    const widths = headers.map((header, index) =>
        Math.max(
            header.length,
            ...rows.map((row) => (row[index] ?? "").length),
        ),
    );
    const pad = (cells: string[]) =>
        cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
    const lines = [pad(headers), widths.map((w) => "-".repeat(w)).join("  ")];
    for (const row of rows) {
        lines.push(pad(headers.map((_, index) => row[index] ?? "")));
    }
    if (block.caption) {
        lines.unshift(block.caption);
    }
    return lines.join("\n");
}

/**
 * Given a `StructuredContent`, return a fallback representation for a preferred
 * display type. Prefers an existing alternate; otherwise derives on demand.
 */
export function getStructuredFallback(
    content: StructuredContent,
    preferredType: "markdown" | "text" = "markdown",
): MessageContent {
    if (content.alternates) {
        for (const alt of content.alternates) {
            if (alt.type === preferredType) {
                return alt.content;
            }
        }
    }
    return preferredType === "text"
        ? structuredToText(content.blocks)
        : structuredToMarkdown(content.blocks);
}

/**
 * Type guard: is a DisplayContent a StructuredContent block document?
 */
export function isStructuredContent(
    content: DisplayContent,
): content is StructuredContent {
    return (
        typeof content === "object" &&
        content !== null &&
        !Array.isArray(content) &&
        (content as StructuredContent).type === "structured"
    );
}
