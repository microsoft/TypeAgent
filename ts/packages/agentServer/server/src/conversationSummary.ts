// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createJsonTranslatorFromSchemaDef,
    type TypeChatJsonTranslatorWithSignal,
} from "@typeagent/typechat-utils";
import type { DisplayLogEntry } from "@typeagent/dispatcher-types";

// One side of a conversation turn, reduced to plain text for summarization.
export type TranscriptTurn = { role: "user" | "assistant"; text: string };

// Flatten a display-content value to plain text. Display content is a string,
// a `{ type, content }` object (text/markdown/html/...), or nested arrays of
// those. HTML is reduced to its visible text; shapes we don't recognize yield
// "" so they are simply skipped rather than dumped as `[object Object]`.
export function displayContentToPlainText(content: unknown): string {
    if (content === undefined || content === null) {
        return "";
    }
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map(displayContentToPlainText)
            .filter((s) => s.length > 0)
            .join(" ");
    }
    if (typeof content === "object") {
        const typed = content as { type?: unknown; content?: unknown };
        if (typed.content !== undefined) {
            const text = displayContentToPlainText(typed.content);
            return typed.type === "html" ? stripHtml(text) : text;
        }
    }
    return "";
}

function stripHtml(html: string): string {
    return html
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// Reduce a conversation's persisted display-log entries to ordered user and
// assistant turns. User turns are the request text; assistant turns concatenate
// a request's `append-display` content and take the latest `set-display`
// (which replaces rather than appends). Empty and non-message entries (metrics,
// notifications, feedback, ...) are ignored.
export function buildTranscriptTurns(
    entries: readonly DisplayLogEntry[],
): TranscriptTurn[] {
    const turns: TranscriptTurn[] = [];
    // The request id of the assistant turn currently being accumulated, so
    // consecutive display entries for the same request fold into one turn.
    let openAssistantRequestId: string | undefined;
    for (const entry of entries) {
        if (entry.type === "user-request") {
            const text = entry.command?.trim() ?? "";
            if (text.length > 0) {
                turns.push({ role: "user", text });
            }
            openAssistantRequestId = undefined;
            continue;
        }
        if (entry.type === "set-display" || entry.type === "append-display") {
            const text = displayContentToPlainText(
                entry.message?.message,
            ).trim();
            if (text.length === 0) {
                continue;
            }
            const requestId = entry.message?.requestId?.requestId;
            const last = turns[turns.length - 1];
            const sameTurn =
                last?.role === "assistant" &&
                requestId !== undefined &&
                requestId === openAssistantRequestId;
            if (sameTurn) {
                // append-display adds to the running text; set-display replaces
                // the superseded intermediate state.
                last.text =
                    entry.type === "append-display"
                        ? `${last.text}\n${text}`
                        : text;
            } else {
                turns.push({ role: "assistant", text });
                openAssistantRequestId = requestId;
            }
        }
    }
    return turns;
}

/** Bounds on how much transcript text is sent to the summarization model. */
export type TranscriptFormatOptions = {
    // Per-turn cap so one giant turn (e.g. a script dump) can't crowd out the
    // rest of the conversation.
    maxTurnChars?: number;
    // Overall cap; when exceeded the most recent turns are kept (a summary
    // cares most about how things ended up).
    maxTotalChars?: number;
};

const DEFAULT_MAX_TURN_CHARS = 1500;
const DEFAULT_MAX_TOTAL_CHARS = 48000;

// Render turns as a `User:`/`Assistant:` transcript, truncating over-long turns
// and, if still over budget, dropping the oldest turns.
export function formatTranscript(
    turns: readonly TranscriptTurn[],
    options?: TranscriptFormatOptions,
): string {
    const maxTurnChars = options?.maxTurnChars ?? DEFAULT_MAX_TURN_CHARS;
    const maxTotalChars = options?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
    const lines = turns.map((turn) => {
        const label = turn.role === "user" ? "User" : "Assistant";
        const text =
            turn.text.length > maxTurnChars
                ? `${turn.text.slice(0, maxTurnChars)} […]`
                : turn.text;
        return `${label}: ${text}`;
    });
    const transcript = lines.join("\n");
    if (transcript.length <= maxTotalChars) {
        return transcript;
    }
    return `[…earlier turns omitted…]\n${transcript.slice(
        transcript.length - maxTotalChars,
    )}`;
}

// The structured result the summarization model returns. A single markdown
// `summary` field keeps rendering simple while still going through TypeChat,
// which frames the schema so JSON-mode models are satisfied and validates the
// output.
export type ConversationSummaryResponse = {
    // A concise, well-organized markdown summary of the conversation: the main
    // topics discussed, what the user was trying to do, what was actually done
    // or decided, and any notable outcomes or still-pending items. Use short
    // paragraphs or bullet points. Do not invent details not in the transcript.
    summary: string;
};

const conversationSummarySchema = `export type ConversationSummaryResponse = {
    // A concise, well-organized markdown summary of the conversation: the main
    // topics discussed, what the user was trying to do, what was actually done
    // or decided, and any notable outcomes or still-pending items. Use short
    // paragraphs or bullet points. Do not invent details not in the transcript.
    summary: string;
};`;

export type ConversationSummaryTranslator =
    TypeChatJsonTranslatorWithSignal<ConversationSummaryResponse>;

// Create the TypeChat translator used to summarize a transcript. Returns
// undefined when no model provider is configured (createChatModel throws), so
// callers degrade gracefully instead of surfacing a raw error.
export function createConversationSummaryTranslator():
    ConversationSummaryTranslator | undefined {
    try {
        return createJsonTranslatorFromSchemaDef<ConversationSummaryResponse>(
            "ConversationSummaryResponse",
            conversationSummarySchema,
        );
    } catch {
        return undefined;
    }
}

// The request (user turn) handed to the translator; TypeChat prepends the
// schema instructions describing the ConversationSummaryResponse shape.
export function buildSummaryRequest(
    conversationName: string,
    transcript: string,
): string {
    return [
        `Summarize the following conversation titled "${conversationName}" between a`,
        "user and the TypeAgent AI assistant. Capture the main topics, what the user",
        "was trying to do, what was actually done or decided, and any notable outcomes",
        "or still-pending items. Be specific, but do not invent details that are not",
        "in the transcript.",
        "",
        "Transcript:",
        transcript,
    ].join("\n");
}

// Summarize a conversation's turns via the TypeChat translator. Throws when the
// model call fails so the caller can distinguish a failure from an empty result.
export async function summarizeTranscript(
    translator: ConversationSummaryTranslator,
    conversationName: string,
    turns: readonly TranscriptTurn[],
    options?: TranscriptFormatOptions,
): Promise<string> {
    const transcript = formatTranscript(turns, options);
    const request = buildSummaryRequest(conversationName, transcript);
    const result = await translator.translate(request);
    if (!result.success) {
        throw new Error(`Summarization failed: ${result.message}`);
    }
    return result.data.summary.trim();
}
