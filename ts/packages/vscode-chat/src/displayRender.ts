// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    DisplayMessageKind,
    DisplayContent,
    DisplayType,
    MessageContent,
    TypedDisplayContent,
} from "@typeagent/agent-sdk";
import { getContentForType } from "@typeagent/agent-sdk/helpers/display";
import { AnsiUp } from "ansi_up";

const ansiUpTextToHtml = new AnsiUp();
const ansiUpMarkdownToHtml = new AnsiUp();
ansiUpMarkdownToHtml.escape_html = false;

export function renderDisplayToMarkdown(content: DisplayContent): string {
    if (typeof content === "string")
        return renderMessageContent(content, "text");
    if (Array.isArray(content)) return renderMessageContent(content, "text");
    return renderTypedContent(content);
}

export function renderDisplayToText(content: DisplayContent): string {
    if (typeof content === "string") return stripAnsi(content);
    if (Array.isArray(content)) return renderMessageContentAsText(content);
    return renderTypedContentAsText(content);
}

function renderMessageContentAsText(content: MessageContent): string {
    if (typeof content === "string") return stripAnsi(content);
    if (content.length === 0) return "";
    if (typeof content[0] === "string") return stripAnsi(content.join("\n"));
    return stripAnsi(
        (content as string[][]).map((row) => row.join(" | ")).join("\n"),
    );
}

function renderTypedContentAsText(content: TypedDisplayContent): string {
    const textContent = getContentForType(content, "text");
    if (textContent !== undefined) {
        return renderMessageContentAsText(textContent);
    }

    const markdownContent = getContentForType(content, "markdown");
    if (markdownContent !== undefined) {
        return stripMarkdownHtml(renderMessageContent(markdownContent, "text"));
    }

    const htmlContent = getContentForType(content, "html");
    if (htmlContent !== undefined) {
        return htmlToText(renderMessageContent(htmlContent, "html"));
    }

    if (content.type === "html" || content.type === "iframe") {
        return htmlToText(renderMessageContent(content.content, content.type));
    }

    return stripMarkdownHtml(
        renderMessageContent(content.content, content.type),
    );
}

function renderMessageContent(
    content: MessageContent,
    type: DisplayType,
): string {
    if (typeof content === "string") return processAnsiContent(content, type);
    if (content.length === 0) return "";
    if (typeof content[0] === "string") {
        return processAnsiContent(
            content.join(type === "html" || type === "iframe" ? "<br>" : "\n"),
            type,
        );
    }

    const table = content as string[][];
    if (type === "html" || type === "iframe") {
        return tableToHtml(table);
    }
    return processAnsiContent(tableToMarkdown(table), "markdown");
}

function processAnsiContent(content: string, type: DisplayType): string {
    switch (type) {
        case "text":
            return ansiUpTextToHtml
                .ansi_to_html(content)
                .replace(/\n/gm, "<br>");
        case "markdown":
            return ansiUpMarkdownToHtml.ansi_to_html(content);
        case "html":
        case "iframe":
        default:
            return content;
    }
}

function tableToMarkdown(table: string[][]): string {
    if (table.length === 0) return "";

    const rows = table.map((row) => row.map(escapeTableCell));
    const columnCount = Math.max(...rows.map((row) => row.length));
    const normalized = rows.map((row) => [
        ...row,
        ...Array<string>(Math.max(0, columnCount - row.length)).fill(""),
    ]);

    const [header, ...body] = normalized;
    return [
        `| ${header.join(" | ")} |`,
        `| ${header.map(() => "---").join(" | ")} |`,
        ...body.map((row) => `| ${row.join(" | ")} |`),
    ].join("\n");
}

function escapeTableCell(cell: string): string {
    return cell.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function tableToHtml(table: string[][]): string {
    return `<table>${table
        .map(
            (row, rowIndex) =>
                `<tr>${row
                    .map((cell) => {
                        const tag = rowIndex === 0 ? "th" : "td";
                        return `<${tag}>${escapeHtml(cell)}</${tag}>`;
                    })
                    .join("")}</tr>`,
        )
        .join("")}</table>`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function stripMarkdownHtml(text: string): string {
    return stripAnsi(htmlToText(text))
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[*_~`#>]/g, "")
        .replace(/^\s*[-+]\s+/gm, "")
        .trim();
}

function htmlToText(html: string): string {
    return stripAnsi(
        decodeHtmlEntities(
            html
                .replace(/<\s*br\s*\/?\s*>/gi, "\n")
                .replace(/<\s*\/\s*(p|div|tr|li|h[1-6])\s*>/gi, "\n")
                .replace(/<\s*\/\s*(td|th)\s*>/gi, " | ")
                .replace(/<[^>]*>/g, "")
                .replace(/[ \t]+\n/g, "\n")
                .replace(/\n{3,}/g, "\n\n"),
        ),
    ).trim();
}

function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
}

function renderTypedContent(content: TypedDisplayContent): string {
    const markdownContent = getContentForType(content, "markdown");
    if (markdownContent !== undefined && content.type !== "markdown") {
        return applyKind(
            renderMessageContent(markdownContent, "markdown"),
            content.kind,
        );
    }

    const htmlContent = getContentForType(content, "html");
    if (htmlContent !== undefined && content.type !== "html") {
        return applyKind(
            renderMessageContent(htmlContent, "html"),
            content.kind,
        );
    }

    const textContent = getContentForType(content, "text");
    if (
        textContent !== undefined &&
        content.type !== "text" &&
        content.type !== "markdown" &&
        content.type !== "html"
    ) {
        return applyKind(
            renderMessageContent(textContent, "text"),
            content.kind,
        );
    }

    return applyKind(renderTypedPrimary(content), content.kind);
}

function renderTypedPrimary(content: TypedDisplayContent): string {
    const inner = renderMessageContent(content.content, content.type);
    switch (content.type) {
        case "markdown":
            return inner;
        case "html":
            // VS Code's chat markdown supports a restricted subset of HTML;
            // pass through and let the renderer drop unsupported tags.
            return inner;
        case "iframe":
            return `_(iframe content not rendered)_\n\n\`\`\`\n${inner}\n\`\`\``;
        case "text":
        default:
            return inner;
    }
}

function applyKind(
    markdown: string,
    kind: DisplayMessageKind | undefined,
): string {
    if (markdown.length === 0 || kind === undefined) return markdown;
    switch (kind) {
        case "error":
            return kindLabel("Error", "--vscode-errorForeground", markdown);
        case "warning":
            return kindLabel(
                "Warning",
                "--vscode-editorWarning-foreground",
                markdown,
            );
        case "success":
            return kindLabel(
                "Success",
                "--vscode-testing-iconPassed",
                markdown,
            );
        case "status":
            return kindInline(
                "--vscode-descriptionForeground",
                markdown,
                "font-style: italic;",
            );
        case "info":
        default:
            return markdown;
    }
}

function kindLabel(
    label: string,
    themeColor: string,
    markdown: string,
): string {
    return `<span style="color: var(${themeColor}); font-weight: 600;">${label}:</span>\n\n${markdown}`;
}

function kindInline(
    themeColor: string,
    markdown: string,
    extraStyle: string,
): string {
    return `<span style="color: var(${themeColor}); ${extraStyle}">${markdown}</span>`;
}
