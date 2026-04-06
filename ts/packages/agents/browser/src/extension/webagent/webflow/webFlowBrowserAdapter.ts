// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebAgentContext } from "../WebAgentContext";

export interface ComponentDefinition {
    typeName: string;
    schema: string;
}

export interface WebFlowBrowserAPI {
    navigateTo(url: string): Promise<void>;
    goBack(): Promise<void>;
    awaitPageLoad(timeout?: number): Promise<void>;
    awaitPageInteraction(timeout?: number): Promise<void>;
    getCurrentUrl(): Promise<string>;

    click(cssSelector: string): Promise<void>;
    clickAndWait(cssSelector: string, timeout?: number): Promise<void>;
    followLink(cssSelector: string): Promise<void>;

    enterText(cssSelector: string, text: string): Promise<void>;
    enterTextOnPage(text: string, submitForm?: boolean): Promise<void>;
    clearAndType(cssSelector: string, text: string): Promise<void>;
    pressKey(key: string): Promise<void>;
    selectOption(cssSelector: string, value: string): Promise<void>;

    getPageText(): Promise<string>;

    waitForNavigation(timeout?: number): Promise<void>;

    extractComponent<T = unknown>(
        componentDef: ComponentDefinition,
        userRequest?: string,
    ): Promise<T>;
}

/**
 * Creates a WebFlowBrowserAPI adapter that maps to WebAgentContext.ui calls.
 * UI actions go directly through the DOM (fast path) instead of RPC.
 * extractComponent still uses server-side RPC for LLM extraction.
 */
export function createBrowserAdapter(
    context: WebAgentContext,
): WebFlowBrowserAPI {
    return {
        async navigateTo(url: string): Promise<void> {
            window.location.href = url;
        },

        async goBack(): Promise<void> {
            window.history.back();
        },

        async awaitPageLoad(timeout?: number): Promise<void> {
            await context.awaitPageReady({ timeoutMs: timeout ?? 5000 });
        },

        async awaitPageInteraction(timeout?: number): Promise<void> {
            await context.awaitPageReady({
                stabilityMs: 300,
                timeoutMs: timeout ?? 2000,
            });
        },

        async getCurrentUrl(): Promise<string> {
            return window.location.href;
        },

        async click(cssSelector: string): Promise<void> {
            await context.ui.clickOn(cssSelector);
        },

        async clickAndWait(
            cssSelector: string,
            timeout?: number,
        ): Promise<void> {
            await context.ui.clickOn(cssSelector);
            await context.awaitPageReady({
                stabilityMs: 300,
                timeoutMs: timeout ?? 3000,
            });
        },

        async followLink(cssSelector: string): Promise<void> {
            await context.ui.clickOn(cssSelector);
            await context.awaitPageReady({
                stabilityMs: 500,
                timeoutMs: 5000,
            });
        },

        async enterText(cssSelector: string, text: string): Promise<void> {
            await context.ui.enterTextIn(cssSelector, text);
        },

        async enterTextOnPage(
            text: string,
            submitForm?: boolean,
        ): Promise<void> {
            await context.ui.enterTextIn("body", text, {
                triggerSubmit: submitForm,
                enterAtPageScope: true,
            });
        },

        async clearAndType(cssSelector: string, text: string): Promise<void> {
            await context.ui.enterTextIn(cssSelector, text, {
                clearExisting: true,
            });
        },

        async pressKey(key: string): Promise<void> {
            if (key === "Enter") {
                await context.ui.enterTextIn("body", "", {
                    triggerSubmit: true,
                    enterAtPageScope: true,
                });
            }
        },

        async selectOption(cssSelector: string, value: string): Promise<void> {
            await context.ui.setDropdown(cssSelector, value);
        },

        async getPageText(): Promise<string> {
            return document.body.innerText;
        },

        async waitForNavigation(timeout?: number): Promise<void> {
            await context.awaitPageReady({ timeoutMs: timeout ?? 5000 });
        },

        async extractComponent<T = unknown>(
            componentDef: ComponentDefinition,
            userRequest?: string,
        ): Promise<T> {
            return context.extractComponent<T>(
                componentDef.typeName,
                userRequest,
            );
        },
    };
}
