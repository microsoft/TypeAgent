// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRpc } from "agent-rpc/rpc";
import {
    ClientIO,
    IAgentMessage,
    RequestId,
} from "../context/interactiveIO.js";
import {
    ClientIOCallFunctions,
    ClientIOInvokeFunctions,
} from "./clientIOTypes.js";
import { TemplateEditConfig } from "../translation/actionTemplate.js";
import { RpcChannel } from "agent-rpc/channel";
import { DisplayAppendMode, TypeAgentAction } from "@typeagent/agent-sdk";

export function createClientIORpcClient(channel: RpcChannel): ClientIO {
    const rpc = createRpc<ClientIOInvokeFunctions, ClientIOCallFunctions>(
        "clientio",
        channel,
    );
    return {
        clear(): void {
            return rpc.send("clear");
        },
        exit(): void {
            return rpc.send("exit");
        },
        setDisplayInfo(
            source: string,
            requestId: RequestId,
            actionIndex?: number,
            action?: TypeAgentAction,
        ): void {
            return rpc.send("setDisplayInfo", {
                source,
                requestId,
                actionIndex,
                action,
            });
        },
        setDisplay(message: IAgentMessage): void {
            return rpc.send("setDisplay", { message });
        },
        appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void {
            return rpc.send("appendDisplay", { message, mode });
        },
        appendDiagnosticData(requestId: RequestId, data: any) {
            return rpc.send("appendDiagnosticData", { requestId, data });
        },
        setDynamicDisplay(
            source: string,
            requestId: RequestId,
            actionIndex: number,
            displayId: string,
            nextRefreshMs: number,
        ): void {
            return rpc.send("setDynamicDisplay", {
                source,
                requestId,
                actionIndex,
                displayId,
                nextRefreshMs,
            });
        },

        // Input
        askYesNo(
            message: string,
            requestId: RequestId,
            defaultValue?: boolean,
        ): Promise<boolean> {
            return rpc.invoke("askYesNo", { message, requestId, defaultValue });
        },
        proposeAction(
            actionTemplates: TemplateEditConfig,
            requestId: RequestId,
            source: string,
        ): Promise<unknown> {
            return rpc.invoke("proposeAction", {
                actionTemplates,
                requestId,
                source,
            });
        },
        popupQuestion(
            message: string,
            choices: string[],
            defaultId: number | undefined,
            source: string,
        ): Promise<number> {
            return rpc.invoke("popupQuestion", {
                message,
                choices,
                defaultId,
                source,
            });
        },
        notify(
            event: string,
            requestId: RequestId,
            data: any,
            source: string,
        ): void {
            return rpc.send("notify", { event, requestId, data, source });
        },
        openLocalView(port: number): Promise<void> {
            return rpc.invoke("openLocalView", { port });
        },
        closeLocalView(port: number): Promise<void> {
            return rpc.invoke("closeLocalView", { port });
        },
        takeAction(action: string, data: unknown): void {
            return rpc.send("takeAction", { action, data });
        },
    };
}
