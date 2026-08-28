// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ContentItem,
    DocumentOperation,
} from "./markdownOperationSchema.js";

export function applyDocumentOperations(
    content: string,
    operations: DocumentOperation[],
): string {
    return operations.reduce(
        (updatedContent, operation) =>
            applyDocumentOperation(updatedContent, operation),
        content,
    );
}

function applyDocumentOperation(
    content: string,
    operation: DocumentOperation,
): string {
    switch (operation.type) {
        case "insert": {
            const position = clampPosition(operation.position, content.length);
            return (
                content.slice(0, position) +
                contentItemsToText(operation.content) +
                content.slice(position)
            );
        }
        case "replace": {
            const [from, to] = clampRange(
                operation.from,
                operation.to,
                content.length,
            );
            return (
                content.slice(0, from) +
                contentItemsToText(operation.content) +
                content.slice(to)
            );
        }
        case "delete": {
            const [from, to] = clampRange(
                operation.from,
                operation.to,
                content.length,
            );
            return content.slice(0, from) + content.slice(to);
        }
        case "format":
            throw new Error(
                "Format operations cannot be applied to markdown text",
            );
    }
}

function contentItemsToText(items: ContentItem[]): string {
    return items.map((item) => contentItemToText(item)).join("");
}

function contentItemToText(item: ContentItem): string {
    const text = getPlainText(item);
    switch (item.type) {
        case "heading": {
            if (/^#{1,6}\s/.test(text)) {
                return ensureBlockSeparator(text);
            }
            const attrs = item.attrs as { level?: number } | undefined;
            const requestedLevel = attrs?.level;
            const level =
                requestedLevel !== undefined &&
                Number.isInteger(requestedLevel) &&
                requestedLevel >= 1 &&
                requestedLevel <= 6
                    ? requestedLevel
                    : 1;
            return `${"#".repeat(level)} ${text}\n\n`;
        }
        case "paragraph":
            return ensureBlockSeparator(text);
        case "bullet_list":
            return serializeList(item, "-");
        case "ordered_list":
            return serializeList(item, "1.");
        case "code_block":
            return `\`\`\`\n${text}\n\`\`\`\n\n`;
        case "blockquote":
            return `${text
                .split("\n")
                .map((line) => `> ${line}`)
                .join("\n")}\n\n`;
        case "horizontal_rule":
            return "---\n\n";
        case "hard_break":
            return "  \n";
        case "text":
            return applyMarks(text, item);
        default:
            return text;
    }
}

function getPlainText(item: ContentItem): string {
    if (item.text !== undefined) {
        return item.text;
    }
    return item.content ? item.content.map(getPlainText).join("") : "";
}

function ensureBlockSeparator(text: string): string {
    return text.endsWith("\n\n") ? text : `${text}\n\n`;
}

function serializeList(item: ContentItem, marker: string): string {
    const lines =
        item.content?.map(
            (child) => `${marker} ${getPlainText(child).trim()}`,
        ) ?? [];
    return `${lines.join("\n")}\n\n`;
}

function applyMarks(text: string, item: ContentItem): string {
    return (item.marks ?? []).reduce((markedText, mark) => {
        switch (mark.type) {
            case "strong":
                return `**${markedText}**`;
            case "em":
                return `*${markedText}*`;
            case "code":
                return `\`${markedText}\``;
            case "link": {
                const attrs = mark.attrs as { href?: string } | undefined;
                return attrs?.href
                    ? `[${markedText}](${attrs.href})`
                    : markedText;
            }
            default:
                return markedText;
        }
    }, text);
}

function clampPosition(position: number, contentLength: number): number {
    if (!Number.isInteger(position) || position < 0) {
        throw new Error(`Invalid document position: ${position}`);
    }
    return Math.min(position, contentLength);
}

function clampRange(
    from: number,
    to: number,
    contentLength: number,
): [number, number] {
    if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to < from
    ) {
        throw new Error(`Invalid document range: ${from}-${to}`);
    }
    return [Math.min(from, contentLength), Math.min(to, contentLength)];
}
