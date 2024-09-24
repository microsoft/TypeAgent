const { contextBridge, ipcRenderer } = require('electron/renderer')


export type WebSocketMessage = {
    source: string;
    target: string;
    id?: string;
    messageType: string;
    body: any;
};

let webSocket: any = null;
let configValues: Record<string, string>;

export async function createWebSocket() {
    if (!configValues) {
        // configValues = await getConfigValues();
    }

    let socketEndpoint = "ws://localhost:8080/prod";

    // socketEndpoint += "?clientId=" + chrome.runtime.id;
    return new Promise<WebSocket | undefined>((resolve) => {
        const webSocket = new WebSocket(socketEndpoint);

        webSocket.onopen = () => {
            console.log("websocket open");
            resolve(webSocket);
        };
        webSocket.onmessage = () => {};
        webSocket.onclose = () => {
            console.log("websocket connection closed");
            resolve(undefined);
        };
        webSocket.onerror = () => {
            console.error("websocket error");
            resolve(undefined);
        };
    });
}

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
        keepWebSocketAlive(webSocket);

        webSocket.onmessage = async (event: any) => {
            const text = await event.data.text();
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

export function keepWebSocketAlive(webSocket: WebSocket) {
    const keepAliveIntervalId = setInterval(() => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            webSocket.send(
                JSON.stringify({
                    source: "browser",
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


async function getLatLongForLocation(locationName: string) {
    const mapsApiKey = process.env["BING_MAPS_API_KEY"];
    const response = await fetch(
        `http://dev.virtualearth.net/REST/v1/Locations/${locationName}?key=${mapsApiKey}`,
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
/*
async function runBrowserAction(action: any) {
    console.log(JSON.stringify(action));
    // todo: get current window 
    // send window message - do we go through our exposed api or postMessage?
    window.postMessage({
        source: "preload",
        target: "contentScript",
        messageType: "browserActionRequest",
        body: action
    });
}

async function runSiteAction(messageType: string, action: any) {
    console.log(messageType);
    
    console.log(JSON.stringify(action));
    // todo: get current window 
    // send window message - do we go through our exposed api or postMessage?
    window.postMessage({
        source: "preload",
        target: "contentScript",
        messageType: messageType,
        body: action
    });

}
*/

async function sendScriptAction(body: any) {
    // console.log(messageType);
    
    // console.log(JSON.stringify(action));
    // todo: get current window 
    // send window message - do we go through our exposed api or postMessage?
    window.postMessage({
        source: "preload",
        target: "contentScript",
        messageType: "scriptActionRequest",
        body: body
    });

}


async function runBrowserAction(action: any) {
    let responseObject = undefined;
    let confirmationMessage = "OK";
    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);
    switch (actionName) {
        
        case "followLinkByText": {            
            await sendScriptAction({
                type: "get_page_links_by_query",
                query: action.parameters.keywords,
            });
/*
            if (response && response.url) {
                if (action.parameters.openInNewTab) {
                    await chrome.tabs.create({
                        url: response.url,
                    });
                } else {
                    await chrome.tabs.update(targetTab.id!, {
                        url: response.url,
                    });
                }

                confirmationMessage = `Navigated to the  ${action.parameters.keywords} link`;
            }
*/
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
     /*
        case "getHTML": {
            responseObject = await getTabHTMLFragments(
                targetTab,
                action.parameters.fullHTML,
                action.parameters.downloadAsFile,
                16000,
            );
            break;
        }
        case "getFilteredHTMLFragments": {
            const targetTab = await getActiveTab();

            responseObject = await getFilteredHTMLFragments(
                targetTab,
                action.parameters.fragments,
            );
            break;
        }
        */

        case "clickOnElement": {
            sendScriptAction({
                type: "run_ui_event",
                action: action,
            });
            break;
        }
        case "enterTextInElement": {
            sendScriptAction({
                type: "run_ui_event",
                action: action,
            });
            break;
        }
        case "enterTextOnPage": {
            sendScriptAction({
                type: "run_ui_event",
                action: action,
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

            // to do: update confirmation to include current page screenshot.
            break;
        }
        case "browserActionRequest.crossword": {
            sendScriptAction({
                type: "run_crossword_action",
                action: action,
            });

            // to do: update confirmation to include current page screenshot.
            break;
        }
        case "browserActionRequest.commerce": {
            sendScriptAction({
                type: "run_commerce_action",
                action: action,
            });

            // to do: update confirmation to include current page screenshot.
            break;
        }
    }

    return confirmationMessage;
}


contextBridge.exposeInMainWorld('browserConnect', {
    onMessage: (callback) => ipcRenderer.on('send-message-to-web', (_event, value) => callback(value)),
    sendMessage: (value) => {
        console.log(value);
        ipcRenderer.send("get-message-from-web", value);
    },
})


await ensureWebsocketConnected();

window.addEventListener('message', async (event) => {
    console.log(`Received message: ${event.data}`);

    if (event.data === 'page-to-bridge') {
        console.log("Message from page to bridge");
    }

  }, false);

window.postMessage("bridge-window-ready");

window.postMessage("initializeWorker")