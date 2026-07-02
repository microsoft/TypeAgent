// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getFileName, readAllText } from "typeagent";
import * as kp from "knowpro";
import fs from "node:fs";
import path from "node:path";
import {
    ConversationMemory,
    ConversationMemorySettings,
    ConversationMessage,
    ConversationMessageMeta,
} from "./conversationMemory.js";

/**
 * Identifies the source application that produced a chat session transcript.
 */
export type ChatSessionApp = "claude-code" | "github-copilot";

/**
 * Stable participant name used for the human side of a chat session.
 */
const USER_PARTICIPANT = "user";

/**
 * Stable participant names used for the assistant side of a chat session.
 * The specific model/version is preserved as a per-message tag.
 */
const ASSISTANT_NAME: Record<ChatSessionApp, string> = {
    "claude-code": "Claude",
    "github-copilot": "GitHub Copilot",
};

/**
 * Options controlling how much of a session transcript is captured as message
 * text. By default only the human-authored prompts and assistant responses are
 * kept; reasoning and tool-call details are excluded to keep the index focused.
 */
export type SessionContentOptions = {
    /**
     * Include assistant reasoning ("thinking" / "reasoningText") as part of the
     * assistant message text. Default false.
     */
    includeReasoning?: boolean | undefined;
    /**
     * Include tool call details (tool name + arguments) as part of the assistant
     * message text. Tool *names* are always preserved as `tool:<name>` tags
     * regardless of this flag. Default false.
     */
    includeToolCalls?: boolean | undefined;
};

/**
 * Options for importing a session transcript into a {@link ConversationMemory}.
 */
export type SessionImportOptions = SessionContentOptions & {
    /**
     * Name for the resulting memory. Defaults to the transcript file name
     * (single import) or the directory name (batch import).
     */
    name?: string | undefined;
    /**
     * Memory settings. Defaults are created if not provided.
     */
    settings?: ConversationMemorySettings | undefined;
    /**
     * When true (default), extract knowledge and build the search index.
     * When false, returns an unindexed memory containing all messages.
     */
    buildIndex?: boolean | undefined;
    /**
     * For directory imports, recurse into subdirectories collecting every
     * `*.jsonl` transcript in the tree. Default false (top-level only).
     */
    recurse?: boolean | undefined;
    /**
     * Stop after importing this many messages. Useful for sampling a large
     * corpus. When undefined (default), all messages are imported.
     */
    maxMessages?: number | undefined;
    /**
     * For directory imports, stop after processing this many transcript
     * files. Useful for sampling a large corpus. When undefined (default),
     * all files are imported.
     */
    maxFiles?: number | undefined;
    /**
     * Optional callback for progress reporting during batch imports.
     * Called for each file processed: (current, total, filePath) => void
     */
    onProgress?: ((current: number, total: number, filePath: string) => void) | undefined;
    /**
     * Optional callback for progress reporting during knowledge extraction and indexing.
     * Called for each message indexed: (current, total) => void
     */
    onIndexProgress?: ((current: number, total: number) => void) | undefined;
    /**
     * Optional callback invoked when knowledge extraction fails for an
     * individual message (e.g. the model returned malformed JSON). The import
     * continues: the message is still added to the memory without extracted
     * knowledge so it remains searchable by text. When omitted, the import
     * still continues but the failure is reported via `console.warn`.
     * Called for each failed message: (current, total, error) => void
     */
    onIndexError?:
        | ((current: number, total: number, error: string) => void)
        | undefined;
};

/**
 * The result of parsing a single session transcript.
 */
export type ParsedSession = {
    messages: ConversationMessage[];
    participants: Set<string>;
    /**
     * Session title, when the source transcript records one (Claude Code only).
     */
    title?: string | undefined;
};

/**
 * A tool invocation captured from an assistant turn.
 */
type ToolCall = {
    name: string;
    /**
     * Serialized arguments for the call, truncated to {@link MAX_TOOL_ARG_CHARS}.
     */
    args?: string | undefined;
};

/**
 * A normalized turn extracted from a chat session transcript, independent of
 * the source application's on-disk format.
 */
type ChatTurn = {
    role: "user" | "assistant";
    text: string;
    timestamp?: string | undefined;
    /**
     * The specific model or product version that produced an assistant turn
     * (e.g. "claude-opus-4-6"). Preserved as a message tag.
     */
    model?: string | undefined;
    /**
     * Assistant reasoning text for this turn, when present.
     */
    reasoning?: string | undefined;
    /**
     * Tools the assistant invoked during this turn, when present.
     */
    toolCalls?: ToolCall[] | undefined;
};

/**
 * Maximum number of characters of a tool call's arguments to retain.
 */
const MAX_TOOL_ARG_CHARS = 1000;

/**
 * Parse a single JSONL transcript into an array of JSON records.
 * Lines that are blank or fail to parse are skipped so that a single
 * malformed entry does not abort the entire import.
 */
function parseJsonlRecords(jsonlText: string): any[] {
    const records: any[] = [];
    const lines = jsonlText.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
            continue;
        }
        try {
            records.push(JSON.parse(trimmed));
        } catch {
            // Skip malformed lines.
        }
    }
    return records;
}

/**
 * Compose the message text for a turn from its parts, honoring the content
 * options. Returns undefined when the turn contributes no text and should be
 * skipped (e.g. a user turn that contained only a tool result).
 */
function composeTurnText(
    turn: ChatTurn,
    options: SessionContentOptions,
): string | undefined {
    const parts: string[] = [];
    if (options.includeReasoning && turn.reasoning) {
        parts.push(`[reasoning]\n${turn.reasoning}`);
    }
    if (turn.text) {
        parts.push(turn.text);
    }
    if (
        options.includeToolCalls &&
        turn.toolCalls &&
        turn.toolCalls.length > 0
    ) {
        parts.push(renderToolCalls(turn.toolCalls));
    }
    if (parts.length === 0) {
        // Nothing authored. If the turn made tool calls, keep a brief marker so
        // the turn is not lost entirely; otherwise skip it.
        if (turn.toolCalls && turn.toolCalls.length > 0) {
            return synthesizeToolText(turn.toolCalls.map((t) => t.name));
        }
        return undefined;
    }
    return parts.join("\n\n");
}

function renderToolCalls(toolCalls: ToolCall[]): string {
    const lines = toolCalls.map((tc) =>
        tc.args ? `- ${tc.name}: ${tc.args}` : `- ${tc.name}`,
    );
    return `[tool calls]\n${lines.join("\n")}`;
}

function synthesizeToolText(toolNames: string[]): string {
    const unique = [...new Set(toolNames)];
    return `Invoked tool${unique.length > 1 ? "s" : ""}: ${unique.join(", ")}.`;
}

function truncate(text: string, maxChars: number): string {
    return text.length <= maxChars ? text : text.slice(0, maxChars) + "\u2026";
}

/**
 * Serialize tool call arguments to a compact, length-limited string.
 */
function stringifyArgs(input: unknown): string | undefined {
    if (input === undefined || input === null) {
        return undefined;
    }
    let text: string;
    if (typeof input === "string") {
        text = input;
    } else {
        try {
            text = JSON.stringify(input);
        } catch {
            return undefined;
        }
    }
    text = text.trim();
    return text.length > 0 ? truncate(text, MAX_TOOL_ARG_CHARS) : undefined;
}

/**
 * Build a {@link ConversationMessage} for a normalized {@link ChatTurn}.
 * User turns are modeled as sent from "user" to the assistant; assistant
 * turns are modeled as sent from the assistant to "user". This yields
 * person entities and send/receive actions during knowledge extraction.
 * Returns undefined when the turn contributes no text.
 */
function turnToMessage(
    turn: ChatTurn,
    assistantName: string,
    app: ChatSessionApp,
    options: SessionContentOptions,
): ConversationMessage | undefined {
    const text = composeTurnText(turn, options);
    if (text === undefined) {
        return undefined;
    }
    const sender = turn.role === "user" ? USER_PARTICIPANT : assistantName;
    const recipients =
        turn.role === "user" ? [assistantName] : [USER_PARTICIPANT];
    const metadata = new ConversationMessageMeta(sender, recipients);

    const tags: kp.MessageTag[] = [app];
    if (turn.role === "assistant" && turn.model) {
        tags.push(turn.model);
    }
    if (turn.toolCalls) {
        for (const name of new Set(turn.toolCalls.map((t) => t.name))) {
            tags.push(`tool:${name}`);
        }
    }
    return new ConversationMessage(
        text,
        metadata,
        tags,
        undefined,
        turn.timestamp,
    );
}

function turnsToParsedSession(
    turns: ChatTurn[],
    app: ChatSessionApp,
    options: SessionContentOptions,
    title?: string | undefined,
): ParsedSession {
    const assistantName = ASSISTANT_NAME[app];
    const participants = new Set<string>([USER_PARTICIPANT, assistantName]);
    const messages: ConversationMessage[] = [];
    for (const turn of turns) {
        const message = turnToMessage(turn, assistantName, app, options);
        if (message) {
            messages.push(message);
        }
    }
    if (title) {
        applyTitleTopic(messages, title);
    }
    return { messages, participants, title };
}

/**
 * Attach a session title as a topic on the first message so that it is indexed
 * and searchable as knowledge.
 */
function applyTitleTopic(messages: ConversationMessage[], title: string): void {
    if (messages.length === 0) {
        return;
    }
    const first = messages[0];
    if (!first.knowledge) {
        first.knowledge = kp.createKnowledgeResponse();
    }
    if (!first.knowledge.topics.includes(title)) {
        first.knowledge.topics.push(title);
    }
}

//
// Claude Code session transcripts
//
// Each line is a JSON record with a "type" field. Conversational turns use
// type "user" and "assistant", each carrying a nested "message" object whose
// "content" is either a string or an array of typed content blocks.
//

function claudeContentToParts(
    content: unknown,
    role: "user" | "assistant",
): { text: string; reasoning: string; toolCalls: ToolCall[] } {
    const texts: string[] = [];
    const reasonings: string[] = [];
    const toolCalls: ToolCall[] = [];
    if (typeof content === "string") {
        if (content.trim().length > 0) {
            texts.push(content.trim());
        }
        return { text: texts.join("\n\n"), reasoning: "", toolCalls };
    }
    if (Array.isArray(content)) {
        for (const block of content) {
            if (block === null || typeof block !== "object") {
                continue;
            }
            const type = (block as any).type;
            if (type === "text" && typeof (block as any).text === "string") {
                const text = (block as any).text.trim();
                if (text.length > 0) {
                    texts.push(text);
                }
            } else if (
                type === "thinking" &&
                typeof (block as any).thinking === "string"
            ) {
                const thinking = (block as any).thinking.trim();
                if (thinking.length > 0) {
                    reasonings.push(thinking);
                }
            } else if (
                role === "assistant" &&
                type === "tool_use" &&
                typeof (block as any).name === "string"
            ) {
                toolCalls.push({
                    name: (block as any).name,
                    args: stringifyArgs((block as any).input),
                });
            }
            // "tool_result" blocks are intentionally ignored.
        }
    }
    return {
        text: texts.join("\n\n"),
        reasoning: reasonings.join("\n\n"),
        toolCalls,
    };
}

function claudeRecordToTurn(record: any): ChatTurn | undefined {
    const type = record?.type;
    if (type !== "user" && type !== "assistant") {
        return undefined;
    }
    const message = record?.message;
    if (!message || typeof message !== "object") {
        return undefined;
    }
    const { text, reasoning, toolCalls } = claudeContentToParts(
        message.content,
        type,
    );
    return {
        role: type,
        text,
        reasoning: reasoning.length > 0 ? reasoning : undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp:
            typeof record?.timestamp === "string"
                ? record.timestamp
                : undefined,
        model:
            type === "assistant" && typeof message.model === "string"
                ? message.model
                : undefined,
    };
}

/**
 * Extract the session title from Claude Code `ai-title` events. The title is
 * refined over the session; the last non-empty value is used.
 */
function extractClaudeTitle(records: any[]): string | undefined {
    let title: string | undefined;
    for (const record of records) {
        if (record?.type === "ai-title" && typeof record.aiTitle === "string") {
            const value = record.aiTitle.trim();
            if (value.length > 0) {
                title = value;
            }
        }
    }
    return title;
}

function extractClaudeTurns(records: any[]): ChatTurn[] {
    const turns: ChatTurn[] = [];
    for (const record of records) {
        const turn = claudeRecordToTurn(record);
        if (turn) {
            turns.push(turn);
        }
    }
    return turns;
}

/**
 * Parse the text of a Claude Code session transcript (JSONL).
 * @param jsonlText Raw contents of a `*.jsonl` Claude Code session file.
 * @param options Content options (reasoning / tool calls).
 */
export function parseClaudeSessionTranscript(
    jsonlText: string,
    options: SessionContentOptions = {},
): ParsedSession {
    const records = parseJsonlRecords(jsonlText);
    const turns = extractClaudeTurns(records);
    const title = extractClaudeTitle(records);
    return turnsToParsedSession(turns, "claude-code", options, title);
}

//
// GitHub Copilot Chat session transcripts
//
// Each line is a JSON record of the form { type, data, id, timestamp, parentId }.
// Conversational turns use type "user.message" and "assistant.message".
//

function copilotRecordToTurn(record: any): ChatTurn | undefined {
    const type = record?.type;
    if (type !== "user.message" && type !== "assistant.message") {
        return undefined;
    }
    const data = record?.data;
    if (!data || typeof data !== "object") {
        return undefined;
    }
    const role = type === "user.message" ? "user" : "assistant";
    const text = typeof data.content === "string" ? data.content.trim() : "";
    const reasoning =
        role === "assistant" && typeof data.reasoningText === "string"
            ? data.reasoningText.trim()
            : "";

    const toolCalls: ToolCall[] = [];
    if (role === "assistant" && Array.isArray(data.toolRequests)) {
        for (const toolRequest of data.toolRequests) {
            if (
                toolRequest &&
                typeof toolRequest === "object" &&
                typeof (toolRequest as any).name === "string"
            ) {
                toolCalls.push({
                    name: (toolRequest as any).name,
                    args: stringifyArgs((toolRequest as any).arguments),
                });
            }
        }
    }
    return {
        role,
        text,
        reasoning: reasoning.length > 0 ? reasoning : undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        timestamp:
            typeof record?.timestamp === "string"
                ? record.timestamp
                : undefined,
    };
}

function extractCopilotTurns(records: any[]): ChatTurn[] {
    const turns: ChatTurn[] = [];
    for (const record of records) {
        const turn = copilotRecordToTurn(record);
        if (turn) {
            turns.push(turn);
        }
    }
    return turns;
}

/**
 * Parse the text of a GitHub Copilot Chat session transcript (JSONL).
 * @param jsonlText Raw contents of a `*.jsonl` Copilot Chat transcript file.
 * @param options Content options (reasoning / tool calls).
 */
export function parseCopilotSessionTranscript(
    jsonlText: string,
    options: SessionContentOptions = {},
): ParsedSession {
    const records = parseJsonlRecords(jsonlText);
    const turns = extractCopilotTurns(records);
    return turnsToParsedSession(turns, "github-copilot", options);
}

//
// Importers
//

/**
 * Build a {@link ConversationMemory} from already-parsed session messages.
 * @param extraTags Additional conversation-level tags (e.g. session titles).
 */
async function buildSessionMemory(
    nameTag: string,
    app: ChatSessionApp,
    messages: ConversationMessage[],
    extraTags: string[],
    settings: ConversationMemorySettings | undefined,
    buildIndex: boolean,
    onIndexProgress?: (current: number, total: number) => void,
    onIndexError?: (current: number, total: number, error: string) => void,
): Promise<ConversationMemory> {
    const tags = [...new Set([nameTag, app, ...extraTags])];
    if (!buildIndex) {
        // Return an unindexed memory containing all messages.
        return new ConversationMemory(nameTag, messages, tags, settings);
    }
    const memory = new ConversationMemory(nameTag, [], tags, settings);
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        // Extract knowledge and index the message. A single message can fail
        // (e.g. the model returns malformed JSON for knowledge extraction).
        // Rather than aborting an entire bulk import, fall back to adding the
        // message without extracted knowledge so it stays searchable by text.
        const result = await memory.addMessage(message, true, true);
        if (!result.success) {
            if (onIndexError) {
                onIndexError(i + 1, messages.length, result.message);
            } else {
                console.warn(
                    `Skipping knowledge extraction for message ${i + 1}/${messages.length} of ${app} session "${nameTag}": ${result.message}`,
                );
            }
            const fallback = await memory.addMessage(message, false, true);
            if (!fallback.success) {
                throw new Error(
                    `Failed to index ${app} session "${nameTag}": ${fallback.message}`,
                );
            }
        }
        if (onIndexProgress) {
            onIndexProgress(i + 1, messages.length);
        }
    }
    return memory;
}

async function loadParsedSession(
    filePath: string,
    app: ChatSessionApp,
    options: SessionContentOptions,
): Promise<ParsedSession> {
    const text = await readAllText(filePath);
    return app === "claude-code"
        ? parseClaudeSessionTranscript(text, options)
        : parseCopilotSessionTranscript(text, options);
}

async function importSessionFile(
    transcriptFilePath: string,
    app: ChatSessionApp,
    options?: SessionImportOptions,
): Promise<ConversationMemory> {
    options ??= {};
    const parsed = await loadParsedSession(transcriptFilePath, app, options);
    const name = options.name ?? getFileName(transcriptFilePath);
    const extraTags = parsed.title ? [parsed.title] : [];
    const messages =
        options.maxMessages !== undefined
            ? parsed.messages.slice(0, options.maxMessages)
            : parsed.messages;
    return buildSessionMemory(
        name,
        app,
        messages,
        extraTags,
        options.settings,
        options.buildIndex ?? true,
        options.onIndexProgress,
        options.onIndexError,
    );
}

async function importSessionDir(
    dirPath: string,
    app: ChatSessionApp,
    options?: SessionImportOptions,
): Promise<ConversationMemory> {
    options ??= {};
    const files = await collectSessionFiles(dirPath, options.recurse ?? false);
    const allMessages: ConversationMessage[] = [];
    const titles: string[] = [];
    const maxMessages = options.maxMessages;
    const maxFiles = options.maxFiles;
    const fileCount =
        maxFiles !== undefined ? Math.min(maxFiles, files.length) : files.length;
    for (let i = 0; i < fileCount; i++) {
        const filePath = files[i];
        if (options.onProgress) {
            options.onProgress(i + 1, fileCount, filePath);
        }
        const parsed = await loadParsedSession(filePath, app, options);
        // Use the path relative to the root dir so transcripts with the same
        // file name in different subfolders stay distinguishable.
        const sessionId = sessionTagFromPath(dirPath, filePath);
        for (const message of parsed.messages) {
            message.tags.push(`session:${sessionId}`);
        }
        allMessages.push(...parsed.messages);
        if (parsed.title) {
            titles.push(parsed.title);
        }
        // Stop scanning more files once we have enough messages.
        if (maxMessages !== undefined && allMessages.length >= maxMessages) {
            break;
        }
    }
    // Trim any overshoot from the final file so we stop at exactly maxMessages.
    if (maxMessages !== undefined && allMessages.length > maxMessages) {
        allMessages.length = maxMessages;
    }
    const name = options.name ?? path.basename(dirPath) ?? "sessions";
    return buildSessionMemory(
        name,
        app,
        allMessages,
        titles,
        options.settings,
        options.buildIndex ?? true,
        options.onIndexProgress,
        options.onIndexError,
    );
}

/**
 * Collect every `*.jsonl` transcript in a directory, optionally recursing into
 * subdirectories. Results are sorted for deterministic ingest order.
 */
async function collectSessionFiles(
    dirPath: string,
    recurse: boolean,
): Promise<string[]> {
    const entries = await fs.promises.readdir(dirPath, {
        withFileTypes: true,
    });
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (recurse) {
                files.push(...(await collectSessionFiles(fullPath, recurse)));
            }
        } else if (entry.name.toLowerCase().endsWith(".jsonl")) {
            files.push(fullPath);
        }
    }
    return files.sort();
}

/**
 * Derive a stable session tag from a transcript path relative to the import
 * root, dropping the extension and normalizing separators to "/".
 */
function sessionTagFromPath(rootDir: string, filePath: string): string {
    const relative = path.relative(rootDir, filePath);
    const withoutExt = relative.slice(
        0,
        relative.length - path.extname(relative).length,
    );
    return withoutExt.split(path.sep).join("/");
}

/**
 * Import a Claude Code session transcript into a {@link ConversationMemory}.
 * @param transcriptFilePath Path to a Claude Code `*.jsonl` session file.
 *  These are typically found under `~/.claude/projects/<encoded-workspace>/`.
 * @param options Import options. See {@link SessionImportOptions}.
 */
export async function importClaudeSession(
    transcriptFilePath: string,
    options?: SessionImportOptions,
): Promise<ConversationMemory> {
    return importSessionFile(transcriptFilePath, "claude-code", options);
}

/**
 * Import a GitHub Copilot Chat session transcript into a {@link ConversationMemory}.
 * @param transcriptFilePath Path to a Copilot Chat `*.jsonl` transcript file.
 *  These are typically found under VS Code's
 *  `User/workspaceStorage/<id>/GitHub.copilot-chat/transcripts/`.
 * @param options Import options. See {@link SessionImportOptions}.
 */
export async function importCopilotSession(
    transcriptFilePath: string,
    options?: SessionImportOptions,
): Promise<ConversationMemory> {
    return importSessionFile(transcriptFilePath, "github-copilot", options);
}

/**
 * Import every Claude Code session transcript (`*.jsonl`) in a directory into a
 * single merged {@link ConversationMemory}. Each message is tagged with
 * `session:<file>` so individual sessions remain identifiable.
 * @param dirPath Directory containing Claude Code session files, e.g.
 *  `~/.claude/projects/<encoded-workspace>/`.
 * @param options Import options. See {@link SessionImportOptions}.
 */
export async function importClaudeSessionsFromDir(
    dirPath: string,
    options?: SessionImportOptions,
): Promise<ConversationMemory> {
    return importSessionDir(dirPath, "claude-code", options);
}

/**
 * Import every GitHub Copilot Chat session transcript (`*.jsonl`) in a directory
 * into a single merged {@link ConversationMemory}. Each message is tagged with
 * `session:<file>` so individual sessions remain identifiable.
 * @param dirPath Directory containing Copilot transcripts, e.g.
 *  `User/workspaceStorage/<id>/GitHub.copilot-chat/transcripts/`.
 * @param options Import options. See {@link SessionImportOptions}.
 */
export async function importCopilotSessionsFromDir(
    dirPath: string,
    options?: SessionImportOptions,
): Promise<ConversationMemory> {
    return importSessionDir(dirPath, "github-copilot", options);
}
