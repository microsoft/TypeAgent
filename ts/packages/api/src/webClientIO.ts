// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayAppendMode, TemplateSchema } from "@typeagent/agent-sdk";
import {
    TemplateEditConfig,
    ClientIO,
    IAgentMessage,
    RequestId,
    RequestMetrics,
} from "agent-dispatcher";
import WebSocket from "ws";

export class WebAPIClientIO implements ClientIO {
    private currentws: WebSocket | undefined;
    private yesNoCallbacks: Map<number, (accept: boolean) => void> = new Map<
        number,
        (accept: boolean) => void
    >();
    private proposedActionCallbacks: Map<
        number,
        (replacement?: unknown) => void
    > = new Map<number, (replacement?: unknown) => void>();
    private questionCallbacks: Map<number, (response: string) => void> =
        new Map<number, (response: string) => void>();

    public get CurrentWebSocket() {
        return this.currentws;
    }

    public set CurrentWebSocket(value: WebSocket | undefined) {
        this.currentws = value;
    }

    resolveYesNoPromise(yesNoAskId: number, accept: boolean) {
        if (this.yesNoCallbacks.has(yesNoAskId)) {
            let callback: (accept: boolean) => void =
                this.yesNoCallbacks.get(yesNoAskId)!;
            callback(accept);

            this.yesNoCallbacks.delete(yesNoAskId);
        }
    }

    resolveProposeActionPromise(
        proposedActionId: number,
        replacement?: unknown,
    ) {
        if (this.proposedActionCallbacks.has(proposedActionId)) {
            let callback: (replacement?: unknown) => void =
                this.proposedActionCallbacks.get(proposedActionId)!;
            callback(replacement);

            this.proposedActionCallbacks.delete(proposedActionId);
        }
    }

    resolveQuestionPromise(questionId: number, response: string) {
        if (this.questionCallbacks.has(questionId)) {
            let callback: (response: string) => void =
                this.questionCallbacks.get(questionId)!;
            callback(response);

            this.questionCallbacks.delete(questionId);
        }
    }

    clear() {
        this.currentws?.send(
            JSON.stringify({
                message: "clear",
                data: {},
            }),
        );
    }

    setDisplay(message: IAgentMessage) {
        this.updateDisplay(message);
    }

    appendDisplay(message: IAgentMessage, mode: DisplayAppendMode) {
        this.updateDisplay(message, mode ?? "inline");
    }

    updateDisplay(message?: IAgentMessage, mode?: DisplayAppendMode) {
        this.currentws?.send(
            JSON.stringify({
                message: "update-display",
                data: {
                    message,
                    mode,
                },
            }),
        );
        console.log("update-display");
    }

    setDynamicDisplay(
        source: string,
        requestId: RequestId,
        actionIndex: number,
        displayId: string,
        nextRefreshMs: number,
    ) {
        this.currentws?.send(
            JSON.stringify({
                message: "set-dynamic-action-display",
                data: {
                    source,
                    requestId,
                    actionIndex,
                    displayId,
                    nextRefreshMs,
                },
            }),
        );
    }

    private maxAskYesNoId = 0;
    async askYesNo(
        message: string,
        requestId: RequestId,
        defaultValue: boolean = false,
    ): Promise<boolean> {
        // Ignore message without requestId
        if (requestId === undefined) {
            console.warn("askYesNo: requestId is undefined");
            return defaultValue;
        }

        const currentAskYesNoId = this.maxAskYesNoId++;
        return new Promise<boolean>((resolve) => {
            this.yesNoCallbacks.set(currentAskYesNoId, (accept: boolean) => {
                resolve(accept);
            });

            this.currentws?.send(
                JSON.stringify({
                    message: "askYesNo",
                    data: {
                        requestId,
                        currentAskYesNoId,
                        message,
                    },
                }),
            );
        });
    }

    private maxProposedActionId = 0;
    proposeAction(
        actionTemplates: TemplateEditConfig,
        requestId: RequestId,
        source: string,
    ): Promise<unknown> {
        const currentProposeActionId = this.maxProposedActionId++;
        return new Promise<unknown>((resolve) => {
            this.proposedActionCallbacks.set(
                currentProposeActionId,
                (replacement?: unknown) => {
                    resolve(replacement);
                },
            );

            this.currentws?.send(
                JSON.stringify({
                    message: "proposeAction",
                    data: {
                        currentProposeActionId,
                        actionTemplates,
                        requestId,
                        source,
                    },
                }),
            );
        });
    }

    notify(event: string, requestId: RequestId, data: any, source: string) {
        this.currentws?.send(
            JSON.stringify({
                message: "notify",
                data: {
                    event,
                    requestId,
                    data,
                    source,
                },
            }),
        );
    }

    exit() {
        this.currentws?.send(
            JSON.stringify({
                message: "exit",
                data: {},
            }),
        );
    }

    takeAction(action: string, data: unknown) {
        this.currentws?.send(
            JSON.stringify({
                message: "take-action",
                data: { action, data },
            }),
        );
    }

    updateSettingsSummary(
        summary: string,
        registeredAgents: [string, string][],
    ) {
        this.currentws?.send(
            JSON.stringify({
                message: "setting-summary-changed",
                data: {
                    summary,
                    registeredAgents,
                },
            }),
        );
    }

    sendSuccessfulCommandResult(
        messageId: number,
        requestId: RequestId,
        metrics?: RequestMetrics,
    ) {
        this.currentws?.send(
            JSON.stringify({
                message: "process-shell-request-done",
                data: {
                    messageId,
                    requestId,
                    metrics,
                },
            }),
        );
    }

    sendFailedCommandResult(
        messageId: number,
        requestId: RequestId,
        error: any,
    ) {
        this.sendMessage("process-shell-request-error", {
            messageId,
            requestId,
            error,
        });
    }

    sendTemplateSchema(messageId: number, schema: TemplateSchema) {
        this.sendMessage("set-template-schema", {
            messageId,
            schema,
        });
    }

    sendMessage(messageType: string, payload: any) {
        this.currentws?.send(
            JSON.stringify({
                message: messageType,
                data: payload,
            }),
        );
    }
}
