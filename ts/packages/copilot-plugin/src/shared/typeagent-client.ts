// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared TypeAgent agent-server connection management.
 */

import { randomUUID } from "node:crypto";
import {
    connectAgentServer,
    connectDispatcher,
    type AgentServerConnection,
    type ClientIO,
    type Dispatcher,
    type IAgentMessage,
} from "@typeagent/agent-server-client";
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
    /**
     * A prompt the agent needs answered before it can finish. This client
     * cannot answer it - there is no return path for `respondToChoice` - so
     * callers report it instead of implying the work completed.
     */
    onPendingPrompt?: (message: string) => void;
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
            return undefined;
        },
        notify(): void {},
        async openLocalView(): Promise<void> {},
        async closeLocalView(): Promise<void> {},
        requestChoice(
            _requestId: RequestId,
            _choiceId: string,
            _type: "yesNo" | "multiChoice" | "pickRemember",
            message: string,
            choices: string[],
        ): void {
            callbacks.onPendingPrompt?.(
                `${message} (options: ${choices.join(", ")})`,
            );
        },
        requestForm(
            _requestId: RequestId,
            _choiceId: string,
            form: { title?: string },
        ): void {
            callbacks.onPendingPrompt?.(
                form.title ?? "A form must be filled in.",
            );
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
            return defaultId ?? Math.max(choices.length - 1, 0);
        },
        requestInteraction(): void {},
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

/**
 * Submit a command and await its completion, cancelling the request if
 * `signal` aborts. Without this an interrupted MCP tool call would leave
 * TypeAgent running work nobody is waiting for.
 *
 * Same submit-time errors as `awaitCommand`: `QueueFullError` when the
 * request queue is full, `ServerStoppingError` during shutdown.
 */
export async function submitCancellableCommand(
    dispatcher: Dispatcher,
    command: string,
    signal?: AbortSignal,
    onCancelError?: (error: unknown) => void,
): Promise<CommandResult | undefined> {
    if (signal?.aborted) {
        // Never start side-effecting work for a call the client already gave
        // up on - connecting to TypeAgent takes long enough for this to happen.
        return { cancelled: true };
    }
    const clientRequestId = `copilot-plugin-${randomUUID()}`;
    let requestId: string | undefined;
    const cancel = () => {
        try {
            if (requestId !== undefined) {
                void dispatcher.cancelCommand(requestId).catch(onCancelError);
            } else {
                // Early-cancel path: the server-assigned id has not
                // round-tripped back to us yet.
                dispatcher.cancelCommandByClientId(clientRequestId);
            }
        } catch (error) {
            onCancelError?.(error);
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
        if (signal?.aborted) {
            // The abort landed before the entry had a server-side id.
            await dispatcher.cancelCommand(requestId);
        }
        return await submitted.entry.completion;
    } finally {
        signal?.removeEventListener("abort", cancel);
    }
}
