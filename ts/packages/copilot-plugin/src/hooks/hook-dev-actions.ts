// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Dispatcher } from "@typeagent/agent-server-client";
import { randomUUID } from "node:crypto";
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
    platform?: NodeJS.Platform;
};

const defaultDependencies: DevActionDependencies = {
    connectToTypeAgent,
    emitProgress,
    platform: process.platform,
};

const unsupportedPlatformMessage =
    "TypeAgent PowerShell recording is supported only on Windows. Run the request on a Windows host with the PowerShell agent enabled.";
const unavailablePowerShellMessage =
    "TypeAgent could not record this PowerShell flow because the PowerShell schema is unavailable. Enable the PowerShell agent and retry.";

export function getDevActionCommandOptions(
    prompt: string,
): ProcessCommandOptions {
    if (parseRecordingDirective(prompt) !== undefined) {
        return {
            activeSchemaFamilies: ["powershell"],
            noReasoning: false,
            reasoningProfile: "powershellFlowRecording",
        };
    }
    return {
        activeSchemaFamilies: ["powershell"],
        noReasoning: false,
        reasoningProfile: "powershellCapabilityFallback",
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
    abortSignal?: AbortSignal,
): Promise<HookOutput> {
    const isRecordingDirective =
        parseRecordingDirective(input.prompt) !== undefined;
    if ((dependencies.platform ?? process.platform) !== "win32") {
        return isRecordingDirective
            ? {
                  handled: true,
                  responseContent: unsupportedPlatformMessage,
                  handledBy: "typeagent",
              }
            : {};
    }

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
    let submissionStarted = false;
    let requestId: string | undefined;
    const clientRequestId = `copilot-dev-${input.sessionId}-${randomUUID()}`;
    let earlyCancellation: Promise<void> | undefined;
    const cancelAcceptedRequest = () => {
        if (!dispatcher) {
            return;
        }
        if (requestId) {
            earlyCancellation = dispatcher
                .cancelCommand(requestId)
                .then(() => undefined);
        } else {
            dispatcher.cancelCommandByClientId(clientRequestId);
            earlyCancellation = Promise.resolve();
        }
        void earlyCancellation.catch((error) => {
            console.error("TypeAgent dev mode cancellation error:", error);
        });
    };
    abortSignal?.addEventListener("abort", cancelAcceptedRequest, {
        once: true,
    });

    try {
        abortSignal?.throwIfAborted();
        dispatcher = await dependencies.connectToTypeAgent(clientIO);
        abortSignal?.throwIfAborted();
        submissionStarted = true;
        const submitResult = await dispatcher.submitCommand(
            input.prompt,
            undefined,
            getDevActionCommandOptions(input.prompt),
            clientRequestId,
        );
        if (!submitResult.ok) {
            return {};
        }

        requestId = submitResult.entry.requestId;
        if (abortSignal?.aborted) {
            await dispatcher.cancelCommand(requestId);
        }
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
            if (
                isRecordingDirective &&
                result.disposition.reason === "noActiveSchema"
            ) {
                return {
                    handled: true,
                    responseContent: unavailablePowerShellMessage,
                    handledBy: "typeagent",
                };
            }
            return {};
        }

        return toHandledOutput(result, responseCollector.messages);
    } catch (error) {
        console.error("TypeAgent dev mode error:", error);
        if (!submissionStarted) {
            return {};
        }
        if (abortSignal?.aborted) {
            return {
                handled: true,
                responseContent: "TypeAgent request was cancelled.",
                handledBy: "typeagent",
            };
        }
        return {
            handled: true,
            responseContent: `TypeAgent could not finish the submitted development action: ${
                error instanceof Error ? error.message : String(error)
            }`,
            handledBy: "typeagent",
        };
    } finally {
        abortSignal?.removeEventListener("abort", cancelAcceptedRequest);
        await earlyCancellation?.catch(() => {});
        if (dispatcher) {
            await dispatcher.close();
        }
    }
}
