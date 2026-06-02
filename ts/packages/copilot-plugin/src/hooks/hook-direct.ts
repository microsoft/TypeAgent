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
    emitProgress("Routing to TypeAgent...");

    const responseCollector = { messages: [] as string[] };
    const clientIO = createClientIO({
        onSetDisplay: (message) => {
            collectMessage(message, undefined, responseCollector);
        },
        onAppendDisplay: (message, mode) => {
            // Emit progress for temporary messages (status updates)
            if (mode === "temporary") {
                const text = message?.message;
                if (typeof text === "string" && text.trim()) {
                    emitProgress(text.trim());
                }
                return;
            }

            // Emit progress for info/status messages (tool calls, results during reasoning)
            // These are skipped by collectMessage but contain useful progress info
            const msg = message?.message;
            if (typeof msg === "object" && msg && "kind" in msg) {
                const kind = (msg as { kind: unknown }).kind;
                if (kind === "info" || kind === "status") {
                    const text = extractMessageText(message);
                    if (text?.trim()) {
                        emitProgress(text.trim());
                    }
                }
            }

            collectMessage(message, mode, responseCollector);
        },
    });

    let dispatcher: Dispatcher | null = null;
    try {
        emitProgress("Connecting to TypeAgent...");
        dispatcher = await connectToTypeAgent(clientIO);
        emitProgress("Processing command...");
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
