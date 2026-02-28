// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { connectDispatcher } from "@typeagent/agent-server-client";
import type {
    ClientIO,
    IAgentMessage,
    Dispatcher,
} from "@typeagent/dispatcher-types";
import {
    DisplayAppendMode,
    getContentForType,
    type DisplayContent,
    type MessageContent,
    type TypedDisplayContent,
} from "@typeagent/agent-sdk";
import { convert } from "html-to-text";

// ── Text utilities ───────────────────────────────────────────────────────────

function stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function htmlToPlainText(html: string): string {
    return convert(html, {
        wordwrap: false,
        preserveNewlines: true,
        selectors: [
            { selector: "img", format: "skip" },
            { selector: "a", options: { ignoreHref: true } },
        ],
    });
}

/** Flatten MessageContent (string | string[] | string[][]) to a single string. */
function flattenMessageContent(content: MessageContent): string {
    if (typeof content === "string") {
        return stripAnsi(content);
    }
    if (content.length === 0) {
        return "";
    }
    if (Array.isArray(content[0])) {
        // string[][] — table rows
        return (content as string[][]).map((row) => row.join("\t")).join("\n");
    }
    return (content as string[]).map(stripAnsi).join("\n");
}

/**
 * Extract the most useful text from a DisplayContent value.
 *
 * Priority:
 *   1. "text" alternate — best for programmatic use, JSON preserved as-is
 *   2. "markdown" alternate — structured and readable
 *   3. Primary content if type is "text" or "markdown"
 *   4. Primary HTML — converted to plain text via html-to-text
 *
 * Info/status messages are filtered out (empty string returned).
 */
function extractDisplayContent(displayContent: DisplayContent): string {
    // Plain MessageContent — treat as text
    if (typeof displayContent === "string") {
        return stripAnsi(displayContent);
    }
    if (Array.isArray(displayContent)) {
        return flattenMessageContent(displayContent as MessageContent);
    }

    const typed = displayContent as TypedDisplayContent;

    // Filter out info/status messages — not useful output
    if (typed.kind === "info" || typed.kind === "status") {
        return "";
    }

    // Prefer text alternate (preserves JSON as-is, strips ANSI)
    const textAlt = getContentForType(typed, "text");
    if (textAlt !== undefined) {
        return flattenMessageContent(textAlt);
    }

    // Then markdown
    const mdAlt = getContentForType(typed, "markdown");
    if (mdAlt !== undefined) {
        return flattenMessageContent(mdAlt);
    }

    // Fall back to primary; convert HTML to plain text
    const primary = flattenMessageContent(typed.content);
    if (typed.type === "html") {
        return htmlToPlainText(primary);
    }
    return primary;
}

// ── Capturing ClientIO ───────────────────────────────────────────────────────

function createCapturingClientIO(collector: { messages: string[] }): ClientIO {
    function capture(message: IAgentMessage): void {
        const text = extractDisplayContent(message.message);
        if (text) {
            collector.messages.push(text);
        }
    }

    return {
        clear(_requestId) {},
        exit(_requestId) {},
        setDisplayInfo(_requestId, _source, _actionIndex, _action) {},
        setDisplay(message: IAgentMessage): void {
            capture(message);
        },
        appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void {
            if (mode === "block") {
                capture(message);
            }
        },
        appendDiagnosticData(_requestId, _data) {},
        setDynamicDisplay(
            _requestId,
            _source,
            _actionIndex,
            _displayId,
            _nextRefreshMs,
        ) {},
        async askYesNo(_requestId, message, _defaultValue): Promise<boolean> {
            throw new Error(`TaskFlow: user confirmation required: ${message}`);
        },
        async proposeAction(
            _requestId,
            _actionTemplates,
            _source,
        ): Promise<unknown> {
            return undefined;
        },
        async popupQuestion(
            _message,
            _choices,
            defaultId,
            _source,
        ): Promise<number> {
            return defaultId ?? 0;
        },
        notify(_notificationId, _event, _data, _source): void {},
        async openLocalView(_requestId, _port): Promise<void> {},
        async closeLocalView(_requestId, _port): Promise<void> {},
        requestChoice(
            _requestId,
            _choiceId,
            _type,
            _message,
            _choices,
            _source,
        ) {},
        takeAction(_requestId, _action, _data) {},
    };
}

// ── Singleton dispatcher connection ─────────────────────────────────────────

let _dispatcherPromise: Promise<Dispatcher> | null = null;
const _responseCollector: { messages: string[] } = { messages: [] };

function getDispatcher(): Promise<Dispatcher> {
    if (!_dispatcherPromise) {
        const url = process.env.AGENT_SERVER_URL ?? "ws://localhost:8999";
        const clientIO = createCapturingClientIO(_responseCollector);
        _dispatcherPromise = connectDispatcher(clientIO, url, {}, () => {
            _dispatcherPromise = null; // reset on disconnect — next call reconnects
        });
    }
    return _dispatcherPromise;
}

// ── callAction ───────────────────────────────────────────────────────────────

/**
 * Call a TypeAgent agent action from a compiled task flow.
 *
 * This is the ONLY primitive needed in compiled flows. All operations —
 * TypeAgent agent calls, web search, file I/O, utility tasks — are TypeAgent
 * actions accessible through this single function.
 *
 * Connects to the running TypeAgent agent server (AGENT_SERVER_URL env var,
 * default ws://localhost:8999) via WebSocket. Connection is a module-level
 * singleton reused across all calls in a flow.
 *
 * OUTPUT FORMAT
 * - Plain text and markdown are returned as-is (ANSI codes stripped).
 * - HTML responses are converted to plain text.
 * - JSON responses are returned as-is — use JSON.parse() on the result.
 *   TypeAgent actions do not currently return JSON, but future actions
 *   may support a JSON output option (e.g. { outputFormat: "json" }).
 *
 * WRITING OUTPUT-HANDLING CODE
 * During compilation Claude should test the action via execute_action to
 * observe the actual output, then write TypeScript that handles it correctly:
 *
 *   // Action observed to return JSON:
 *   const raw = await callAction("player", "searchTopStreaming", { genre, limit });
 *   const tracks = JSON.parse(raw) as Array<{ title: string; artist: string }>;
 *
 *   // Action observed to return a formatted text list:
 *   const raw = await callAction("player", "searchTopStreaming", { genre, limit });
 *   const tracks = raw.split("\n").filter(l => /^\d+\./.test(l)).map(l => l.slice(3));
 *
 * @param schemaName  Agent schema name (e.g. "player", "utility")
 * @param actionName  Action name (e.g. "createPlaylist", "webSearch")
 * @param params      Action parameters
 * @returns           Text output (may be a JSON string — caller parses)
 */
export async function callAction(
    schemaName: string,
    actionName: string,
    params: Record<string, unknown>,
): Promise<string> {
    const dispatcher = await getDispatcher();

    const paramStr =
        Object.keys(params).length > 0
            ? `--parameters '${JSON.stringify(params).replaceAll("'", "\\u0027")}'`
            : "";

    const command = `@action ${schemaName} ${actionName} ${paramStr}`.trim();

    _responseCollector.messages = [];
    const result = await dispatcher.processCommand(command);

    if (result?.lastError) {
        throw new Error(
            `callAction(${schemaName}.${actionName}): ${result.lastError}`,
        );
    }

    return _responseCollector.messages.join("\n\n");
}

// ── queryLLM ─────────────────────────────────────────────────────────────────

/**
 * Call an LLM from a compiled task flow step.
 *
 * Use for steps that require text interpretation — parsing, extraction,
 * summarisation, classification.  Defaults to Haiku for speed and cost;
 * pass a Sonnet model ID only for genuinely complex reasoning.
 *
 * @param prompt   The full prompt to send (include all context inline)
 * @param model    Claude model ID (default: claude-haiku-4-5-20251001)
 * @returns        The model's text response
 */
export async function queryLLM(
    prompt: string,
    model: string = "claude-haiku-4-5-20251001",
): Promise<string> {
    const queryInstance = query({ prompt, options: { model } });
    let responseText = "";
    for await (const message of queryInstance) {
        if (message.type === "result" && message.subtype === "success") {
            responseText = message.result || "";
            break;
        }
    }
    return responseText;
}
