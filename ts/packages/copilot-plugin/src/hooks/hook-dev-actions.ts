// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Dispatcher } from "@typeagent/agent-server-client";
import type {
    CommandResult,
    ProcessCommandOptions,
} from "@typeagent/dispatcher-types";
import { parseRecordingDirective } from "@typeagent/dispatcher-types";
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

export type DevActionDependencies = {
    connectToTypeAgent: typeof connectToTypeAgent;
    emitProgress: typeof emitProgress;
};

const defaultDependencies: DevActionDependencies = {
    connectToTypeAgent,
    emitProgress,
};

export function getDevActionCommandOptions(
    prompt: string,
): ProcessCommandOptions {
    if (parseRecordingDirective(prompt) !== undefined) {
        return {
            noReasoning: false,
            reasoningProfile: "powershellFlowRecording",
        };
    }
    return {
        activeSchemaFamilies: ["powershell"],
        noReasoning: true,
    };
}

function toHandledOutput(
    result: CommandResult,
    messages: string[],
): HookOutput {
    const responseContent =
        messages.join("\n\n") ||
        result.lastError ||
        (result.cancelled
            ? "TypeAgent request was cancelled."
            : "TypeAgent completed the request.");
    return {
        handled: true,
        responseContent,
        handledBy: "typeagent",
    };
}

export async function handleDevActions(
    input: HookInput,
    dependencies: DevActionDependencies = defaultDependencies,
): Promise<HookOutput> {
    dependencies.emitProgress("Checking TypeAgent development actions...", {
        temporary: true,
    });

    const responseCollector = { messages: [] as string[] };
    const clientIO = createClientIO({
        onSetDisplay: (message) => {
            collectMessage(message, undefined, responseCollector);
        },
        onAppendDisplay: (message, mode) => {
            if (mode === "temporary") {
                const text = extractMessageText(message)?.trim();
                if (text) {
                    dependencies.emitProgress(text, { temporary: true });
                }
                return;
            }

            const msg = message?.message;
            if (typeof msg === "object" && msg && "kind" in msg) {
                const kind = (msg as { kind: unknown }).kind;
                const text = extractMessageText(message)?.trim();
                if (kind === "status" || kind === "info") {
                    if (text) {
                        dependencies.emitProgress(text, {
                            temporary: kind === "status",
                        });
                    }
                    return;
                }
                if (kind === "warning" || kind === "error") {
                    if (text) {
                        dependencies.emitProgress(text);
                    }
                }
            }

            collectMessage(message, mode, responseCollector);
        },
    });

    let dispatcher: Dispatcher | null = null;
    let submitted = false;
    try {
        dispatcher = await dependencies.connectToTypeAgent(clientIO);
        const submitResult = await dispatcher.submitCommand(
            input.prompt,
            undefined,
            getDevActionCommandOptions(input.prompt),
        );
        if (!submitResult.ok) {
            return {};
        }

        submitted = true;
        const result = await submitResult.entry.completion;
        if (!result) {
            return {
                handled: true,
                responseContent:
                    "TypeAgent accepted the development action but did not return a completion result. Check agent-server before retrying.",
                handledBy: "typeagent",
            };
        }
        if (result.cancelled) {
            return toHandledOutput(result, responseCollector.messages);
        }
        if (!result.disposition) {
            return {
                handled: true,
                responseContent:
                    "The connected TypeAgent server does not support Copilot dev mode. Update and restart agent-server before retrying.",
                handledBy: "typeagent",
            };
        }

        if (result.disposition.status === "notHandled") {
            return {};
        }

        return toHandledOutput(result, responseCollector.messages);
    } catch (error) {
        console.error("TypeAgent dev mode error:", error);
        if (!submitted) {
            return {};
        }
        return {
            handled: true,
            responseContent: `TypeAgent could not finish the submitted development action: ${
                error instanceof Error ? error.message : String(error)
            }`,
            handledBy: "typeagent",
        };
    } finally {
        if (dispatcher) {
            await dispatcher.close();
        }
    }
}
