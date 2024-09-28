// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const { contextBridge } = require("electron/renderer");

import {
    WebSocketMessage,
    createWebSocket,
    keepWebSocketAlive,
} from "common-utils";

let webSocket: any = null;

async function ensureWebsocketConnected() {
    return new Promise<WebSocket | undefined>(async (resolve) => {
        if (webSocket) {
            if (webSocket.readyState === WebSocket.OPEN) {
                resolve(webSocket);
                return;
            }
            try {
                webSocket.close();
                webSocket = undefined;
            } catch {}
        }

        webSocket = await createWebSocket();
        if (!webSocket) {
            resolve(undefined);
            return;
        }

        webSocket.binaryType = "blob";
        keepWebSocketAlive(webSocket, "browser");

        webSocket.onmessage = async (event: any) => {
            const text = event.data.toString();
            const data = JSON.parse(text) as WebSocketMessage;
            if (data.target == "browser") {
                if (data.messageType == "browserActionRequest") {
                    const response = await runBrowserAction(data.body);
                    webSocket.send(
                        JSON.stringify({
                            source: data.target,
                            target: data.source,
                            messageType: "browserActionResponse",
                            id: data.id,
                            body: response,
                        }),
                    );
                } else if (data.messageType == "siteTranslatorStatus") {
                    if (data.body.status == "initializing") {
                        console.log(`Initializing ${data.body.translator}`);
                    } else if (data.body.status == "initialized") {
                        console.log(
                            `Finished initializing ${data.body.translator}`,
                        );
                    }
                } else if (
                    data.messageType.startsWith("browserActionRequest.")
                ) {
                    const message = await runSiteAction(
                        data.messageType,
                        data.body,
                    );

                    webSocket.send(
                        JSON.stringify({
                            source: data.target,
                            target: data.source,
                            messageType: "browserActionResponse",
                            id: data.id,
                            body: message,
                        }),
                    );
                }

                console.log(
                    `Browser websocket client received message: ${text}`,
                );
            }
        };

        webSocket.onclose = (event: object) => {
            console.log(event);
            console.log("websocket connection closed");
            webSocket = undefined;
            reconnectWebSocket();
        };

        resolve(webSocket);
    });
}

export function reconnectWebSocket() {
    const connectionCheckIntervalId = setInterval(async () => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            console.log("Clearing reconnect retry interval");
            clearInterval(connectionCheckIntervalId);
        } else {
            console.log("Retrying connection");
            await ensureWebsocketConnected();
        }
    }, 5 * 1000);
}

export async function getLatLongForLocation(locationName: string) {
    const mapsApiKey = process.env["BING_MAPS_API_KEY"];
    const response = await fetch(
        `https://dev.virtualearth.net/REST/v1/Locations/${locationName}?key=${mapsApiKey}`,
        {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        },
    );
    if (response.ok) {
        const json = await response.json();
        const coordinates = json.resourceSets[0].resources[0].point.coordinates;
        return {
            lat: coordinates[0],
            long: coordinates[1],
        };
    } else {
        console.log(response.statusText);
        return undefined;
    }
}

export async function awaitPageLoad() {
    /*
    return new Promise<string | undefined>((resolve, reject) => {
        // use window API to await pageload
        
    });
    */
}

export async function getTabHTML(fullSize: boolean) {
    let outerHTML = await sendScriptAction({
        type: "get_reduced_html",
        fullSize: fullSize,
        frameId: 0,
    }, 1000);

    return outerHTML;
}

export async function getTabHTMLFragments(fullSize: boolean) {
    let htmlFragments: any[] = [];

    const frameHTML = await sendScriptAction(
        {
            type: "get_reduced_html",
            fullSize: fullSize,
            frameId: 0,
        },
        5000,
    );

    const frameText = await sendScriptAction({
        type: "get_page_text",
        inputHtml: frameHTML,
        frameId: 0,
    },1000);

    htmlFragments.push({
        frameId: 0,
        content: frameHTML,
        text: frameText,
    });

    return htmlFragments;
}

export async function sendScriptAction(body: any, timeout?: number) {
    const timeoutPromise = new Promise((f) => setTimeout(f, timeout));

    const actionPromise = new Promise<any | undefined>((resolve) => {
        const callId = new Date().getTime().toString();

        window.postMessage({
            source: "preload",
            target: "contentScript",
            messageType: "scriptActionRequest",
            id: callId,
            body: body,
        });

        // if timeout is provided, wait for a response - otherwise fire and forget
        if (timeout) {
            const handler = (event: any) => {
                if (
                    event.data.target == "preload" &&
                    event.data.source == "contentScript" &&
                    event.data.messageType == "scriptActionResponse" &&
                    event.data.id == callId &&
                    event.data.body
                ) {
                    window.removeEventListener("message", handler);
                    resolve(event.data.body);
                }
            };

            window.addEventListener("message", handler, false);
        } else {
            resolve(undefined);
        }
    });

    if (timeout) {
        return Promise.race([actionPromise, timeoutPromise]);
    } else {
        return actionPromise;
    }
}

async function runBrowserAction(action: any) {
    let responseObject: any;
    let confirmationMessage = "OK";
    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);
    switch (actionName) {
        case "followLinkByText": {
            const response = await sendScriptAction(
                {
                    type: "get_page_links_by_query",
                    query: action.parameters.keywords,
                },
                5000,
            );
            console.log("We should navigate to " + JSON.stringify(response));

            if (response && response.url) {
                window.location.href = response.url;
                confirmationMessage = `Navigated to the  ${action.parameters.keywords} link`;
            }

            break;
        }

        case "scrollDown": {
            sendScriptAction({
                type: "scroll_down_on_page",
            });
            break;
        }
        case "scrollUp": {
            sendScriptAction({
                type: "scroll_up_on_page",
            });
            break;
        }
        case "goBack": {
            sendScriptAction({
                type: "history_go_back",
            });
            break;
        }
        case "goForward": {
            sendScriptAction({
                type: "history_go_forward",
            });
            break;
        }

        case "zoomIn": {
            if (window.location.href.startsWith("https://paleobiodb.org/")) {
                sendScriptAction({
                    type: "run_paleoBioDb_action",
                    action: action,
                });
            } else {
                sendScriptAction({
                    type: "zoom_in_page",
                });
            }

            break;
        }
        case "zoomOut": {
            if (window.location.href.startsWith("https://paleobiodb.org/")) {
                sendScriptAction({
                    type: "run_paleoBioDb_action",
                    action: action,
                });
            } else {
                sendScriptAction({
                    type: "zoom_out_page",
                });
            }
            break;
        }
        case "zoomReset": {
            sendScriptAction({
                type: "zoom_reset",
            });
            break;
        }

        case "getHTML": {
            responseObject = await getTabHTMLFragments(
                action.parameters.fullHTML,
            );

            break;
        }

        case "clickOnElement":
        case "enterTextInElement":
        case "enterTextOnPage": {
            sendScriptAction({
                type: "run_ui_event",
                action: action,
            });
            break;
        }
        case "getPageUrl": {
            responseObject = window.location.href;
            break;
        }
        case "getPageSchema": {
            responseObject = await sendScriptAction(
                {
                    type: "get_page_schema",
                },
                1000,
            );

            break;
        }
        case "setPageSchema": {
            sendScriptAction({
                type: "set_page_schema",
                action: action,
            });
            break;
        }
        case "clearPageSchema": {
            sendScriptAction({
                type: "clear_page_schema",
            });
            break;
        }

        case "unknown": {
            confirmationMessage = `Did not understand the request "${action.parameters.text}"`;
            break;
        }
    }

    return {
        message: confirmationMessage,
        data: responseObject,
    };
}

async function runSiteAction(messageType: string, action: any) {
    let confirmationMessage = "OK";
    switch (messageType) {
        case "browserActionRequest.paleoBioDb": {
            const actionName =
                action.actionName ?? action.fullActionName.split(".").at(-1);
            if (
                actionName == "setMapLocation" &&
                action.parameters.locationName
            ) {
                const latLong = await getLatLongForLocation(
                    action.parameters.locationName,
                );
                if (latLong) {
                    action.parameters.latitude = latLong.lat;
                    action.parameters.longitude = latLong.long;
                }
            }

            sendScriptAction({
                type: "run_paleoBioDb_action",
                action: action,
            });

            break;
        }
        case "browserActionRequest.crossword": {
            sendScriptAction({
                type: "run_crossword_action",
                action: action,
            });

            break;
        }
        case "browserActionRequest.commerce": {
            sendScriptAction({
                type: "run_commerce_action",
                action: action,
            });

            break;
        }
    }

    return confirmationMessage;
}

contextBridge.exposeInMainWorld("browserConnect", {
    enableSiteAgent: (translatorName) => {
        if (
            webSocket &&
            webSocket.readyState === WebSocket.OPEN &&
            translatorName
        ) {
            webSocket.send(
                JSON.stringify({
                    source: "browser",
                    target: "dispatcher",
                    messageType: "enableSiteTranslator",
                    body: translatorName,
                }),
            );
        }
    },
    disableSiteAgent: (translatorName) => {
        if (
            webSocket &&
            webSocket.readyState === WebSocket.OPEN &&
            translatorName
        ) {
            webSocket.send(
                JSON.stringify({
                    source: "browser",
                    target: "dispatcher",
                    messageType: "disableSiteTranslator",
                    body: translatorName,
                }),
            );
        }
    },
});

await ensureWebsocketConnected();

window.addEventListener(
    "message",
    async (event) => {
        if (event.data === "page-to-bridge") {
            console.log("Message from page to bridge");
        }
    },
    false,
);

window.postMessage("setupSiteAgent");
