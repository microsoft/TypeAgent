// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgentEvent,
    DynamicDisplay,
    TemplateSchema,
} from "@typeagent/agent-sdk";
import { CommandCompletionResult, RequestMetrics } from "agent-dispatcher";
import { ClientAPI, SpeechToken } from "../../preload/electronTypes";
import { AzureSpeech } from "./azureSpeech";

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

    processShellRequest: (request: string, id: string, images: string[]) => {
        return new Promise<RequestMetrics | undefined>((resolve, reject) => {
            let currentMessageId: number = ++maxWebAPIMessageId;
            // call server websocket and send request
            globalThis.ws.send(
                JSON.stringify({
                    message: "process-shell-request",
                    data: {
                        messageId: currentMessageId,
                        request,
                        id,
                        images,
                    },
                }),
            );
            // callbacks saved for later resolution
            msgPromiseMap.set(currentMessageId, { resolve, reject });
        });
    },
    getCommandCompletion: (prefix: string) => {
        // TODO: implement
        return new Promise<CommandCompletionResult | undefined>(
            (resolve, reject) => {
                placeHolder1({ resolve, reject });
                placeHolder("getCommandCompletion", prefix);
            },
        );
    },

    getTemplateCompletion: (
        templateAgentName,
        templateName,
        data,
        propertyName,
    ) => {
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
    getDynamicDisplay(source: string, id: string) {
        globalThis.ws.send(
            JSON.stringify({
                message: "get-dynamic-display",
                data: {
                    appAgentName: source,
                    displayType: "html",
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
    ) {
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
    onQuestion(callback) {
        fnMap.set("question", callback);
    },
    sendAnswer: (questionId: number, answer?: string) => {
        globalThis.ws?.send(
            JSON.stringify({
                message: "questionResponse",
                data: {
                    questionId,
                    answer,
                },
            }),
        );
    },
    getSpeechToken: () => {
        // TODO: implement client side token acquisition
        // Depends on implementing client side EntraID Auth first
        return new Promise<SpeechToken | undefined>(async (resolve) => {

            // TODO: get from node instance from now - in the future get form users datastore
            // intialize speech
            if (!AzureSpeech.IsInitialized()) {
                await AzureSpeech.initializeAsync({
                    azureSpeechSubscriptionKey: "identity",
                    azureSpeechRegion: "westus",
                    azureSpeechEndpoint: "/subscriptions/b64471de-f2ac-4075-a3cb-7656bca768d0/resourceGroups/openai_dev/providers/Microsoft.CognitiveServices/accounts/octo-aisystems",
                });
            }

            let speechToken: | { token: string; expire: number; region: string; endpoint: string }
                            | undefined;

            // TODO: debug
            const tokenResponse = await AzureSpeech.getInstance().getBrowserTokenAsync();



            //AzureSpeech.getInstance().getTokenAsync();
            // authProvider.getToken().then((value: msal.AuthenticationResult | undefined | void) => {
            //     if (value) {
            //         resolve({
            //             token: value.accessToken,
            //             expire: Number(value.expiresOn),
            //             region: "",
            //             endpoint: ""
            //         });
            //     } else {
            //         resolve(undefined);
            //     }
            // });

            speechToken = {
                token: tokenResponse.token,
                expire: Date.now() + 9 * 60 * 1000, // 9 minutes (token expires in 10 minutes)
                region: tokenResponse.region,
                endpoint: tokenResponse.endpoint,
            };

            resolve(speechToken); // currently not supported
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

export async function createWebSocket(
    endpoint: string = "ws://localhost:8080",
    autoReconnect: boolean = true,
) {
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
                    fnMap.get("take-action")(undefined, msgObj.data.action, msgObj.data.data);
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
                case "question":
                    fnMap.get("question")(
                        msgObj.data.currentQuestionId,
                        msgObj.data.message,
                        msgObj.data.requestId,
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
                let url = window.location;
                createWebSocket(`ws://${url.hostname}:3030`, true).then(
                    (ws) => (globalThis.ws = ws),
                );
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
