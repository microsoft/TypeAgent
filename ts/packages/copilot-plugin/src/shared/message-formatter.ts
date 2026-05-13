/**
 * Shared display message formatting for TypeAgent responses.
 * Filters transient status messages and formats for markdown rendering.
 */

import type { IAgentMessage } from "@typeagent/agent-server-client";
import type { DisplayAppendMode } from "@typeagent/agent-sdk";
import { convert } from "html-to-text";

/**
 * Convert plain newlines to markdown line breaks so renderers preserve formatting.
 */
export function toMarkdownBreaks(text: string): string {
    return text.replace(/\n/g, "  \n");
}

/**
 * Extract text content from a DisplayContent message, converting HTML to
 * plain text when needed. Shared by both direct hook and MCP server paths.
 */
function extractText(msg: unknown): string | undefined {
    let text: string | undefined;
    let isHtml = false;

    if (typeof msg === "string") {
        text = msg;
    } else if (typeof msg === "object" && msg && "content" in msg) {
        text = String((msg as { content: unknown }).content);
        if ("type" in msg && (msg as { type: unknown }).type === "html") {
            isHtml = true;
        }
    }

    if (text === undefined) return undefined;

    // Auto-detect HTML if not explicitly typed
    if (!isHtml && /<[a-z][\s\S]*>/i.test(text)) {
        isHtml = true;
    }

    return isHtml ? htmlToPlainText(text) : text;
}

/**
 * Collects displayable text from an IAgentMessage, filtering out
 * transient status/info messages that are only useful for live streaming.
 * Converts HTML content to plain text.
 *
 * Append-mode semantics (from @typeagent/agent-sdk):
 *   - "inline":    concatenated to the previous "inline" message (streamed tokens)
 *   - "block":     separate block (paragraph break before/after)
 *   - "temporary": transient — skipped here
 *   - undefined:   treated as a new block (setDisplay)
 */
export function collectMessage(
    message: IAgentMessage,
    mode: DisplayAppendMode | undefined,
    collector: { messages: string[] },
): void {
    if (typeof message !== "object" || !("message" in message)) return;

    // Skip temporary messages (status updates that get replaced in live UI)
    if (mode === "temporary") return;

    const msg = message.message;

    // Skip info and status kind messages (progress indicators)
    if (typeof msg === "object" && msg && "kind" in msg) {
        if (msg.kind === "info" || msg.kind === "status") return;
    }

    const text = extractText(msg);
    if (!text) return;

    const formatted = toMarkdownBreaks(text);

    // Inline tokens belong to the previous block — concatenate without
    // adding a paragraph break, so streamed token-by-token responses
    // render as a single fluid block instead of one word per paragraph.
    if (mode === "inline" && collector.messages.length > 0) {
        collector.messages[collector.messages.length - 1] += formatted;
        return;
    }

    collector.messages.push(formatted);
}

/**
 * Extracts raw text from an IAgentMessage without filtering.
 * Converts HTML content to plain text using html-to-text.
 * Used by the MCP server where all messages are relevant.
 */
export function extractMessageText(message: IAgentMessage): string | undefined {
    if (typeof message !== "object" || !("message" in message))
        return undefined;
    return extractText(message.message);
}

/**
 * Convert HTML to plain text using html-to-text, matching the
 * pattern used by the TypeAgent commandExecutor MCP server.
 */
function htmlToPlainText(html: string): string {
    const text = convert(html, {
        wordwrap: false,
        preserveNewlines: true,
        selectors: [
            { selector: "img", format: "skip" },
            { selector: "a", options: { ignoreHref: true } },
        ],
    });
    // Collapse runs of 3+ newlines (from empty divs/spans) to a single blank line
    return text.replace(/\n{3,}/g, "\n\n").trim();
}
