/**
 * Shared TypeAgent agent-server connection management.
 */

import {
    connectDispatcher,
    type ClientIO,
    type Dispatcher,
    type IAgentMessage,
} from "@typeagent/agent-server-client";
import type { DisplayAppendMode } from "@typeagent/agent-sdk";
import type {
    RequestId,
    TemplateEditConfig,
} from "@typeagent/dispatcher-types";

export const TYPEAGENT_HOST = process.env.TYPEAGENT_HOST || "localhost";
export const TYPEAGENT_PORT = process.env.TYPEAGENT_PORT || "8999";
export const TYPEAGENT_URL = `ws://${TYPEAGENT_HOST}:${TYPEAGENT_PORT}`;

export interface DisplayCallbacks {
    onSetDisplay?: (message: IAgentMessage) => void;
    onAppendDisplay?: (message: IAgentMessage, mode: DisplayAppendMode) => void;
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
        async askYesNo(
            _requestId: RequestId,
            _message: string,
            defaultValue?: boolean,
        ): Promise<boolean> {
            return defaultValue ?? true;
        },
        async proposeAction(
            _requestId: RequestId,
            _actionTemplates: TemplateEditConfig,
            _source: string,
        ): Promise<unknown> {
            return undefined;
        },
        async popupQuestion(
            _message: string,
            _choices: string[],
            defaultId: number | undefined,
            _source: string,
        ): Promise<number> {
            return defaultId ?? 0;
        },
        notify(): void {},
        async openLocalView(): Promise<void> {},
        async closeLocalView(): Promise<void> {},
        requestChoice(): void {},
        takeAction(): void {},
        shutdown(): void {},
        async question(): Promise<number> {
            return 0;
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
