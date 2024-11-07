// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketMessage } from "../../../../commonUtils/dist/indexBrowser";

async function getConfigValues(): Promise<Record<string, string>> {
    const envLocation = chrome.runtime.getURL(".env");
    const content = await fetch(envLocation);
    var vals: Record<string, string> = {};
    var text = await content.text();
    var lines = text.split(/[\r\n]+/g);
    for (var i = 0; i < lines.length; i++) {
        var splitPoint = lines[i].indexOf("=");
        var key = lines[i].substring(0, splitPoint).trim();
        var value = lines[i].substring(splitPoint + 1).trim();
        if (value.startsWith("'") || value.startsWith('"')) {
            value = value.slice(1, -1);
        }

        vals[key] = value;
    }

    return vals;
}

let webSocket: any = null;
let configValues: Record<string, string>;

export async function createWebSocket() {
    if (!configValues) {
        configValues = await getConfigValues();
    }

    let socketEndpoint =
        configValues["WEBSOCKET_HOST"] ?? "ws://localhost:8080/";

    socketEndpoint += "?clientId=" + chrome.runtime.id;
    return new Promise<WebSocket | undefined>((resolve, reject) => {
        const webSocket = new WebSocket(socketEndpoint);

        webSocket.onopen = (event: object) => {
            console.log("websocket open");
            resolve(webSocket);
        };
        webSocket.onmessage = (event: object) => {};
        webSocket.onclose = (event: object) => {
            console.log("websocket connection closed");
            resolve(undefined);
        };
        webSocket.onerror = (event: object) => {
            console.error("websocket error");
            resolve(undefined);
        };
    });
}

async function ensureWebsocketConnected() {
    return new Promise<WebSocket | undefined>(async (resolve, reject) => {
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
            showBadgeError();
            resolve(undefined);
            return;
        }

        webSocket.binaryType = "blob";
        keepWebSocketAlive(webSocket);

        webSocket.onmessage = async (event: any, isBinary: boolean) => {
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
                        showBadgeBusy();
                        console.log(`Initializing ${data.body.translator}`);
                    } else if (data.body.status == "initialized") {
                        showBadgeHealthy();
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
            console.log("websocket connection closed");
            webSocket = undefined;
            showBadgeError();
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
            showBadgeHealthy();
        } else {
            console.log("Retrying connection");
            await ensureWebsocketConnected();
        }
    }, 5 * 1000);
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
    let currentWindow = await chrome.windows.getCurrent();

    const [tab] = await chrome.tabs.query({
        active: true,
        windowId: currentWindow.id,
    });

    return tab;
}

async function getTabByTitle(title: string): Promise<chrome.tabs.Tab | null> {
    const getTabAction = {
        actionName: "getTabIdFromIndex",
        parameters: {
            query: title,
        },
    };
    const matchedId = await sendActionToTabIndex(getTabAction);
    if (matchedId) {
        const tabId = parseInt(matchedId);
        const targetTab = await chrome.tabs.get(tabId);
        return targetTab;
    } else {
        const tabs = await chrome.tabs.query({
            title: title,
        });

        if (tabs && tabs.length > 0) {
            return tabs[0];
        }
    }
    return null;
}

async function awaitPageLoad(targetTab: chrome.tabs.Tab) {
    return new Promise<string | undefined>((resolve, reject) => {
        if (targetTab.status == "complete") {
            resolve("OK");
        }

        const handler = (
            tabId: number,
            changeInfo: chrome.tabs.TabChangeInfo,
            tab: chrome.tabs.Tab,
        ) => {
            if (tabId == targetTab.id && tab.status == "complete") {
                chrome.tabs.onUpdated.removeListener(handler);
                resolve("OK");
            }
        };

        chrome.tabs.onUpdated.addListener(handler);
    });
}

async function getLatLongForLocation(locationName: string) {
    const vals = await getConfigValues();
    const mapsApiKey = vals["BING_MAPS_API_KEY"];
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

async function downloadStringAsFile(
    targetTab: chrome.tabs.Tab,
    data: string,
    filename: string,
) {
    const download = (data: string, filename: string) => {
        const link = document.createElement("a");
        link.href = "data:text/plain;charset=utf-8," + encodeURIComponent(data);
        link.download = filename;
        link.click();
    };

    await chrome.scripting.executeScript({
        func: download,
        target: { tabId: targetTab.id! },
        args: [data, filename],
    });
}

async function downloadImageAsFile(
    targetTab: chrome.tabs.Tab,
    dataUrl: string,
    filename: string,
) {
    const download = (dataUrl: string, filename: string) => {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = filename;
        link.click();
    };

    await chrome.scripting.executeScript({
        func: download,
        target: { tabId: targetTab.id! },
        args: [dataUrl, filename],
    });
}

async function getTabScreenshot(downloadImage: boolean) {
    const targetTab = await getActiveTab();

    //const dataUrl = await chrome.tabs.captureVisibleTab({quality:50});
    const dataUrl = await chrome.tabs.captureVisibleTab({ quality: 100 });
    if (downloadImage) {
        await downloadImageAsFile(targetTab, dataUrl, "test.jpg");
    }

    return dataUrl;
}

type BoundingBox = {
    top: number;
    left: number;
    bottom: number;
    right: number;
    selector?: string;
    index?: number;
};

async function getTabAnnotatedScreenshot(downloadImage: boolean) {
    const targetTab = await getActiveTab();

    const boundingBoxes = await chrome.tabs.sendMessage(targetTab.id!, {
        type: "get_element_bounding_boxes",
    });

    //const dataUrl = await chrome.tabs.captureVisibleTab({quality:50});
    const dataUrl = await chrome.tabs.captureVisibleTab(targetTab.windowId, {
        quality: 100,
    });
    if (downloadImage) {
        await downloadImageAsFile(targetTab, dataUrl, "tabScreenshot.jpg");
    }

    const annotate = async (dataUrl: string, boundingBoxes: any) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const loadImage = (url: string) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.addEventListener("load", () => resolve(img));
                img.addEventListener("error", (err) => reject(err));
                img.src = url;
            });

        const img = await loadImage(dataUrl);
        // pad image with 5 px all aaround?
        canvas.width = img.width + 10;
        canvas.height = img.height + 10;

        console.log(
            "Device pixel ratio: " + window.devicePixelRatio.toString(),
        );
        ctx?.drawImage(img, 5, 5, img.width, img.height);

        ctx?.scale(window.devicePixelRatio, window.devicePixelRatio);

        if (boundingBoxes && ctx) {
            const drawBoundingBox = (
                box: BoundingBox,
                color: string,
                padding: number,
                labelPosition:
                    | "topLeftOut"
                    | "bottomRightIn"
                    | "above"
                    | "rightOut"
                    | "middle"
                    | "none",
            ) => {
                ctx.lineWidth = 0;
                ctx.beginPath();
                ctx.rect(
                    box.left,
                    box.top,
                    box.right - box.left,
                    box.bottom - box.top,
                );
                ctx.strokeStyle = color;
                ctx.stroke();

                // draw number marker
                ctx.font = "16px Arial";
                ctx.textBaseline = "top";

                const text = box.index!.toString();
                // const text = Math.floor(box.left) +"x"+ Math.floor(box.top);
                // const text = box.selector!;
                var width = ctx.measureText(text).width;
                var height = 16;

                ctx.fillStyle = color;

                // add some padding for the number backplate
                // const textLeft = box.left + (box.right - box.left - width) / 2;
                // const textTop = box.top + (box.bottom - box.top - height) / 2;
                if (labelPosition !== "none") {
                    let textLeft = box.left;
                    let textTop = box.top;

                    switch (labelPosition) {
                        case "bottomRightIn": {
                            textLeft = box.right - width - padding;
                            textTop = box.bottom - height - padding / 2;
                            break;
                        }
                        case "middle": {
                            textLeft =
                                box.left + (box.right - box.left - width) / 2;
                            textTop =
                                box.top + (box.bottom - box.top - height) / 2;
                            break;
                        }
                        case "above": {
                            // textLeft = box.left;
                            textLeft =
                                box.left + (box.right - box.left - width) / 2;
                            textTop = box.top - height;
                            break;
                        }
                        case "rightOut": {
                            textLeft = box.right + 4;
                            // textTop = box.top;
                            textTop =
                                box.top + (box.bottom - box.top - height) / 2;
                            break;
                        }
                    }

                    // ctx.fillRect(box.left + padding - 2, box.top - height + padding - 4, width+4, height+4);
                    ctx.fillRect(
                        textLeft + padding - 2,
                        textTop + padding - 4,
                        width + 4,
                        height + 4,
                    );

                    ctx.fillStyle = "white";
                    // ctx.fillText(text, box.left + padding, box.top - height + padding);
                    ctx.fillText(text, textLeft + padding, textTop + padding);
                }
                ctx.restore();
            };

            console.log("Found bounding boxes");
            const labelPosition = "topLeftOut";
            boundingBoxes.textInput.forEach((box: BoundingBox) => {
                drawBoundingBox(box, "red", 5, labelPosition);
            });

            boundingBoxes.click.forEach((box: BoundingBox) => {
                drawBoundingBox(box, "blue", 5, labelPosition);
            });

            boundingBoxes.scroll.forEach((box: BoundingBox) => {
                drawBoundingBox(box, "green", 5, labelPosition);
            });

            boundingBoxes.rows.forEach((box: BoundingBox) => {
                drawBoundingBox(box, "green", 5, "rightOut");
            });

            boundingBoxes.cols.forEach((box: BoundingBox) => {
                drawBoundingBox(box, "green", 5, "above");
            });

            boundingBoxes.cells.forEach((box: BoundingBox) => {
                drawBoundingBox(box, "green", 5, "none");
            });
        } else {
            console.log("Did not Find bounding boxes");
        }

        // get image from canvas
        return canvas.toDataURL();
    };

    const annoatationResults = await chrome.scripting.executeScript({
        func: annotate,
        target: { tabId: targetTab.id! },
        args: [dataUrl, boundingBoxes],
    });

    if (annoatationResults) {
        const annotatedScreen = annoatationResults[0];
        if (downloadImage) {
            await downloadImageAsFile(
                targetTab,
                annotatedScreen.result,
                "testAnnotated.jpg",
            );
        }

        return annotatedScreen.result;
    }

    return dataUrl;
}

async function getTabAccessibilityTree(targetTab: chrome.tabs.Tab) {
    const debugTarget = { tabId: targetTab.id };
    try {
        await chrome.debugger.attach(debugTarget, "1.2");
        await chrome.debugger.sendCommand(debugTarget, "Accessibility.enable");

        const accessibilityTree = await chrome.debugger.sendCommand(
            debugTarget,
            "Accessibility.getFullAXTree",
        );
        console.log(accessibilityTree);

        const rootNode = (await chrome.debugger.sendCommand(
            debugTarget,
            "Accessibility.getRootAXNode",
        )) as any;
        console.log(rootNode);

        const partialTree = await chrome.debugger.sendCommand(
            debugTarget,
            "Accessibility.getPartialAXTree",
            { backendNodeId: rootNode.node.backendDOMNodeId },
        );
        console.log(partialTree);
    } finally {
        await chrome.debugger.detach(debugTarget);
    }
}

async function getTabHTML(
    targetTab: chrome.tabs.Tab,
    fullSize: boolean,
    downloadAsFile: boolean,
    useDebugAPI?: boolean,
) {
    if (!useDebugAPI) {
        let outerHTML = await chrome.tabs.sendMessage(targetTab.id!, {
            type: "get_reduced_html",
            fullSize: fullSize,
            frameId: 0,
        });

        if (downloadAsFile) {
            await downloadStringAsFile(targetTab, outerHTML, "tabHTML.html");
        }

        return outerHTML;
    } else {
        const debugTarget = { tabId: targetTab.id };
        try {
            await chrome.debugger.attach(debugTarget, "1.2");
            await chrome.debugger.sendCommand(debugTarget, "DOM.enable");

            const rootNode = (await chrome.debugger.sendCommand(
                debugTarget,
                "DOM.getDocument",
                { depth: -1, pierce: true },
            )) as any;
            console.log(rootNode);

            let outerHTML = (await chrome.debugger.sendCommand(
                debugTarget,
                "DOM.getOuterHTML",
                { backendNodeId: rootNode.root.backendNodeId },
            )) as any;

            if (!fullSize) {
                outerHTML = await chrome.tabs.sendMessage(targetTab.id!, {
                    type: "get_reduced_html",
                    inputHtml: outerHTML.outerHTML,
                });
            }

            if (downloadAsFile) {
                await downloadStringAsFile(
                    targetTab,
                    outerHTML,
                    "tabHTML.html",
                );
            }

            return outerHTML;
        } finally {
            await chrome.debugger.detach(debugTarget);
        }
    }

    return undefined;
}

async function getTabHTMLFragments(
    targetTab: chrome.tabs.Tab,
    fullSize: boolean,
    downloadAsFile: boolean,
    maxFragmentSize: 16000,
) {
    const frames = await chrome.webNavigation.getAllFrames({
        tabId: targetTab.id!,
    });
    let htmlFragments: any[] = [];
    if (frames) {
        for (let i = 0; i < frames?.length; i++) {
            if (frames[i].url == "about:blank") {
                continue;
            }
            try {
                const frameHTML = await chrome.tabs.sendMessage(
                    targetTab.id!,
                    {
                        type: "get_reduced_html",
                        fullSize: fullSize,
                        frameId: frames[i].frameId,
                    },
                    { frameId: frames[i].frameId },
                );

                if (frameHTML) {
                    const frameText = await chrome.tabs.sendMessage(
                        targetTab.id!,
                        {
                            type: "get_page_text",
                            inputHtml: frameHTML,
                            frameId: frames[i].frameId,
                        },
                        { frameId: frames[i].frameId },
                    );

                    if (downloadAsFile) {
                        await downloadStringAsFile(
                            targetTab,
                            frameHTML,
                            `tabHTML_${frames[i].frameId}.html`,
                        );

                        await downloadStringAsFile(
                            targetTab,
                            frameText,
                            `tabText_${frames[i].frameId}.txt`,
                        );
                    }

                    htmlFragments.push({
                        frameId: frames[i].frameId,
                        content: frameHTML,
                        text: frameText,
                    });
                }
            } catch {}
        }
    }

    return htmlFragments;
}

async function getTabHTMLFragmentsBySize(
    targetTab: chrome.tabs.Tab,
    fullSize: boolean,
    downloadAsFile: boolean,
    maxFragmentSize: 16000,
) {
    const frames = await chrome.webNavigation.getAllFrames({
        tabId: targetTab.id!,
    });
    let htmlFragments: any[] = [];
    if (frames) {
        for (let i = 0; i < frames?.length; i++) {
            if (frames[i].url == "about:blank") {
                continue;
            }
            try {
                const frameFragments = await chrome.tabs.sendMessage(
                    targetTab.id!,
                    {
                        type: "get_maxSize_html_fragments",
                        frameId: frames[i].frameId,
                        maxFragmentSize: 16000,
                    },
                    { frameId: frames[i].frameId },
                );

                if (frameFragments) {
                    if (downloadAsFile) {
                        for (let j = 0; j < frameFragments.length; j++) {
                            await downloadStringAsFile(
                                targetTab,
                                frameFragments[j].content,
                                `tabHTML_${frames[i].frameId}_${j}.html`,
                            );
                        }
                    }

                    htmlFragments = htmlFragments.concat(frameFragments);
                }
            } catch {}
        }
    }

    return htmlFragments;
}

async function getFilteredHTMLFragments(
    targetTab: chrome.tabs.Tab,
    inputHtmlFragments: any[],
) {
    let htmlFragments: any[] = [];

    for (let i = 0; i < inputHtmlFragments.length; i++) {
        try {
            const frameHTMLFragments = await chrome.tabs.sendMessage(
                targetTab.id!,
                {
                    type: "get_filtered_html_fragments",
                    inputHtml: inputHtmlFragments[i].content,
                    cssSelectors: [
                        inputHtmlFragments[i].cssSelectorAcross,
                        inputHtmlFragments[i].cssSelectorDown,
                    ].join(", "),
                    frameId: inputHtmlFragments[i].frameId,
                },
                { frameId: inputHtmlFragments[i].frameId },
            );

            if (frameHTMLFragments) {
                htmlFragments.push(...frameHTMLFragments);
            }
        } catch {}
    }

    return htmlFragments;
}

let currentSiteTranslator = "";
let currentCrosswordUrl = "";
async function toggleSiteTranslator(targetTab: chrome.tabs.Tab) {
    let messageType = "enableSiteTranslator";
    let messageBody = "";
    if (targetTab.url) {
        const host = new URL(targetTab.url).host;

        if (host === "paleobiodb.org" || host === "www.paleobiodb.org") {
            messageType = "enableSiteTranslator";
            messageBody = "browser.paleoBioDb";
            currentSiteTranslator = "browser.paleoBioDb";
        } else {
            if (currentSiteTranslator == "browser.paleoBioDb") {
                messageType = "disableSiteTranslator";
                messageBody = "browser.paleoBioDb";
            }
        }

        if (
            targetTab.url.startsWith("https://embed.universaluclick.com/") ||
            targetTab.url.startsWith(
                "https://data.puzzlexperts.com/puzzleapp",
            ) ||
            targetTab.url.startsWith("https://nytsyn.pzzl.com/cwd_seattle") ||
            targetTab.url.startsWith("https://www.wsj.com/puzzles/crossword") ||
            targetTab.url.startsWith(
                "https://www.seattletimes.com/games-nytimes-crossword",
            ) ||
            targetTab.url.startsWith(
                "https://www.denverpost.com/games/daily-crossword",
            ) ||
            targetTab.url.startsWith(
                "https://www.bestcrosswords.com/bestcrosswords/guestconstructor",
            )
        ) {
            messageType = "enableSiteTranslator";
            messageBody = "browser.crossword";
            currentSiteTranslator = "browser.crossword";
            currentCrosswordUrl = targetTab.url;
        }

        const commerceHosts = [
            "www.homedepot.com",
            "www.target.com",
            "www.walmart.com",
            "www.instacart.com",
        ];

        if (commerceHosts.includes(host)) {
            messageType = "enableSiteTranslator";
            messageBody = "browser.commerce";
            currentSiteTranslator = "browser.commerce";
        }

        // trigger translator change
        if (
            webSocket &&
            webSocket.readyState === WebSocket.OPEN &&
            messageBody
        ) {
            webSocket.send(
                JSON.stringify({
                    source: "browser",
                    target: "dispatcher",
                    messageType: messageType,
                    body: messageBody,
                }),
            );
        }
    }
}

async function sendActionToTabIndex(action: any) {
    return new Promise<string | undefined>((resolve, reject) => {
        if (webSocket) {
            try {
                const callId = new Date().getTime().toString();
                const messageType = "tabIndexRequest";

                webSocket.send(
                    JSON.stringify({
                        source: "browser",
                        target: "dispatcher",
                        messageType: messageType,
                        id: callId,
                        body: action,
                    }),
                );

                const handler = async (event: any) => {
                    const text = await event.data.text();
                    const data = JSON.parse(text) as WebSocketMessage;
                    if (
                        data.target == "browser" &&
                        data.source == "dispatcher" &&
                        data.id == callId &&
                        data.body
                    ) {
                        switch (data.messageType) {
                            case "tabIndexResponse": {
                                webSocket.removeEventListener(
                                    "message",
                                    handler,
                                );
                                resolve(data.body);
                                break;
                            }
                        }
                    }
                };

                webSocket.addEventListener("message", handler);
            } catch {
                reject("Unable to contact dispatcher backend.");
            }
        } else {
            throw new Error("No websocket connection.");
        }
    });
}

async function runBrowserAction(action: any) {
    let responseObject = undefined;
    let confirmationMessage = "OK";
    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);
    switch (actionName) {
        case "openTab": {
            if (action.parameters.url) {
                await chrome.tabs.create({
                    url: action.parameters.url,
                });

                confirmationMessage = `Opened new tab to  ${action.parameters.url}`;
            } else {
                if (action.parameters.query) {
                    await chrome.search.query({
                        disposition: "NEW_TAB",
                        text: action.parameters.query,
                    });

                    confirmationMessage = `Opened new tab with query  ${action.parameters.query}`;
                } else {
                    await chrome.tabs.create({});
                    confirmationMessage = "Opened new tab ";
                }
            }

            break;
        }
        case "closeTab": {
            let targetTab: chrome.tabs.Tab | null = null;
            if (action.parameters.title) {
                targetTab = await getTabByTitle(action.parameters.title);
            } else {
                targetTab = await getActiveTab();
            }

            if (targetTab && targetTab.id) {
                await chrome.tabs.remove(targetTab.id);
            }
            confirmationMessage = "Closed tab";
            break;
        }
        case "switchToTabByText": {
            const targetTab = await getTabByTitle(action.parameters.keywords);
            if (targetTab) {
                await chrome.tabs.update(targetTab.id!, {
                    active: true,
                });

                confirmationMessage = "Switched to tab";
            }

            break;
        }
        case "search": {
            await chrome.search.query({
                disposition: "NEW_TAB",
                text: action.parameters.query,
            });

            confirmationMessage = `Opened new tab with query  ${action.parameters.query}`;
            break;
        }
        case "followLinkByText": {
            const targetTab = await getActiveTab();
            const response = await chrome.tabs.sendMessage(targetTab.id!, {
                type: "get_page_links_by_query",
                query: action.parameters.keywords,
            });

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

            break;
        }
        case "followLinkByPosition": {
            const targetTab = await getActiveTab();
            const response = await chrome.tabs.sendMessage(targetTab.id!, {
                type: "get_page_links_by_position",
                position: action.parameters.position,
            });

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

                confirmationMessage = `Navigated to the  ${action.parameters.position} link`;
            }

            break;
        }
        case "scrollDown": {
            const targetTab = await getActiveTab();
            await chrome.tabs.sendMessage(targetTab.id!, {
                type: "scroll_down_on_page",
            });
            break;
        }
        case "scrollUp": {
            const targetTab = await getActiveTab();
            await chrome.tabs.sendMessage(targetTab.id!, {
                type: "scroll_up_on_page",
            });
            break;
        }
        case "goBack": {
            const targetTab = await getActiveTab();
            await chrome.tabs.goBack(targetTab.id!);
            break;
        }
        case "goForward": {
            const targetTab = await getActiveTab();
            await chrome.tabs.goForward(targetTab.id!);
            break;
        }
        case "openFromHistory": {
            const targetTab = await getActiveTab();
            const historyItems = await chrome.history.search({
                text: action.parameters.keywords,
                maxResults: 1,
            });

            if (historyItems && historyItems.length > 0) {
                console.log(historyItems);
                if (targetTab.id) {
                    chrome.tabs.update(targetTab.id, {
                        url: historyItems[0].url,
                    });
                } else {
                    chrome.tabs.create({
                        url: historyItems[0].url,
                    });
                }
            }

            break;
        }
        case "openFromBookmarks": {
            const OpenFromBookmarksItems = await chrome.bookmarks.search({
                query: action.parameters.keywords,
            });

            if (OpenFromBookmarksItems) {
                console.log(OpenFromBookmarksItems);
                await chrome.tabs.create({
                    url: OpenFromBookmarksItems[0].url,
                });
            }

            break;
        }
        case "readPage": {
            const targetTab = await getActiveTab();
            const article = await chrome.tabs.sendMessage(targetTab.id!, {
                type: "read_page_content",
            });

            if (article.error) {
                confirmationMessage = article.error;
            }

            if (article?.title) {
                chrome.tts.speak(article?.title, { lang: article?.lang });
            }

            if (article?.formattedText) {
                const lines = article.formattedText as string[];
                lines.forEach((line) => {
                    chrome.tts.speak(line, {
                        lang: article?.lang,
                        enqueue: true,
                    });
                });
            }

            console.log(article);
            break;
        }
        case "stopReadPage": {
            chrome.tts.stop();
            break;
        }
        case "zoomIn": {
            const targetTab = await getActiveTab();
            if (targetTab.url?.startsWith("https://paleobiodb.org/")) {
                const result = await chrome.tabs.sendMessage(targetTab.id!, {
                    type: "run_paleoBioDb_action",
                    action: action,
                });
            } else {
                const currentZoom = await chrome.tabs.getZoom();
                if (currentZoom < 5) {
                    var stepValue = 1;
                    if (currentZoom < 2) {
                        stepValue = 0.25;
                    }

                    await chrome.tabs.setZoom(currentZoom + stepValue);
                }
            }

            break;
        }
        case "zoomOut": {
            const targetTab = await getActiveTab();
            if (targetTab.url?.startsWith("https://paleobiodb.org/")) {
                const result = await chrome.tabs.sendMessage(targetTab.id!, {
                    type: "run_paleoBioDb_action",
                    action: action,
                });
            } else {
                const currentZoom = await chrome.tabs.getZoom();
                if (currentZoom > 0) {
                    var stepValue = 1;
                    if (currentZoom < 2) {
                        stepValue = 0.25;
                    }

                    await chrome.tabs.setZoom(currentZoom - stepValue);
                }
            }
            break;
        }
        case "zoomReset": {
            await chrome.tabs.setZoom(0);
            break;
        }
        case "captureScreenshot": {
            responseObject = await getTabScreenshot(
                action.parameters.downloadAsFile,
            );
            break;
        }

        case "captureAnnotatedScreenshot": {
            responseObject = await getTabAnnotatedScreenshot(
                action.parameters.downloadAsFile,
            );
            break;
        }

        case "getUITree": {
            const targetTab = await getActiveTab();
            responseObject = await getTabAccessibilityTree(targetTab);
            break;
        }
        case "getHTML": {
            const targetTab = await getActiveTab();

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
        case "getPageUrl": {
            const targetTab = await getActiveTab();
            responseObject = targetTab.url;
            break;
        }
        case "awaitPageLoad": {
            const targetTab = await getActiveTab();
            await awaitPageLoad(targetTab);
            responseObject = targetTab.url;
            break;
        }
        case "clickOnElement": {
            const targetTab = await getActiveTab();
            const response = await chrome.tabs.sendMessage(targetTab.id!, {
                type: "run_ui_event",
                action: action,
            });
            break;
        }
        case "enterTextInElement": {
            const targetTab = await getActiveTab();
            const response = await chrome.tabs.sendMessage(targetTab.id!, {
                type: "run_ui_event",
                action: action,
            });
            break;
        }
        case "enterTextOnPage": {
            const targetTab = await getActiveTab();
            const response = await chrome.tabs.sendMessage(targetTab.id!, {
                type: "run_ui_event",
                action: action,
            });
            break;
        }
        case "getPageSchema": {
            const targetTab = await getActiveTab();
            const key = action.parameters.url ?? targetTab.url;
            const value = await chrome.storage.session.get(["pageSchema"]);
            if (value && Array.isArray(value.pageSchema)) {
                const targetSchema = value.pageSchema.filter(
                    (c: { url: any }) => c.url === key,
                );

                // TODO: Need to invalidate schema cache if html changes
                if (targetSchema && targetSchema.length > 0) {
                    responseObject = targetSchema[0].body;
                    showBadgeHealthy();
                }
            }

            break;
        }
        case "setPageSchema": {
            const key = action.parameters.url;
            let value = await chrome.storage.session.get(["pageSchema"]);
            let updatedSchema = value.pageSchema;
            if (value && Array.isArray(value.pageSchema)) {
                updatedSchema = value.pageSchema.filter(
                    (c: { url: any }) => c.url !== key,
                );
            } else {
                updatedSchema = [];
            }

            updatedSchema.push({
                url: key,
                body: action.parameters.schema,
            });

            await chrome.storage.session.set({ pageSchema: updatedSchema });

            break;
        }
        case "getConfiguration": {
            responseObject = await getConfigValues();
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
            const targetTab = await getActiveTab();
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

            const result = await chrome.tabs.sendMessage(targetTab.id!, {
                type: "run_paleoBioDb_action",
                action: action,
            });

            // to do: update confirmation to include current page screenshot.
            break;
        }
        case "browserActionRequest.crossword": {
            const targetTab = await getActiveTab();

            const result = await chrome.tabs.sendMessage(targetTab.id!, {
                type: "run_crossword_action",
                action: action,
            });

            // to do: update confirmation to include current page screenshot.
            break;
        }
        case "browserActionRequest.commerce": {
            const targetTab = await getActiveTab();

            const result = await chrome.tabs.sendMessage(targetTab.id!, {
                type: "run_commerce_action",
                action: action,
            });

            // to do: update confirmation to include current page screenshot.
            break;
        }
    }

    return confirmationMessage;
}

function showBadgeError() {
    chrome.action.setBadgeBackgroundColor({ color: "#F00" }, () => {
        chrome.action.setBadgeText({ text: "!" });
    });
}

function showBadgeHealthy() {
    chrome.action.setBadgeText({
        text: "",
    });
}

function showBadgeBusy() {
    chrome.action.setBadgeBackgroundColor({ color: "#0000FF" }, () => {
        chrome.action.setBadgeText({ text: "..." });
    });
}

chrome.action?.onClicked.addListener(async (tab) => {
    try {
        const connected = await ensureWebsocketConnected();
        if (!connected) {
            reconnectWebSocket();
            showBadgeError();
        } else {
            await toggleSiteTranslator(tab);
            showBadgeHealthy();
        }
    } catch {
        reconnectWebSocket();
        showBadgeError();
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const targetTab = await chrome.tabs.get(activeInfo.tabId);
    await toggleSiteTranslator(targetTab);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.active) {
        await toggleSiteTranslator(tab);
    }
    if (changeInfo.title) {
        const addTabAction = {
            actionName: "addTabIdToIndex",
            parameters: {
                id: tab.id,
                title: tab.title,
            },
        };
        await sendActionToTabIndex(addTabAction);
    }
});

chrome.tabs.onCreated.addListener(async (tab) => {
    const addTabAction = {
        actionName: "addTabIdToIndex",
        parameters: {
            id: tab.id,
            title: tab.title,
        },
    };
    await sendActionToTabIndex(addTabAction);
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    const removeTabAction = {
        actionName: "deleteTabIdFromIndex",
        parameters: {
            id: tabId,
        },
    };
    await sendActionToTabIndex(removeTabAction);
});

let embeddingsInitializedWindowId: number;
chrome.windows?.onFocusChanged.addListener(async (windowId) => {
    if (windowId == chrome.windows.WINDOW_ID_NONE) {
        return;
    }

    const connected = await ensureWebsocketConnected();
    if (!connected) {
        reconnectWebSocket();
        showBadgeError();
    }

    const targetTab = await getActiveTab();
    await toggleSiteTranslator(targetTab);

    if (embeddingsInitializedWindowId !== windowId) {
        const tabs = await chrome.tabs.query({
            windowId: windowId,
        });
        tabs.forEach(async (tab) => {
            const addTabAction = {
                actionName: "addTabIdToIndex",
                parameters: {
                    id: tab.id,
                    title: tab.title,
                },
            };
            await sendActionToTabIndex(addTabAction);
        });

        embeddingsInitializedWindowId = windowId;
    }
});

chrome.windows?.onCreated.addListener(async (windowId) => {
    console.log("Window Created");
});

chrome.windows?.onRemoved.addListener(async (windowId) => {
    console.log("Window Removed");
});

chrome.runtime.onStartup.addListener(async () => {
    console.log("Browser Agent Service Worker started");
    try {
        const connected = await ensureWebsocketConnected();
        if (!connected) {
            reconnectWebSocket();
            showBadgeError();
        }
    } catch {
        reconnectWebSocket();
    }
});

chrome.runtime.onMessageExternal.addListener(
    (message: any, sender: chrome.runtime.MessageSender, sendResponse) => {
        async () => {
            switch (message.type) {
                case "crosswordAction": {
                    const respose = await runBrowserAction(message.body);
                    sendResponse(respose);
                    break;
                }
            }
        };
    },
);

chrome.runtime.onMessage.addListener(
    (message: any, sender: chrome.runtime.MessageSender, sendResponse) => {
        async () => {
            switch (message.type) {
                case "initialize": {
                    console.log("Browser Agent Service Worker started");
                    try {
                        const connected = await ensureWebsocketConnected();
                        if (!connected) {
                            reconnectWebSocket();
                            showBadgeError();
                        }
                    } catch {
                        reconnectWebSocket();
                    }

                    sendResponse("Service worker initialize called");
                    break;
                }
            }
        };
    },
);

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        title: "Refresh crossword agent",
        id: "reInitCrosswordPage",
    });

    chrome.contextMenus.create({
        title: "Clear crossword cache",
        id: "clearCrosswordPageCache",
    });
});

chrome.contextMenus?.onClicked.addListener(
    async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
        if (tab == undefined) {
            return;
        }

        switch (info.menuItemId) {
            case "reInitCrosswordPage": {
                // insert site-specific script
                await chrome.tabs.sendMessage(tab.id!, {
                    type: "setup_UniversalCrossword",
                });

                // trigger translator
                if (webSocket && webSocket.readyState === WebSocket.OPEN) {
                    webSocket.send(
                        JSON.stringify({
                            source: "browser",
                            target: "dispatcher",
                            messageType: "enableSiteTranslator",
                            body: "browser.crossword",
                        }),
                    );
                }

                break;
            }
            case "clearCrosswordPageCache": {
                // remove cached schema for current tab
                const key = tab.url;
                const value = await chrome.storage.session.get(["pageSchema"]);
                if (value && Array.isArray(value.pageSchema)) {
                    const updatedSchema = value.pageSchema.filter(
                        (c: { url: any }) => c.url !== key,
                    );

                    await chrome.storage.session.set({
                        pageSchema: updatedSchema,
                    });
                } else {
                    await chrome.storage.session.set({
                        pageSchema: [],
                    });
                }

                break;
            }
        }
    },
);
