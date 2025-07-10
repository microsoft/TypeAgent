// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAction, SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "./actionHandler.mjs";

export class BrowserConnector {
    private webSocket: any;

    constructor(context: SessionContext<BrowserActionContext>) {
        this.webSocket = context.agentContext.webSocket;
    }

    async sendActionToBrowser(action: AppAction, schemaName?: string) {
        return new Promise<any | undefined>((resolve, reject) => {
            if (this.webSocket) {
                try {
                    const callId = new Date().getTime().toString();
                    if (!schemaName) {
                        schemaName = "browser";
                    }

                    this.webSocket.send(
                        JSON.stringify({
                            id: callId,
                            method: `${schemaName}/${action.actionName}`,
                            params: action.parameters,
                        }),
                    );

                    const handler = (event: any) => {
                        const text = event.data.toString();
                        const data = JSON.parse(text);
                        if (data.id == callId && data.result) {
                            this.webSocket.removeEventListener(
                                "message",
                                handler,
                            );
                            resolve(data.result);
                        }
                    };

                    this.webSocket.addEventListener("message", handler);
                } catch {
                    console.log("Unable to contact browser backend.");
                    reject(
                        "Unable to contact browser backend (from connector).",
                    );
                }
            } else {
                throw new Error("No websocket connection.");
            }
        });
    }

    private async getPageDataFromBrowser(action: any) {
        return new Promise<string | undefined>(async (resolve, reject) => {
            const response = await this.sendActionToBrowser(action, "browser");
            if (response.data) {
                resolve(response.data);
            } else {
                resolve(undefined);
            }
        });
    }

    async getHtmlFragments(useTimestampIds?: boolean) {
        const timeoutPromise = new Promise((f) => setTimeout(f, 120000));
        const htmlAction = {
            actionName: "getHTML",
            parameters: {
                fullHTML: false,
                downloadAsFile: false,
                extractText: false,
                useTimestampIds: useTimestampIds,
            },
        };

        const actionPromise = this.getPageDataFromBrowser(htmlAction);
        const liveHtml = await Promise.race([actionPromise, timeoutPromise]);
        if (liveHtml && Array.isArray(liveHtml)) {
            return liveHtml;
        }

        return [];
    }

    async getFilteredHtmlFragments(
        inputHtmlFragments: any[],
        cssSelectorsToKeep: string[],
    ) {
        let htmlFragments: any[] = [];
        const timeoutPromise = new Promise((f) => setTimeout(f, 5000));
        const filterAction = {
            actionName: "getFilteredHTMLFragments",
            parameters: {
                fragments: inputHtmlFragments,
                cssSelectorsToKeep: cssSelectorsToKeep,
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

    async clickOn(cssSelector: string) {
        const clickAction = {
            actionName: "clickOnElement",
            parameters: {
                cssSelector: cssSelector,
            },
        };
        return this.sendActionToBrowser(clickAction);
    }

    async setDropdown(cssSelector: string, optionLabel: string) {
        const clickAction = {
            actionName: "setDropdownValue",
            parameters: {
                cssSelector: cssSelector,
                optionLabel: optionLabel,
            },
        };
        return this.sendActionToBrowser(clickAction);
    }

    async enterTextIn(
        textValue: string,
        cssSelector?: string,
        submitForm?: boolean,
    ) {
        let actionName = cssSelector ? "enterTextInElement" : "enterTextOnPage";

        const textAction = {
            actionName: actionName,
            parameters: {
                value: textValue,
                cssSelector: cssSelector,
                submitForm: submitForm,
            },
        };

        return this.sendActionToBrowser(textAction);
    }

    async awaitPageLoad(timeout?: number) {
        const action = {
            actionName: "awaitPageLoad",
        };

        const actionPromise = this.sendActionToBrowser(action, "browser");
        if (timeout) {
            const timeoutPromise = new Promise((f) => setTimeout(f, timeout));
            return Promise.race([actionPromise, timeoutPromise]);
        } else {
            return actionPromise;
        }
    }

    async awaitPageInteraction(timeout?: number) {
        if (!timeout) {
            timeout = 400;
        }

        const timeoutPromise = new Promise((f) => setTimeout(f, timeout));
        return timeoutPromise;
    }
}
