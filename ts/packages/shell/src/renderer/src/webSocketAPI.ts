// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentEvent, DynamicDisplay } from "@typeagent/agent-sdk";
import { PartialCompletionResult, RequestMetrics } from "agent-dispatcher";
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

        // TODO: is this needed?
        return new Promise<RequestMetrics | undefined>((resolve, reject) => {
            placeHolder(id, { resolve, reject });
            placeHolder4("process-shell-request", request, id, images);
        });
    },
    getPartialCompletion: (prefix: string) => {
        // TODO: implement
        return new Promise<PartialCompletionResult | undefined>((resolve, reject) => {
            placeHolder1({ resolve, reject });
            placeHolder("process-shell-request", prefix);
        });
    },
    getDynamicDisplay(source: string, id: string) {
        // TODO: implement
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
        fnMap.set("askYesNo", callback);
    },
    sendYesNo: (askYesNoId: number, accept: boolean) => {
        globalThis.ws?.send(JSON.stringify({
            message: "askYesNoResponse",
            data: {
                askYesNoId,
                accept
            }
          }));
    },
    onProposeAction(callback) {
        fnMap.set("proposeAction", callback);
    },
    sendProposedAction: (proposeActionId: number, replacement?: unknown) => {
        globalThis.ws?.send(JSON.stringify({
            message: "proposeActionResponse",
            data: {
                proposeActionId,
                replacement
            }
          }));
    },    
    onQuestion(callback) {
        fnMap.set("question", callback);
    },
    sendAnswer: (questionId: number, answer?: string) => {
        globalThis.ws?.send(JSON.stringify({
            message: "questionResponse",
            data: {
                questionId,
                answer
            }
          }));        
    },
    getSpeechToken: () => {
        // TODO: implement
        return new Promise<SpeechToken | undefined>((resolve, reject) => {
            placeHolder1({resolve, reject});
        });
    },
    getLocalWhisperStatus: () => {        
        // local whisper not supported on mobile
        return new Promise<boolean | undefined>((resolve) => {
            resolve(false);
        });
    },
    onSendInputText(callback) {
        // TODO: figure out if this is still ued
        placeHolder("send-input-text", callback);
    },
    onSendDemoEvent(callback) {
        // doesn't apply on mobile
        placeHolder("send-demo-event", callback);
    },
    onHelpRequested(callback) {
        // no longer supported (i.e. F1 key)
        placeHolder("help-requested", callback);
    },
    onRandomMessageRequested(callback) {
        fnMap.set("random-message-requested", callback);
    },
    onShowDialog(callback) {
        // not supported without @shell command
        // TODO: inject replacement on mobile?
        placeHolder("show-dialog", callback);
    },
    onSettingsChanged(callback) {
        // only applies if we make the mobile agent for settings
        // TODO: figure out resolution
        placeHolder("settings-changed", callback);
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

function placeHolder1(category: any) {
    console.log(category);
}

function placeHolder(category: string, callback: any) {
    console.log(category + "\n" + callback);
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
                    fnMap.get("update-display")(undefined, msgObj.data.message, msgObj.data.mode);
                  break;
                case "exit":
                    window.close();
                    break;
                case "clear":
                    fnMap.get("clear")(undefined, msgObj.data);
                    break;
                case "take-action":
                    fnMap.get("take-action")(undefined, msgObj.data);
                    break;
                case "notify":
                    notify(msgObj);
                    break;
                case "set-dynamic-action-display":
                    // TODO: verify
                    fnMap.get("set-dynamic-action-display")(undefined, msgObj.data.source, msgObj.data.requestId, msgObj.data.actionIndex, msgObj.data.displayId, msgObj.data.nextRefreshMs);
                    break;
                case "setting-summary-changed":
                    let agentsMap: Map<string, string> = new Map<string, string>(msgObj.data.registeredAgents);
                    fnMap.get("setting-summary-changed")(undefined, msgObj.data.summary, agentsMap)
                    break;
                case "askYesNo":
                    fnMap.get("askYesNo")(msgObj.data.askYesNoId, msgObj.data.message, msgObj.data.requestId, msgObj.data.source);
                    break;
                case "proposeAction":
                    fnMap.get("proposeAction")(undefined, msgObj.data.currentProposeActionId, msgObj.data.actionTemplates, msgObj.data.requestId, msgObj.data.source);
                    break;
                case "question":
                    fnMap.get("question")(msgObj.data.currentQuestionId, msgObj.data.message, msgObj.data.requestId);
                    break;
              }

        };
        webSocket.onclose = (event: object) => {
            console.log("websocket connection closed" + event);
            resolve(undefined);

            // reconnect?
            if (autoReconnect) {
                let url = window.location
                createWebSocket(`ws://${url.hostname}:3030`, true).then((ws) => globalThis.ws = ws);                
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
                        fnMap.get("mark-explained")(undefined, msg.data.requestId, msg.data.data.time, msg.data.data.fromCache, msg.data.data.fromUser);
                    }
                    break;
                case "randomCommandSelected":
                    fnMap.get("update-random-command")(undefined, msg.data.requestId, msg.data.data.message);
                    break;
                    // TODO: implement
                case "showNotifications":
                    fnMap.get("notification-command")(undefined, msg.data.requestId, msg.data.data);
                    break;
                case AppAgentEvent.Error:
                case AppAgentEvent.Warning:
                case AppAgentEvent.Info:
                    console.log(`[${msg.data.event}] ${msg.data.source}: ${msg.data.data}`);
                    fnMap.get("notification-arrived")(undefined, msg.data.event, msg.data.requestId, msg.data.source, msg.data.data);
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