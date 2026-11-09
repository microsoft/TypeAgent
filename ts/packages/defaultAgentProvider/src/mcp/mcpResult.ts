// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CallToolResult } from "@modelcontextprotocol/client";
import { ActionResult } from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromError,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";

// A single MCP content block. The v2 `CallToolResult` types these precisely,
// but we access fields defensively so an unrecognized/new block type degrades
// to a JSON display instead of a thrown error.
type ContentItem = {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
    name?: string;
    resource?: {
        uri?: string;
        text?: string;
        blob?: string;
        mimeType?: string;
    };
    [key: string]: unknown;
};

// Render one non-text content block as markdown. Binary payloads (image/audio)
// are embedded as data URIs so hosts that render markdown can display them; the
// rest fall back to links or a fenced JSON dump.
function contentItemToMarkdown(item: ContentItem): string {
    switch (item.type) {
        case "image":
            return item.data !== undefined
                ? `![image](data:${item.mimeType ?? "image/png"};base64,${item.data})`
                : "*(image)*";
        case "audio":
            return item.data !== undefined
                ? `[audio](data:${item.mimeType ?? "audio/wav"};base64,${item.data})`
                : "*(audio)*";
        case "resource_link":
            return `[${item.name ?? item.uri ?? "resource"}](${item.uri ?? ""})`;
        case "resource": {
            const resource = item.resource;
            if (resource?.text !== undefined) {
                return resource.text;
            }
            if (resource?.uri !== undefined) {
                return `[${resource.uri}](${resource.uri})`;
            }
            return "```json\n" + JSON.stringify(item, undefined, 2) + "\n```";
        }
        default:
            return "```json\n" + JSON.stringify(item, undefined, 2) + "\n```";
    }
}

// Convert an MCP `CallToolResult` into a TypeAgent `ActionResult`.
//
// This corrects two shortcomings of the original text-only handling:
//  - `isError: true` results are surfaced as action errors (previously they
//    were silently turned into successful text output).
//  - Non-text content (image/audio/embedded resource/resource link) and the
//    machine-readable `structuredContent` are preserved instead of throwing on
//    the first non-text block.
export function convertToolResult(
    actionName: string,
    result: CallToolResult,
): ActionResult {
    const content = (result.content ?? []) as ContentItem[];

    const textParts: string[] = [];
    const otherParts: string[] = [];
    for (const item of content) {
        if (item.type === "text") {
            textParts.push(item.text ?? "");
        } else {
            otherParts.push(contentItemToMarkdown(item));
        }
    }
    const text = textParts.join("\n");

    if (result.isError) {
        // Prefer the server-provided error text; fall back to a generic message
        // so the failure is never reported as an empty success.
        const message =
            text.length > 0
                ? text
                : `MCP tool '${actionName}' returned an error.`;
        return createActionResultFromError(message);
    }

    const structuredContent = result.structuredContent;
    const hasStructured =
        structuredContent !== undefined && structuredContent !== null;

    // Fast path: plain text with nothing else to preserve.
    if (otherParts.length === 0 && !hasStructured) {
        return createActionResult(text);
    }

    const displayParts: string[] = [];
    if (text.length > 0) {
        displayParts.push(text);
    }
    displayParts.push(...otherParts);
    if (hasStructured) {
        displayParts.push(
            "```json\n" +
                JSON.stringify(structuredContent, undefined, 2) +
                "\n```",
        );
    }

    // History (memory/TTS) keeps the human-readable text when present, else the
    // serialized structured payload, so downstream consumers retain fidelity.
    const historyText =
        text.length > 0
            ? text
            : hasStructured
              ? JSON.stringify(structuredContent)
              : otherParts.join("\n");

    return createActionResultFromMarkdownDisplay(
        displayParts.join("\n\n"),
        historyText,
    );
}
