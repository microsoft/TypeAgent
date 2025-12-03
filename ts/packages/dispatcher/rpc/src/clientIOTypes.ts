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
        message: string,
        requestId: RequestId,
        defaultValue?: boolean,
    ): Promise<boolean>;
    proposeAction(
        actionTemplates: TemplateEditConfig,
        requestId: RequestId,
        source: string,
    ): Promise<unknown>;
    popupQuestion(
        message: string,
        choices: string[],
        defaultId: number | undefined,
        source: string,
    ): Promise<number>;
    openLocalView(port: number): Promise<void>;
    closeLocalView(port: number): Promise<void>;
};

export type ClientIOCallFunctions = {
    clear(): void;
    exit(): void;

    setDisplayInfo(
        source: string,
        requestId: RequestId,
        actionIndex?: number,
        action?: TypeAgentAction | string[],
    ): void;
    setDisplay(message: IAgentMessage): void;
    appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void;
    appendDiagnosticData(requestId: RequestId, data: any): void;
    setDynamicDisplay(
        source: string,
        requestId: RequestId,
        actionIndex: number,
        displayId: string,
        nextRefreshMs: number,
    ): void;

    notify(
        event: string,
        requestId: RequestId,
        data: any,
        source: string,
    ): void;

    takeAction(action: string, data: unknown): void;
};
