// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const { contextBridge } = require("electron/renderer");
const { webFrame } = require("electron");

import DOMPurify from "dompurify";
import { ipcRenderer } from "electron";

ipcRenderer.on("received-from-browser-ipc", async (_, data) => {
    if (data.target == "browser") {
        if (data.messageType == "browserActionRequest") {
            const response = await runBrowserAction(data.body);
            sendToBrowserAgent({
                source: data.target,
                target: data.source,
                messageType: "browserActionResponse",
                id: data.id,
                body: response,
            });
        } else if (data.messageType == "siteTranslatorStatus") {
            if (data.body.status == "initializing") {
                console.log(`Initializing ${data.body.translator}`);
            } else if (data.body.status == "initialized") {
                console.log(`Finished initializing ${data.body.translator}`);
            }
        } else if (data.messageType.startsWith("browserActionRequest.")) {
            const message = await runSiteAction(data.messageType, data.body);

            sendToBrowserAgent({
                source: data.target,
                target: data.source,
                messageType: "browserActionResponse",
                id: data.id,
                body: message,
            });
        }

        console.log(
            `Browser websocket client received message: ${JSON.stringify(data)}`,
        );
    }
});

ipcRenderer.on("init-site-agent", () => {
    window.postMessage("setupSiteAgent");
});

function sendToBrowserAgent(message: any) {
    ipcRenderer.send("send-to-browser-ipc", message);
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

export async function getTabHTMLFragments(fullSize: boolean) {
    let htmlFragments: any[] = [];
    let htmlPromises: Promise<any>[] = [];

    htmlPromises.push(
        sendScriptAction(
            {
                type: "get_reduced_html",
                fullSize: fullSize,
                frameId: 0,
            },
            50000,
            window.top,
            "0",
        ),
    );

    const iframeElements = document.getElementsByTagName("iframe");
    for (let i = 0; i < iframeElements.length; i++) {
        const frameElement = iframeElements[i];
        if (
            !frameElement.src ||
            frameElement.src == "about:blank" ||
            frameElement.hidden ||
            (frameElement.clientHeight == 0 && frameElement.clientWidth == 0)
        ) {
            continue;
        }

        const index = i + 1;
        htmlPromises.push(
            sendScriptAction(
                {
                    type: "get_reduced_html",
                    fullSize: fullSize,
                    frameId: index,
                },
                50000,
                frameElement.contentWindow,
                index.toString(),
            ),
        );
    }

    const htmlResults = await Promise.all(htmlPromises);
    for (let i = 0; i < htmlResults.length; i++) {
        const frameHTML = htmlResults[i];
        if (frameHTML) {
            const frameText = await sendScriptAction(
                {
                    type: "get_page_text",
                    inputHtml: frameHTML,
                    frameId: i,
                },
                1000,
                frames[i],
            );

            htmlFragments.push({
                frameId: i,
                content: frameHTML,
                text: frameText,
            });
        }
    }

    return htmlFragments;
}

export async function sendScriptAction(
    body: any,
    timeout?: number,
    frameWindow?: Window | null,
    idPrefix?: string,
) {
    const timeoutPromise = new Promise((f) => setTimeout(f, timeout));

    const targetWindow = frameWindow ?? window;

    const actionPromise = new Promise<any | undefined>((resolve) => {
        let callId = new Date().getTime().toString();
        if (idPrefix) {
            callId = idPrefix + "_" + callId;
        }

        targetWindow.postMessage(
            {
                source: "preload",
                target: "contentScript",
                messageType: "scriptActionRequest",
                id: callId,
                body: body,
            },
            "*",
        );

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

export async function sendScriptActionToAllFrames(body: any, timeout?: number) {
    const frames = [window.top, ...Array.from(window.frames)];

    let htmlPromises: Promise<any>[] = [];
    frames.forEach((frame, index) => {
        htmlPromises.push(
            sendScriptAction(body, timeout, frame, index.toString()),
        );
    });

    return await Promise.all(htmlPromises);
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
                const sanitizedUrl = DOMPurify.sanitize(response.url);
                window.location.href = sanitizedUrl;
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
                const currZoom = webFrame.getZoomFactor();
                webFrame.setZoomFactor(currZoom + 0.2);
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
                const currZoom = webFrame.getZoomFactor();
                webFrame.setZoomFactor(currZoom - 0.2);
            }
            break;
        }
        case "zoomReset": {
            webFrame.setZoomFactor(1.0);
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
            sendScriptActionToAllFrames({
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
        case "reloadPage": {
            sendScriptAction({
                type: "clear_page_schema",
            });
            location.reload();
            break;
        }
        case "closeWindow": {
            window.close();
            // todo: call method on IPC process to close the window/view

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

await ipcRenderer.invoke("init-browser-ipc");

contextBridge.exposeInMainWorld("browserConnect", {
    enableSiteAgent: (translatorName) => {
        if (translatorName) {
            sendToBrowserAgent({
                source: "browser",
                target: "dispatcher",
                messageType: "enableSiteTranslator",
                body: translatorName,
            });
        }
    },
    disableSiteAgent: (translatorName) => {
        if (translatorName) {
            sendToBrowserAgent({
                source: "browser",
                target: "dispatcher",
                messageType: "disableSiteTranslator",
                body: translatorName,
            });
        }
    },
});

window.onbeforeunload = () => {
    window.postMessage("disableSiteAgent");
};
