// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { DisplayAppendMode, TypeAgentAction } from "@typeagent/agent-sdk";
import type {
    IAgentMessage,
    RequestId,
    TemplateEditConfig,
} from "@typeagent/dispatcher-types";

export type ClientIOInvokeFunctions = {
    askYesNo(
        requestId: RequestId,
        message: string,
        defaultValue?: boolean,
    ): Promise<boolean>;
    proposeAction(
        requestId: RequestId,
        actionTemplates: TemplateEditConfig,
        source: string,
    ): Promise<unknown>;
    popupQuestion(
        message: string,
        choices: string[],
        defaultId: number | undefined,
        source: string,
    ): Promise<number>;
    openLocalView(requestId: RequestId, port: number): Promise<void>;
    closeLocalView(requestId: RequestId, port: number): Promise<void>;
};

export type ClientIOCallFunctions = {
    clear(requestId: RequestId): void;
    exit(requestId: RequestId): void;

    setDisplayInfo(
        requestId: RequestId,
        source: string,
        actionIndex?: number,
        action?: TypeAgentAction | string[],
    ): void;
    setDisplay(message: IAgentMessage): void;
    appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void;
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
    ): void;

    takeAction(requestId: RequestId, action: string, data: unknown): void;
};
