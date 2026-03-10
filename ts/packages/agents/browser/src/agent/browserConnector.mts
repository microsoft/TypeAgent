// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAction } from "@typeagent/agent-sdk";
import { BrowserControl } from "../common/browserControl.mjs";
import { AgentWebSocketServer } from "./agentWebSocketServer.mjs";
import registerDebug from "debug";

const debugClientRouting = registerDebug("typeagent:browser:client-routing");

export class BrowserConnector {
    constructor(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _agentServer: AgentWebSocketServer,
        private readonly browserControl: BrowserControl,
        private readonly preferredClientType?: "extension" | "electron",
    ) {}

    async sendActionToBrowser(
        action: AppAction,
        schemaName?: string,
        targetClientId?: string,
    ): Promise<any> {
        debugClientRouting(
            `sendActionToBrowser: action=${action.actionName}, targetClientId=${targetClientId}, preferredClientType=${this.preferredClientType}`,
        );

        return this.browserControl.runBrowserAction(
            action.actionName,
            action.parameters,
            schemaName,
        );
    }

    async getHtmlFragments(
        useTimestampIds?: boolean,
        compressionMode?: string,
        targetClientId?: string,
    ): Promise<any[]> {
        return this.browserControl.getHtmlFragments(
            useTimestampIds,
            compressionMode,
        );
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
                    throw new Error(`Screenshot capture failed: ${message}`);
                }
            })(),
            new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error("Screenshot capture timed out")),
                    10000,
                ),
            ),
        ]);
    }

    async clickOn(cssSelector: string, targetClientId?: string): Promise<any> {
        return this.browserControl.clickOn(cssSelector);
    }

    async setDropdown(
        cssSelector: string,
        optionLabel: string,
        targetClientId?: string,
    ): Promise<any> {
        return this.browserControl.setDropdown(cssSelector, optionLabel);
    }

    async enterTextIn(
        textValue: string,
        cssSelector?: string,
        submitForm?: boolean,
        targetClientId?: string,
    ): Promise<any> {
        return this.browserControl.enterTextIn(
            textValue,
            cssSelector,
            submitForm,
        );
    }

    async awaitPageLoad(timeout?: number): Promise<any> {
        return this.browserControl.awaitPageLoad(timeout);
    }

    async awaitPageInteraction(timeout?: number) {
        if (!timeout) {
            timeout = 400;
        }

        const timeoutPromise = new Promise((f) => setTimeout(f, timeout));
        return timeoutPromise;
    }
}
