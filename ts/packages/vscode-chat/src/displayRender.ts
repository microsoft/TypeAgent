// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    DisplayContent,
    MessageContent,
    TypedDisplayContent,
} from "@typeagent/agent-sdk";

export function renderDisplayToMarkdown(content: DisplayContent): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return flattenMessageContent(content);
    return renderTyped(content);
}

function flattenMessageContent(content: MessageContent): string {
    if (typeof content === "string") return content;
    return content
        .map((row) => (Array.isArray(row) ? row.join(" ") : row))
        .join("\n");
}

function renderTyped(c: TypedDisplayContent): string {
    const inner = flattenMessageContent(c.content);
    switch (c.type) {
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
