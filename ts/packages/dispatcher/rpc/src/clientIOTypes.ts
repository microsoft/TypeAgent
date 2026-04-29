// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { DisplayAppendMode, TypeAgentAction } from "@typeagent/agent-sdk";
import type {
    IAgentMessage,
    RequestId,
    TemplateEditConfig,
    PendingInteractionRequest,
} from "@typeagent/dispatcher-types";

export type ClientIOInvokeFunctions = {
    question(
        requestId: RequestId | undefined,
        message: string,
        choices: string[],
        defaultId?: number,
        source?: string,
    ): Promise<number>;
    proposeAction(
        requestId: RequestId,
        actionTemplates: TemplateEditConfig,
        source: string,
    ): Promise<unknown>;
    openLocalView(requestId: RequestId, port: number): Promise<void>;
    closeLocalView(requestId: RequestId, port: number): Promise<void>;
};

export type ClientIOCallFunctions = {
    clear(requestId: RequestId): void;
    exit(requestId: RequestId): void;
    shutdown(requestId: RequestId): void;

    setUserRequest(requestId: RequestId, command: string, seq?: number): void;
    setDisplayInfo(
        requestId: RequestId,
        source: string,
        actionIndex?: number,
        action?: TypeAgentAction | string[],
        seq?: number,
    ): void;
    setDisplay(message: IAgentMessage, seq?: number): void;
    appendDisplay(
        message: IAgentMessage,
        mode: DisplayAppendMode,
        seq?: number,
    ): void;
    appendDiagnosticData(requestId: RequestId, data: any): void;
    setDynamicDisplay(
        requestId: RequestId,
        source: string,
        actionIndex: number,
        displayId: string,
        nextRefreshMs: number,
    ): void;

    notify(
        notificationId: string | RequestId | undefined,
        event: string,
        data: any,
        source: string,
        seq?: number,
    ): void;

    requestChoice(
        requestId: RequestId,
        choiceId: string,
        type: "yesNo" | "multiChoice",
        message: string,
        choices: string[],
        source: string,
    ): void;

    requestInteraction(interaction: PendingInteractionRequest): void;
    interactionResolved(interactionId: string, response: unknown): void;
    interactionCancelled(interactionId: string): void;

    takeAction(requestId: RequestId, action: string, data: unknown): void;
};
