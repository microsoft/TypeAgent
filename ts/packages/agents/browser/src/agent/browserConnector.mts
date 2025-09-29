// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAction } from "@typeagent/agent-sdk";
import { BrowserControl } from "../common/browserControl.mjs";
import {
    BrowserClient,
    AgentWebSocketServer,
} from "./agentWebSocketServer.mjs";

export class BrowserConnector {
    constructor(
        private readonly agentServer: AgentWebSocketServer,
        private readonly browserControl: BrowserControl,
    ) {}

    async sendActionToBrowser(
        action: AppAction,
        schemaName?: string,
        targetClientId?: string,
    ): Promise<any> {
        const client = targetClientId
            ? this.agentServer.getClient(targetClientId)
            : this.agentServer.getActiveClient();

        if (!client) {
            throw new Error("No browser client available");
        }

        return this.sendToClient(client, action, schemaName);
    }

    private async sendToClient(
        client: BrowserClient,
        action: AppAction,
        schemaName?: string,
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            const callId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
            const message = {
                id: callId,
                method: `${schemaName || "browser"}/${action.actionName}`,
                params: action.parameters,
            };

            const timeout = setTimeout(() => {
                client.socket.removeListener("message", messageHandler);
                reject(new Error(`Action ${action.actionName} timed out`));
            }, 30000);

            const messageHandler = (data: any) => {
                try {
                    const response = JSON.parse(data.toString());
                    if (response.id === callId) {
                        clearTimeout(timeout);
                        client.socket.removeListener("message", messageHandler);

                        if (response.error) {
                            reject(new Error(response.error));
                        } else {
                            resolve(response.result);
                        }
                    }
                } catch (error) {
                    // Ignore parsing errors for non-response messages
                }
            };

            client.socket.on("message", messageHandler);
            client.socket.send(JSON.stringify(message));
        });
    }

    async getHtmlFragments(useTimestampIds?: boolean): Promise<any[]> {
        if (this.browserControl) {
            return this.browserControl.getHtmlFragments(useTimestampIds);
        }
        // Fallback to sending action to browser if browserControl is not available
        const result = await this.sendActionToBrowser({
            actionName: "getHTML",
            parameters: {
                fullHTML: false,
                downloadAsFile: false,
                extractText: true,
                useTimestampIds: useTimestampIds,
            },
        });
        return Array.isArray(result?.data) ? result.data : [];
    }

    async getCurrentPageScreenshot(): Promise<string> {
        return await Promise.race<string>([
            (async () => {
                try {
                    return await this.browserControl.captureScreenshot();
                } catch (err) {
                    const message = (err as Error)?.message || "";
                    if (
                        message.includes(
                            "MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND",
                        ) ||
                        message.includes("Tabs cannot be edited right now")
                    ) {
                        return "";
                    }
                    // Rethrow other errors
                    throw new Error(`Screenshot capture failed: ${message}`);
                }
            })(),
            new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error("Screenshot capture timed out")),
                    3000,
                ),
            ),
        ]);
    }

    async clickOn(cssSelector: string): Promise<any> {
        if (this.browserControl) {
            return this.browserControl.clickOn(cssSelector);
        }

        return this.sendActionToBrowser({
            actionName: "clickOnElement",
            parameters: { cssSelector },
        });
    }

    async setDropdown(cssSelector: string, optionLabel: string): Promise<any> {
        if (this.browserControl) {
            return this.browserControl.setDropdown(cssSelector, optionLabel);
        }
        return this.sendActionToBrowser({
            actionName: "setDropdownValue",
            parameters: { cssSelector, optionLabel },
        });
    }

    async enterTextIn(
        textValue: string,
        cssSelector?: string,
        submitForm?: boolean,
    ): Promise<any> {
        if (this.browserControl) {
            return this.browserControl.enterTextIn(
                textValue,
                cssSelector,
                submitForm,
            );
        }

        const actionName = cssSelector
            ? "enterTextInElement"
            : "enterTextOnPage";
        return this.sendActionToBrowser({
            actionName,
            parameters: {
                value: textValue,
                cssSelector,
                submitForm,
            },
        });
    }

    async awaitPageLoad(timeout?: number): Promise<any> {
        if (this.browserControl) {
            return this.browserControl.awaitPageLoad(timeout);
        }

        const actionPromise = this.sendActionToBrowser({
            actionName: "awaitPageLoad",
        });

        if (timeout) {
            const timeoutPromise = new Promise((f) => setTimeout(f, timeout));
            return Promise.race([actionPromise, timeoutPromise]);
        }

        return actionPromise;
    }

    async awaitPageInteraction(timeout?: number) {
        if (this.browserControl) {
            return this.browserControl.awaitPageInteraction(timeout);
        }

        if (!timeout) {
            timeout = 400;
        }

        const timeoutPromise = new Promise((f) => setTimeout(f, timeout));
        return timeoutPromise;
    }
}
