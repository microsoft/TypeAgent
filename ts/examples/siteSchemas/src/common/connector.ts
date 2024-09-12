// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WebSocketMessage,
    createWebSocket,
    keepWebSocketAlive,
} from "common-utils";

import WebSocket from "ws";

export async function createBrowserConnector(
    siteClientName: string,
    translatedActionCallback: ((action: any) => void) | undefined,
    userMessageCallback: ((message: string) => void) | undefined,
) {
    const connector = new BrowserConnector(siteClientName);
    await connector.initialize();
    if (translatedActionCallback) {
        connector.onTranslatedActionMessage(translatedActionCallback);
    }

    if (userMessageCallback) {
        connector.onUserRequestMessage(userMessageCallback);
    }

    return connector;
}

export class BrowserConnector {
    private webSocket: any;
    private siteClientName: string;
    private siteTranslatedActionName: string;
    private translatedActionCallback: ((action: any) => void) | undefined;
    private userMessageCallback: ((message: string) => void) | undefined;

    constructor(siteClientName: string) {
        this.webSocket = null;
        this.siteClientName = siteClientName;
        this.siteTranslatedActionName = `browserActionRequest.${siteClientName}`;
    }

    onTranslatedActionMessage(callback: (action: any) => void) {
        this.translatedActionCallback = callback;
    }

    onUserRequestMessage(callback: (message: string) => void) {
        this.userMessageCallback = callback;
    }

    async initialize() {
        await this.ensureWebsocketConnected();
        if (!this.webSocket) {
            console.log("Websocket service not found. Will retry in 5 seconds");
            this.reconnectWebSocket();
        }
    }

    private async ensureWebsocketConnected() {
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            return;
        }

        this.webSocket = await createWebSocket();
        if (!this.webSocket) {
            return;
        }

        this.webSocket.binaryType = "blob";
        keepWebSocketAlive(this.webSocket, this.siteClientName);

        this.webSocket.addEventListener("message", async (event: any) => {
            const text = event.data.toString();
            const data = JSON.parse(text) as WebSocketMessage;
            if (
                data.target == this.siteClientName &&
                data.source == "dispatcher"
            ) {
                console.log(
                    `${this.siteClientName} websocket client received message: ${text}`,
                );

                let message = "";
                if (data.messageType === this.siteTranslatedActionName) {
                    if (this.translatedActionCallback) {
                        this.translatedActionCallback(data.body);
                    }
                } else {
                    if (this.userMessageCallback) {
                        this.userMessageCallback(data.body);
                    }
                }
                this.webSocket.send(
                    JSON.stringify({
                        source: data.target,
                        target: data.source,
                        messageType: "browserActionRequest",
                        id: data.id,
                        body: message,
                    }),
                );
            }
        });

        this.webSocket.onclose = (event: any) => {
            console.log("websocket connection closed");
            this.webSocket = undefined;
            this.reconnectWebSocket();
        };
    }

    private reconnectWebSocket() {
        const connectionCheckIntervalId = setInterval(async () => {
            if (
                this.webSocket &&
                this.webSocket.readyState === WebSocket.OPEN
            ) {
                console.log("Clearing reconnect retry interval");
                clearInterval(connectionCheckIntervalId);
            } else {
                console.log("Retrying connection");
                await this.ensureWebsocketConnected();
            }
        }, 5 * 1000);
    }

    async sendActionToBrowserAgent(action: any, messageType?: string) {
        return new Promise<any | undefined>((resolve, reject) => {
            if (this.webSocket) {
                try {
                    messageType = messageType ?? this.siteTranslatedActionName;

                    const callId = new Date().getTime().toString();

                    this.webSocket.send(
                        JSON.stringify({
                            source: this.siteClientName,
                            target: "browser",
                            messageType: messageType,
                            id: callId,
                            body: action,
                        }),
                    );

                    const handler = (event: any) => {
                        const text = event.data.toString();
                        const data = JSON.parse(text) as WebSocketMessage;
                        if (
                            data.target == this.siteClientName &&
                            data.source == "browser" &&
                            data.messageType == "browserActionResponse" &&
                            data.id == callId &&
                            data.body
                        ) {
                            this.webSocket.removeEventListener(
                                "message",
                                handler,
                            );
                            resolve(data.body);
                        }
                    };

                    this.webSocket.addEventListener("message", handler);
                } catch {
                    console.log("Unable to contact browser agent.");
                    reject("Unable to contact browser agent.");
                }
            }
        });
    }

    private async getPageDataFromBrowser(action: any) {
        return new Promise<string | undefined>(async (resolve, reject) => {
            const response = await this.sendActionToBrowserAgent(
                action,
                "browserActionRequest",
            );
            if (response.data) {
                resolve(response.data);
            } else {
                resolve(undefined);
            }
        });
    }

    async getHtmlFragments() {
        const timeoutPromise = new Promise((f) => setTimeout(f, 3000));
        const htmlAction = {
            actionName: "getHTML",
            parameters: {
                fullHTML: false,
                downloadAsFile: false,
            },
        };

        const actionPromise = this.getPageDataFromBrowser(htmlAction);
        const liveHtml = await Promise.race([actionPromise, timeoutPromise]);
        if (liveHtml && Array.isArray(liveHtml)) {
            return liveHtml;
        }

        return [];
    }

    async getFilteredHtmlFragments(inputHtmlFragments: any[]) {
        let htmlFragments: any[] = [];
        const timeoutPromise = new Promise((f) => setTimeout(f, 3000));
        const filterAction = {
            actionName: "getFilteredHTMLFragments",
            parameters: {
                fragments: inputHtmlFragments,
            },
        };

        const actionPromise = this.getPageDataFromBrowser(filterAction);
        const result = await Promise.race([actionPromise, timeoutPromise]);

        if (result && Array.isArray(result)) {
            htmlFragments = result;
        }

        return htmlFragments;
    }

    async getCurrentPageScreenshot() {
        const timeoutPromise = new Promise((f) => setTimeout(f, 3000));
        const screenshotAction = {
            actionName: "captureScreenshot",
            parameters: {
                downloadAsFile: false,
            },
        };

        const actionPromise = this.getPageDataFromBrowser(screenshotAction);
        let screenshot = "";
        const liveScreenshot = await Promise.race([
            actionPromise,
            timeoutPromise,
        ]);

        if (liveScreenshot && typeof liveScreenshot == "string") {
            screenshot = liveScreenshot;
        }

        return screenshot;
    }

    async getCurrentPageAnnotatedScreenshot() {
        const timeoutPromise = new Promise((f) => setTimeout(f, 3000));
        const screenshotAction = {
            actionName: "captureAnnotatedScreenshot",
            parameters: {
                downloadAsFile: true,
            },
        };

        const actionPromise = this.getPageDataFromBrowser(screenshotAction);
        let screenshot = "";
        const liveScreenshot = await Promise.race([
            actionPromise,
            timeoutPromise,
        ]);

        if (liveScreenshot && typeof liveScreenshot == "string") {
            screenshot = liveScreenshot;
        }

        return screenshot;
    }

    async getCurrentPageSchema() {
        const timeoutPromise = new Promise((f) => setTimeout(f, 3000));
        const action = {
            actionName: "getPageSchema",
            parameters: {},
        };

        const actionPromise = this.getPageDataFromBrowser(action);
        return Promise.race([actionPromise, timeoutPromise]);
    }

    async setCurrentPageSchema(url: string, data: any) {
        const schemaAction = {
            actionName: "setPageSchema",
            parameters: {
                url: url,
                schema: data,
            },
        };

        return this.sendActionToBrowserAgent(schemaAction);
    }

    async getPageUrl() {
        const action = {
            actionName: "getPageUrl",
            parameters: {},
        };

        return this.getPageDataFromBrowser(action);
    }

    async clickOn(cssSelector: string) {
        const clickAction = {
            actionName: "clickOnElement",
            parameters: {
                cssSelector: cssSelector,
            },
        };
        return this.sendActionToBrowserAgent(clickAction);
    }

    async enterTextIn(textValue: string, cssSelector?: string) {
        const textAction = {
            actionName: "enterText",
            parameters: {
                value: textValue,
                cssSelector: cssSelector,
            },
        };

        return this.sendActionToBrowserAgent(textAction);
    }

    async awaitPageLoad() {
        const action = {
            actionName: "awaitPageLoad",
            parameters: {},
        };

        return this.sendActionToBrowserAgent(action, "translatedAction");
    }
}
