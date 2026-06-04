// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Scenario A: Direct handling hook.
 * Connects to TypeAgent, processes the command, and returns the response
 * directly — skipping the Copilot LLM entirely.
 */

import type { Dispatcher } from "@typeagent/agent-server-client";
import { awaitCommand } from "@typeagent/dispatcher-types";
import {
    collectMessage,
    extractMessageText,
} from "../shared/message-formatter.js";
import {
    createClientIO,
    connectToTypeAgent,
} from "../shared/typeagent-client.js";
import { emitProgress } from "../shared/hook-progress.js";
import type { HookInput, HookOutput } from "./types.js";

export async function handleDirect(input: HookInput): Promise<HookOutput> {
    emitProgress("Routing to TypeAgent...", { temporary: true });

    const responseCollector = { messages: [] as string[] };
    const clientIO = createClientIO({
        onSetDisplay: (message) => {
            collectMessage(message, undefined, responseCollector);
        },
        onAppendDisplay: (message, mode) => {
            // Emit progress for temporary messages (status updates).
            // Mark them temporary so each replaces the previous status line
            // instead of accumulating in the timeline.
            if (mode === "temporary") {
                const text = message?.message;
                if (typeof text === "string" && text.trim()) {
                    emitProgress(text.trim(), { temporary: true });
                }
                return;
            }

            // Route reasoning display by message kind. These are all progress —
            // never part of the final response — so we return before collecting.
            const msg = message?.message;
            if (typeof msg === "object" && msg && "kind" in msg) {
                const kind = (msg as { kind: unknown }).kind;
                const text = extractMessageText(message)?.trim();
                // "status" (e.g. reasoning "thinking") is transient — each
                // replaces the previous status line.
                if (kind === "status") {
                    if (text) {
                        emitProgress(text, { temporary: true });
                    }
                    return;
                }
                // "info"/"warning"/"error" are persistent: tool calls and their
                // results (including error results) accumulate, so every call is
                // shown together with its result rather than an orphaned result.
                if (kind === "info" || kind === "warning" || kind === "error") {
                    if (text) {
                        emitProgress(text);
                    }
                    return;
                }
            }

            collectMessage(message, mode, responseCollector);
        },
    });

    let dispatcher: Dispatcher | null = null;
    try {
        emitProgress("Connecting to TypeAgent...", { temporary: true });
        dispatcher = await connectToTypeAgent(clientIO);
        emitProgress("Processing command...", { temporary: true });
        const result = await awaitCommand(dispatcher, input.prompt);

        if (result?.cancelled) {
            return {};
        }

        const hasRecognizedAction = result?.actions?.some(
            (action) => action.actionName !== "unknown",
        );

        if (!hasRecognizedAction) {
            return {};
        }

        const responseContent =
            responseCollector.messages.length > 0
                ? responseCollector.messages.join("\n\n")
                : result?.lastError
                  ? `TypeAgent recognized the action but encountered an error: ${result.lastError}`
                  : "Request processed successfully.";

        return {
            handled: true,
            responseContent,
            handledBy: "typeagent",
        };
    } catch (error) {
        console.error("TypeAgent error:", error);
        return {};
    } finally {
        if (dispatcher) {
            await dispatcher.close();
        }
    }
}
