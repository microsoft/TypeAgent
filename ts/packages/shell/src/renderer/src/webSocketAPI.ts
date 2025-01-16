// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgentEvent,
    DynamicDisplay,
    TemplateSchema,
    DisplayType,
} from "@typeagent/agent-sdk";
import {
    CommandCompletionResult,
    Dispatcher,
    RequestId,
    RequestMetrics,
} from "agent-dispatcher";
import { ClientAPI, SpeechToken } from "../../preload/electronTypes";

export const webapi: ClientAPI = {
    // TODO: implement
    onListenEvent: (
        callback: (
            e: Electron.IpcRendererEvent,
            name: string,
            token?: SpeechToken,
            useLocalWhisper?: boolean,
        ) => void,
    ) => placeHolder("listen-event", callback),

    onUpdateDisplay(callback) {
        fnMap.set("update-display", callback);
    },
    onSetDynamicActionDisplay(callback) {
        fnMap.set("set-dynamic-action-display", callback);
    },
    onClear(callback) {
        fnMap.set("clear", callback);
    },
    onSettingSummaryChanged(callback) {
        fnMap.set("setting-summary-changed", callback);
    },
    onNotifyExplained(callback) {
        fnMap.set("notifyExplained", callback);
    },
    onRandomCommandSelected(callback) {
        fnMap.set("update-random-command", callback);
    },
    onAskYesNo(callback) {
        fnMap.set("askYesNo", callback);
    },
    sendYesNo: (askYesNoId: number, accept: boolean) => {
        globalThis.ws?.send(
            JSON.stringify({
                message: "askYesNoResponse",
                data: {
                    askYesNoId,
                    accept,
                },
            }),
        );
    },
    onProposeAction(callback) {
        fnMap.set("proposeAction", callback);
    },
    sendProposedAction: (proposeActionId: number, replacement?: unknown) => {
        globalThis.ws?.send(
            JSON.stringify({
                message: "proposeActionResponse",
                data: {
                    proposeActionId,
                    replacement,
                },
            }),
        );
    },
    getSpeechToken: () => {
        return new Promise<SpeechToken | undefined>(async (resolve) => {
            // We are not auth in this case and instead will rely on the device to provide speech reco
            resolve(undefined);
        });
    },
    getLocalWhisperStatus: () => {
        // local whisper not supported on mobile
        return new Promise<boolean | undefined>((resolve) => {
            resolve(false);
        });
    },
    onSendInputText(callback) {
        // doesn't apply on mobile
        fnMap.set("send-input-text", callback);
    },
    onSendDemoEvent(callback) {
        // doesn't apply on mobile
        fnMap.set("send-demo-event", callback);
    },
    onHelpRequested(callback) {
        // no longer supported (i.e. F1 key)
        fnMap.set("help-requested", callback);
    },
    onRandomMessageRequested(callback) {
        fnMap.set("random-message-requested", callback);
    },
    onShowDialog(callback) {
        // not supported without @shell command
        // TODO: inject replacement on mobile?
        fnMap.set("show-dialog", callback);
    },
    onSettingsChanged(callback) {
        // only applies if we make the mobile agent for settings
        // TODO: figure out solution for mobile
        fnMap.set("settings-changed", callback);
    },
    onNotificationCommand(callback) {
        fnMap.set("notification-command", callback);
    },
    onNotify(callback) {
        fnMap.set("notification-arrived", callback);
    },
    onTakeAction(callback) {
        fnMap.set("take-action", callback);
    },
};

let fnMap: Map<string, any> = new Map<string, any>();
let maxWebAPIMessageId: number = 0;
let msgPromiseMap = new Map<
    number,
    { resolve: (result?: any) => void; reject: (reason?: any) => void }
>();

function placeHolder1(category: any) {
    console.log(category);
}

function placeHolder(category: string, callback: any) {
    console.log(category + "\n" + JSON.stringify(callback));
}

export async function createWebSocket(autoReconnect: boolean = true) {
    let url = window.location;
    let protocol = url.protocol.toLowerCase() == "https:" ? "wss" : "ws";
    let port = url.hostname.toLowerCase() == "localhost" ? ":3000" : "";

    const endpoint = `${protocol}://${url.hostname}${port}`;

    return new Promise<WebSocket | undefined>((resolve) => {
        console.log(`opening web socket to ${endpoint} `);
        const webSocket = new WebSocket(endpoint);

        webSocket.onopen = (event: object) => {
            console.log("websocket open" + event);
            resolve(webSocket);
        };

        // messages from the typeAgent server appear here
        webSocket.onmessage = (event: any) => {
            console.log("websocket message: " + JSON.stringify(event));

            const msgObj = JSON.parse(event.data);
            console.log(msgObj);
            switch (msgObj.message) {
                case "update-display":
                    fnMap.get("update-display")(
                        undefined,
                        msgObj.data.message,
                        msgObj.data.mode,
                    );
                    break;
                case "exit":
                    window.close();
                    break;
                case "clear":
                    fnMap.get("clear")(undefined, msgObj.data);
                    break;
                case "take-action":
                    fnMap.get("take-action")(
                        undefined,
                        msgObj.data.action,
                        msgObj.data.data,
                    );
                    break;
                case "notify":
                    notify(msgObj);
                    break;
                case "set-dynamic-action-display":
                    // TODO: verify
                    fnMap.get("set-dynamic-action-display")(
                        undefined,
                        msgObj.data.source,
                        msgObj.data.requestId,
                        msgObj.data.actionIndex,
                        msgObj.data.displayId,
                        msgObj.data.nextRefreshMs,
                    );
                    break;
                case "setting-summary-changed":
                    let agentsMap: Map<string, string> = new Map<
                        string,
                        string
                    >(msgObj.data.registeredAgents);
                    fnMap.get("setting-summary-changed")(
                        undefined,
                        msgObj.data.summary,
                        agentsMap,
                    );
                    break;
                case "askYesNo":
                    fnMap.get("askYesNo")(
                        msgObj.data.askYesNoId,
                        msgObj.data.message,
                        msgObj.data.requestId,
                        msgObj.data.source,
                    );
                    break;
                case "proposeAction":
                    fnMap.get("proposeAction")(
                        undefined,
                        msgObj.data.currentProposeActionId,
                        msgObj.data.actionTemplates,
                        msgObj.data.requestId,
                        msgObj.data.source,
                    );
                    break;
                case "process-shell-request-done":
                    completeMessagePromise(
                        msgObj.data.messageId,
                        true,
                        msgObj.data.metrics,
                    );
                    break;
                case "process-shell-request-error":
                    completeMessagePromise(
                        msgObj.data.messageId,
                        false,
                        msgObj.data.error,
                    );
                    break;
                case "set-template-schema":
                    completeMessagePromise(
                        msgObj.data.messageId,
                        true,
                        msgObj.data.data.schema,
                    );
                    break;
            }
        };
        webSocket.onclose = (event: object) => {
            console.log("websocket connection closed" + event);
            resolve(undefined);

            // reconnect?
            if (autoReconnect) {
                createWebSocket().then((ws) => (globalThis.ws = ws));
            }
        };
        webSocket.onerror = (event: object) => {
            console.log("websocket error" + event);
            resolve(undefined);
        };

        function completeMessagePromise(
            messageId: number,
            success: boolean,
            result: any,
        ) {
            if (messageId && msgPromiseMap.has(messageId)) {
                const promise = msgPromiseMap.get(messageId);
                if (success) {
                    promise?.resolve(result);
                } else {
                    promise?.reject(result);
                }
                msgPromiseMap.delete(messageId);
            } else {
                console.log(`Unknown message ID: ${messageId}`);
            }
        }

        function notify(msg: any) {
            switch (msg.data.event) {
                case "explained":
                    if (msg.data.requestId === undefined) {
                        console.warn("notifyExplained: requestId is undefined");
                        return;
                    } else {
                        fnMap.get("mark-explained")(
                            undefined,
                            msg.data.requestId,
                            msg.data.data.time,
                            msg.data.data.fromCache,
                            msg.data.data.fromUser,
                        );
                    }
                    break;
                case "randomCommandSelected":
                    fnMap.get("update-random-command")(
                        undefined,
                        msg.data.requestId,
                        msg.data.data.message,
                    );
                    break;
                case "showNotifications":
                    fnMap.get("notification-command")(
                        undefined,
                        msg.data.requestId,
                        msg.data.data,
                    );
                    break;
                case AppAgentEvent.Error:
                case AppAgentEvent.Warning:
                case AppAgentEvent.Info:
                    console.log(
                        `[${msg.data.event}] ${msg.data.source}: ${msg.data.data}`,
                    );
                    fnMap.get("notification-arrived")(
                        undefined,
                        msg.data.event,
                        msg.data.requestId,
                        msg.data.source,
                        msg.data.data,
                    );
                    break;
                default:
                // ignore
            }
        }
    });
}

export function keepWebSocketAlive(webSocket: WebSocket, source: string) {
    const keepAliveIntervalId = setInterval(() => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            webSocket.send(
                JSON.stringify({
                    source: `${source}`,
                    target: "none",
                    messageType: "keepAlive",
                    body: {},
                }),
            );
        } else {
            console.log("Clearing keepalive retry interval");
            clearInterval(keepAliveIntervalId);
        }
    }, 20 * 1000);
}
const remoteCallNotSupported = () => {
    throw new Error("Remote call not supported");
};
export const webdispatcher: Dispatcher = {
    processCommand(
        command: string,
        requestId?: RequestId,
        attachments?: string[],
    ): Promise<RequestMetrics | undefined> {
        return new Promise<RequestMetrics | undefined>((resolve, reject) => {
            let currentMessageId: number = ++maxWebAPIMessageId;
            // call server websocket and send request
            globalThis.ws.send(
                JSON.stringify({
                    message: "process-shell-request",
                    data: {
                        messageId: currentMessageId,
                        request: command,
                        id: requestId,
                        images: attachments,
                    },
                }),
            );
            // callbacks saved for later resolution
            msgPromiseMap.set(currentMessageId, { resolve, reject });
        });
    },

    getDynamicDisplay(
        appAgentName: string,
        type: DisplayType,
        id: string,
    ): Promise<DynamicDisplay> {
        globalThis.ws.send(
            JSON.stringify({
                message: "get-dynamic-display",
                data: {
                    appAgentName,
                    displayType: type,
                    requestId: id,
                },
            }),
        );

        return new Promise<DynamicDisplay>(() => {
            // currently this promise isn't listened so no need to resolve/reject
            // resolution/rejection comes through as a separate web socket message
        });
    },
    getTemplateSchema(
        templateAgentName: string,
        templateName: string,
        data: unknown,
    ): Promise<TemplateSchema> {
        return new Promise<TemplateSchema>((resolve, reject) => {
            let currentMessageId: number = ++maxWebAPIMessageId;
            globalThis.ws.send(
                JSON.stringify({
                    message: "get-template-schema",
                    data: {
                        messageId: currentMessageId,
                        templateAgentName,
                        templateName,
                        data,
                    },
                }),
            );

            // callbacks saved for later resolution
            msgPromiseMap.set(currentMessageId, { resolve, reject });
        });
    },

    getTemplateCompletion(
        templateAgentName: string,
        templateName: string,
        data: unknown,
        propertyName: string,
    ): Promise<string[] | undefined> {
        // TODO: implement
        return new Promise<string[]>((resolve, reject) => {
            placeHolder1({ resolve, reject });
            placeHolder("getActionCompletion", {
                templateAgentName,
                templateName,
                data,
                propertyName,
            });
        });
    },

    getCommandCompletion(
        prefix: string,
    ): Promise<CommandCompletionResult | undefined> {
        // TODO: implement
        return new Promise<CommandCompletionResult | undefined>(
            (resolve, reject) => {
                placeHolder1({ resolve, reject });
                placeHolder("getCommandCompletion", prefix);
            },
        );
    },
    close: remoteCallNotSupported,
    getPrompt: remoteCallNotSupported,
    getSettingSummary: remoteCallNotSupported,
    getTranslatorNameToEmojiMap: remoteCallNotSupported,
};
