// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared TypeAgent agent-server connection management.
 */

import {
    connectAgentServer,
    connectDispatcher,
    type AgentServerConnection,
    type ClientIO,
    type Dispatcher,
    type IAgentMessage,
} from "@typeagent/agent-server-client";
import { randomUUID } from "node:crypto";
import type { DisplayAppendMode } from "@typeagent/agent-sdk";
import {
    QueueFullError,
    ServerStoppingError,
    type CommandResult,
    type RequestId,
    type TemplateEditConfig,
} from "@typeagent/dispatcher-types";

export const TYPEAGENT_HOST = process.env.TYPEAGENT_HOST || "localhost";
export const TYPEAGENT_PORT = process.env.TYPEAGENT_PORT || "8999";
export const TYPEAGENT_URL = `ws://${TYPEAGENT_HOST}:${TYPEAGENT_PORT}`;

export interface DisplayCallbacks {
    onSetDisplay?: (message: IAgentMessage) => void;
    onAppendDisplay?: (message: IAgentMessage, mode: DisplayAppendMode) => void;
    onPendingPrompt?: (prompt: unknown) => void;
}

export function formatPendingNaturalLanguageInteraction(
    prompts: unknown[],
): string {
    return (
        "USER interaction required. This natural-language call cannot be continued through structured-action tools. No answer was supplied and completion is not implied.\n" +
        JSON.stringify(prompts, null, 2)
    );
}

/**
 * Create a minimal ClientIO with configurable display callbacks.
 */
export function createClientIO(callbacks: DisplayCallbacks): ClientIO {
    return {
        clear(): void {},
        exit(): void {},
        setUserRequest(): void {},
        setDisplayInfo(): void {},
        setDisplay(message: IAgentMessage): void {
            callbacks.onSetDisplay?.(message);
        },
        appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void {
            callbacks.onAppendDisplay?.(message, mode);
        },
        appendDiagnosticData(): void {},
        setDynamicDisplay(): void {},
        async proposeAction(
            _requestId: RequestId,
            _actionTemplates: TemplateEditConfig,
            _source: string,
        ): Promise<unknown> {
            callbacks.onPendingPrompt?.(_actionTemplates);
            throw new Error(
                "A user action-proposal response is required; this natural-language client cannot supply one.",
            );
        },
        notify(): void {},
        async openLocalView(): Promise<void> {},
        async closeLocalView(): Promise<void> {},
        requestChoice(...args: unknown[]): void {
            callbacks.onPendingPrompt?.({ type: "choice", arguments: args });
        },
        requestForm(...args: unknown[]): void {
            callbacks.onPendingPrompt?.({ type: "form", arguments: args });
        },
        takeAction(): void {},
        shutdown(): void {},
        async question(
            _requestId: RequestId | undefined,
            _message: string,
            choices: string[],
            defaultId?: number,
            _source?: string,
        ): Promise<number> {
            callbacks.onPendingPrompt?.({
                type: "question",
                message: _message,
                choices,
                defaultId,
            });
            throw new Error(
                "A user answer is required; this natural-language client cannot choose a default.",
            );
        },
        async askForm(_requestId: RequestId | undefined, form: unknown) {
            callbacks.onPendingPrompt?.({ type: "form", form });
            throw new Error(
                "A user form response is required; this natural-language client cannot supply one.",
            );
        },
        requestInteraction(...args: unknown[]): void {
            callbacks.onPendingPrompt?.({
                type: "interaction",
                arguments: args,
            });
        },
        interactionResolved(): void {},
        interactionCancelled(): void {},
    } as ClientIO;
}

/**
 * Connect to TypeAgent and return a dispatcher.
 */
export async function connectToTypeAgent(
    clientIO: ClientIO,
): Promise<Dispatcher> {
    return connectDispatcher(clientIO, TYPEAGENT_URL, {
        filter: true,
        clientType: "shell",
    });
}

export function connectToAgentServer(): Promise<AgentServerConnection> {
    return connectAgentServer(TYPEAGENT_URL);
}

/** Preserve the user's exact NL/directive text and cancel without replay. */
export async function submitCancellableCommand(
    dispatcher: Dispatcher,
    command: string,
    signal?: AbortSignal,
): Promise<CommandResult | undefined> {
    if (signal?.aborted) return { cancelled: true };
    const clientRequestId = `copilot-plugin-${randomUUID()}`;
    let requestId: string | undefined;
    const cancel = () => {
        try {
            if (requestId === undefined) {
                dispatcher.cancelCommandByClientId(clientRequestId);
            } else {
                void dispatcher.cancelCommand(requestId).catch(() => {});
            }
        } catch {
            // Cancellation is best-effort. A failure does not imply rollback.
        }
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
        const submitted = await dispatcher.submitCommand(
            command,
            undefined,
            undefined,
            clientRequestId,
        );
        if (!submitted.ok) {
            throw submitted.error === "queue_full"
                ? new QueueFullError(submitted.maxDepth)
                : new ServerStoppingError();
        }
        requestId = submitted.entry.requestId;
        if (signal?.aborted) cancel();
        return await submitted.entry.completion;
    } finally {
        signal?.removeEventListener("abort", cancel);
    }
}
