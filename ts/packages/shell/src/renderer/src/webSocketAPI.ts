// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DynamicDisplay } from "@typeagent/agent-sdk";
import { PartialCompletionResult, RequestMetrics } from "agent-dispatcher";
import { ClientAPI, SpeechToken } from "../../preload/electronTypes";

export const webapi: ClientAPI = {
    onListenEvent: (
        callback: (
            e: Electron.IpcRendererEvent,
            name: string,
            token?: SpeechToken,
            useLocalWhisper?: boolean,
        ) => void,
    ) => placeHolder("listen-event", callback),

    processShellRequest: (request: string, id: string, images: string[]) => {

        // call server websocket and send request
        globalThis.ws.send(JSON.stringify({    
            message: "shellrequest",
            data: {
                request,
                id,
                images
            }
        }));

        return new Promise<RequestMetrics | undefined>((resolve, reject) => {
            placeHolder(id, { resolve, reject });
            placeHolder4("process-shell-request", request, id, images);
        });
    },
    getPartialCompletion: (prefix: string) => {
        return new Promise<PartialCompletionResult | undefined>((resolve, reject) => {
            placeHolder1({ resolve, reject });
            placeHolder("process-shell-request", prefix);
        });
    },
    getDynamicDisplay(source: string, id: string) {
        return new Promise<DynamicDisplay>((resolve, reject) => {
            placeHolder(source, id);
            placeHolder1({resolve, reject});
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
    onMarkRequestExplained(callback) {
        fnMap.set("mark-explained", callback);
    },
    onRandomCommandSelected(callback) {
        fnMap.set("update-random-command", callback);
    },
    onAskYesNo(callback) {
        placeHolder("askYesNo", callback);
    },
    sendYesNo: (askYesNoId: number, accept: boolean) => {
        placeHolder3("askYesNoResponse", askYesNoId, accept);
    },
    onProposeAction(callback) {
        placeHolder("proposeAction", callback);
    },
    sendProposedAction: (proposeActionId: number, replacement?: unknown) => {
        placeHolder3("proposeActionResponse", proposeActionId, replacement);
    },    
    onQuestion(callback) {
        placeHolder("question", callback);
    },
    sendAnswer: (questionId: number, answer?: string) => {
        placeHolder3("questionResponse", questionId, answer);
    },
    getSpeechToken: () => {
        return new Promise<SpeechToken | undefined>((resolve, reject) => {
            placeHolder1({resolve, reject});
        });
    },
    getLocalWhisperStatus: () => {
        return new Promise<boolean | undefined>((resolve, reject) => {
            placeHolder1({resolve, reject});
        });
    },
    onSendInputText(callback) {
        placeHolder("send-input-text", callback);
    },
    onSendDemoEvent(callback) {
        placeHolder("send-demo-event", callback);
    },
    onHelpRequested(callback) {
        placeHolder("help-requested", callback);
    },
    onRandomMessageRequested(callback) {
        fnMap.set("random-message-requested", callback);
    },
    onShowDialog(callback) {
        placeHolder("show-dialog", callback);
    },
    onSettingsChanged(callback) {
        placeHolder("settings-changed", callback);
    },
    onNotificationCommand(callback) {
        placeHolder("notification-command", callback);
    },
    onNotify(callback) {
        fnMap.set("notification-arrived", callback);
    },
    onTakeAction(callback) {
        fnMap.set("take-action", callback);
    },
};

let fnMap: Map<string, any> = new Map<string, any>();

function placeHolder1(category: any) {
    console.log(category);
}

function placeHolder(category: string, callback: any) {
    console.log(category + "\n" + callback);
}

function placeHolder3(category: string, data: any, data2: any) {
    console.log(category + "\n" + data + data2);
}

function placeHolder4(category: string, data: any, data2: any, data3: any) {
    console.log(category + "\n" + data + data2 + data3);
}

export async function createWebSocket(endpoint: string = "ws://localhost:8080", autoReconnect: boolean = true) {
    return new Promise<WebSocket | undefined>((resolve) => {
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
            switch(msgObj.message) {
                case "update-display":
                    if (fnMap.has("update-display")) {
                        fnMap.get("update-display")(undefined, msgObj.data.message, msgObj.data.mode);
                    }
                  break;
                case "exit":
                    window.close();
                    break;
                case "clear":
                    if (fnMap.has("clear")) {
                        fnMap.get("clear")(undefined, msgObj.data);
                    }
                    break;
                case "take-action":
                    if (fnMap.has("take-action")) {
                        fnMap.get("take-action")(undefined, msgObj.data);
                    }
                    break;
                case "notify":
                    notify(msgObj);
                    break;
                case "set-dynamic-action-display":
                    // TODO: verify
                    if (fnMap.has("set-dynamic-action-display")) {
                        fnMap.get("set-dynamic-action-display")(undefined, msgObj.data.source, msgObj.data.requestId, msgObj.data.actionIndex, msgObj.data.displayId, msgObj.data.nextRefreshMs);
                    }                    
                    break;
                case "setting-summary-changed":
                    if (fnMap.has("setting-summary-changed")) {
                        let agentsMap: Map<string, string> = new Map<string, string>(msgObj.data.registeredAgents);
                        fnMap.get("setting-summary-changed")(undefined, msgObj.data.summary, agentsMap)
                    }
                    break;
              }

        };
        webSocket.onclose = (event: object) => {
            console.log("websocket connection closed" + event);
            resolve(undefined);

            // reconnect?
            if (autoReconnect) {
                createWebSocket("ws://localhost:3030", true).then((ws) => globalThis.ws = ws);                
            }
        };
        webSocket.onerror = (event: object) => {
            console.log("websocket error" + event);
            resolve(undefined);
        };

        function notify(msg: any) {
            switch (msg.data.event) {
                case "explained":
                    // TODO: verify
                    if (msg.data.requestId === undefined) {
                        console.warn("markRequestExplained: requestId is undefined");
                        return;
                    } else {
                        if (fnMap.has("mark-explained")) {
                            fnMap.get("mark-explained")(undefined, msg.data.requestId, msg.data.data.time, msg.data.data.fromCache, msg.data.data.fromUser);
                        } 
                    }
                    break;
                case "randomCommandSelected":
                    if (fnMap.has("update-random-command")) {
                        fnMap.get("update-random-command")(undefined, msg.data.requestId, msg.data.data.message);
                    }
                    break;
            //     case "showNotifications":
            //         mainWindow?.webContents.send(
            //             "notification-command",
            //             requestId,
            //             data,
            //         );
            //         break;
            //     case AppAgentEvent.Error:
            //     case AppAgentEvent.Warning:
            //     case AppAgentEvent.Info:
            //         console.log(`[${event}] ${source}: ${data}`);
            //         mainWindow?.webContents.send(
            //             "notification-arrived",
            //             event,
            //             requestId,
            //             source,
            //             data,
            //         );
            //         break;
            //     default:
            //     // ignore
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