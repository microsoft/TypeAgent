// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Scenario A: Direct handling hook.
 * Connects to TypeAgent, processes the command, and returns the response
 * directly — skipping the Copilot LLM entirely.
 */

import type { Dispatcher } from "@typeagent/agent-server-client";
import { awaitCommand, type CommandResult } from "@typeagent/dispatcher-types";
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

export interface DirectHandlingOptions {
    forceHandled?: boolean;
}

export interface DirectDependencies {
    connectToTypeAgent: typeof connectToTypeAgent;
    emitProgress: typeof emitProgress;
}

const defaultDependencies: DirectDependencies = {
    connectToTypeAgent,
    emitProgress,
};

function toForcedCommandOutput(
    result: CommandResult | undefined,
    messages: string[],
): HookOutput {
    let responseContent: string;

    if (result === undefined) {
        responseContent =
            "TypeAgent accepted the command but did not return a completion result. Check agent-server before retrying.";
    } else if (result.cancelled) {
        responseContent = "TypeAgent request was cancelled.";
    } else if (result.lastError) {
        responseContent = result.lastError;
    } else {
        const collected = messages.join("\n\n");
        if (collected.trim().length > 0) {
            responseContent = collected;
        } else if (result.disposition?.status === "notHandled") {
            responseContent = "TypeAgent did not handle the command.";
        } else if (result.disposition?.status === "failed") {
            responseContent = "TypeAgent could not complete the command.";
        } else {
            responseContent = "TypeAgent completed the command.";
        }
    }

    return {
        handled: true,
        responseContent,
        handledBy: "typeagent",
    };
}

export async function handleDirect(
    input: HookInput,
    options: DirectHandlingOptions = {},
    dependencies: DirectDependencies = defaultDependencies,
): Promise<HookOutput> {
    dependencies.emitProgress("Routing to TypeAgent...", { temporary: true });

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
                    dependencies.emitProgress(text.trim(), {
                        temporary: true,
                    });
                }
                return;
            }

            // Route reasoning display by message kind. Status and info remain
            // progress-only. Forced commands keep warnings and errors for the
            // final response instead of duplicating them as persistent progress.
            const msg = message?.message;
            if (typeof msg === "object" && msg && "kind" in msg) {
                const kind = (msg as { kind: unknown }).kind;
                const text = extractMessageText(message)?.trim();
                // "status" (e.g. reasoning "thinking") is transient — each
                // replaces the previous status line.
                if (kind === "status") {
                    if (text) {
                        dependencies.emitProgress(text, { temporary: true });
                    }
                    return;
                }
                if (kind === "info") {
                    if (text) {
                        dependencies.emitProgress(text);
                    }
                    return;
                }
                if (kind === "warning" || kind === "error") {
                    if (!options.forceHandled) {
                        if (text) {
                            dependencies.emitProgress(text);
                        }
                        return;
                    }
                }
            }

            collectMessage(message, mode, responseCollector);
        },
    });

    let dispatcher: Dispatcher | null = null;
    try {
        dependencies.emitProgress("Connecting to TypeAgent...", {
            temporary: true,
        });
        dispatcher = await dependencies.connectToTypeAgent(clientIO);
        dependencies.emitProgress("Processing command...", {
            temporary: true,
        });
        const result = await awaitCommand(dispatcher, input.prompt);

        if (options.forceHandled) {
            return toForcedCommandOutput(result, responseCollector.messages);
        }

        if (result?.cancelled) {
            return {};
        }

        const hasRecognizedAction = result?.actions?.some(
            (action) => action.actionName !== "unknown",
        );

        if (!hasRecognizedAction) {
            return {};
        }

        // Check for failure indicators:
        // 1. Action failed (result.lastError is set)
        // 2. No messages were collected, indicating the action couldn't execute
        if (result?.lastError || responseCollector.messages.length === 0) {
            return {};
        }

        const responseContent = responseCollector.messages.join("\n\n");

        return {
            handled: true,
            responseContent,
            handledBy: "typeagent",
        };
    } catch (error) {
        console.error("TypeAgent error:", error);
        if (options.forceHandled) {
            return {
                handled: true,
                responseContent: `TypeAgent could not execute the command: ${
                    error instanceof Error ? error.message : String(error)
                }`,
                handledBy: "typeagent",
            };
        }
        return {};
    } finally {
        if (dispatcher) {
            await dispatcher.close();
        }
    }
}
