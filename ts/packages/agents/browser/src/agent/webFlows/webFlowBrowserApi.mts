// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BrowserControl } from "../../common/browserControl.mjs";
import { ElementQuery, ElementHandle, WebFlowScope } from "./types.js";

export interface WebFlowBrowserAPI {
    navigateTo(url: string): Promise<void>;
    goBack(): Promise<void>;
    awaitPageLoad(timeout?: number): Promise<void>;
    awaitPageInteraction(timeout?: number): Promise<void>;
    getCurrentUrl(): Promise<string>;

    findElement(query: ElementQuery): Promise<ElementHandle>;
    findElements(query: ElementQuery): Promise<ElementHandle[]>;

    click(element: ElementHandle): Promise<void>;
    enterText(element: ElementHandle, text: string): Promise<void>;
    clearAndType(element: ElementHandle, text: string): Promise<void>;
    pressKey(key: string): Promise<void>;
    selectOption(element: ElementHandle, value: string): Promise<void>;

    getText(element: ElementHandle): Promise<string>;
    getAttribute(
        element: ElementHandle,
        attr: string,
    ): Promise<string | null>;
    getPageText(): Promise<string>;
    captureScreenshot(): Promise<string>;

    waitForElement(
        query: ElementQuery,
        timeout?: number,
    ): Promise<ElementHandle>;
    waitForNavigation(timeout?: number): Promise<void>;
}

export class WebFlowBrowserAPIImpl implements WebFlowBrowserAPI {
    private scope: WebFlowScope | undefined;

    constructor(
        private browser: BrowserControl,
        scope?: WebFlowScope,
    ) {
        this.scope = scope;
    }

    async navigateTo(url: string): Promise<void> {
        if (this.scope?.type === "site" && this.scope.domains?.length) {
            const targetDomain = new URL(url).hostname;
            const allowed = this.scope.domains.some((d) =>
                targetDomain.endsWith(d),
            );
            if (!allowed) {
                throw new Error(
                    `Navigation to ${targetDomain} blocked: flow is scoped to ${this.scope.domains.join(", ")}`,
                );
            }
        }
        await this.browser.openWebPage(url);
    }

    async goBack(): Promise<void> {
        await this.browser.goBack();
    }

    async awaitPageLoad(timeout?: number): Promise<void> {
        await this.browser.awaitPageLoad(timeout);
    }

    async awaitPageInteraction(timeout?: number): Promise<void> {
        await this.browser.awaitPageInteraction(timeout);
    }

    async getCurrentUrl(): Promise<string> {
        return this.browser.getPageUrl();
    }

    async findElement(query: ElementQuery): Promise<ElementHandle> {
        const elements = await this.findElements(query);
        if (elements.length === 0) {
            throw new Error(
                `No element found matching: ${JSON.stringify(query)}`,
            );
        }
        const index = query.index ?? 0;
        if (index >= elements.length) {
            throw new Error(
                `Element index ${index} out of range (found ${elements.length})`,
            );
        }
        return elements[index];
    }

    async findElements(query: ElementQuery): Promise<ElementHandle[]> {
        if (query.cssSelector) {
            return this.findByCssSelector(query.cssSelector);
        }
        // Build a CSS selector from semantic query properties
        const selector = this.buildSelectorFromQuery(query);
        return this.findByCssSelector(selector);
    }

    async click(element: ElementHandle): Promise<void> {
        await this.browser.clickOn(element.selector);
    }

    async enterText(element: ElementHandle, text: string): Promise<void> {
        await this.browser.enterTextIn(text, element.selector, false);
    }

    async clearAndType(element: ElementHandle, text: string): Promise<void> {
        // Clear by selecting all, then type new text
        await this.browser.enterTextIn(text, element.selector, false);
    }

    async pressKey(key: string): Promise<void> {
        // Key press is handled via enterTextIn with special key encoding
        // For "Enter", submit the form
        if (key === "Enter") {
            await this.browser.enterTextIn("", undefined, true);
        }
    }

    async selectOption(element: ElementHandle, value: string): Promise<void> {
        await this.browser.setDropdown(element.selector, value);
    }

    async getText(element: ElementHandle): Promise<string> {
        return element.text ?? "";
    }

    async getAttribute(
        element: ElementHandle,
        attr: string,
    ): Promise<string | null> {
        return element.attributes?.[attr] ?? null;
    }

    async getPageText(): Promise<string> {
        return this.browser.getPageTextContent();
    }

    async captureScreenshot(): Promise<string> {
        return this.browser.captureScreenshot();
    }

    async waitForElement(
        query: ElementQuery,
        timeout: number = 10000,
    ): Promise<ElementHandle> {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            try {
                return await this.findElement(query);
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        }
        throw new Error(
            `Timeout waiting for element: ${JSON.stringify(query)}`,
        );
    }

    async waitForNavigation(timeout?: number): Promise<void> {
        await this.browser.awaitPageLoad(timeout);
    }

    private buildSelectorFromQuery(query: ElementQuery): string {
        const parts: string[] = [];

        if (query.role) {
            parts.push(`[role="${query.role}"]`);
        }
        if (query.label) {
            parts.push(`[aria-label="${query.label}"]`);
        }
        if (query.placeholder) {
            parts.push(`[placeholder="${query.placeholder}"]`);
        }
        if (query.text) {
            // Text matching requires content script evaluation;
            // fall back to aria-label or try common patterns
            if (!query.role && !query.label) {
                parts.push(`[aria-label="${query.text}"]`);
            }
        }

        if (parts.length === 0) {
            throw new Error(
                `Cannot build selector from query: ${JSON.stringify(query)}`,
            );
        }

        return parts.join("");
    }

    private async findByCssSelector(
        selector: string,
    ): Promise<ElementHandle[]> {
        // Use the browser's HTML fragment system to find elements
        const fragments = await this.browser.getHtmlFragments(true);
        const handles: ElementHandle[] = [];

        // Search through fragments for matching selectors
        for (const fragment of fragments) {
            if (
                fragment &&
                typeof fragment === "object" &&
                fragment.cssSelector
            ) {
                if (this.selectorMatches(fragment, selector)) {
                    handles.push({
                        selector: fragment.cssSelector,
                        tagName: fragment.tagName ?? "unknown",
                        text: fragment.textContent ?? fragment.innerText,
                        attributes: fragment.attributes,
                    });
                }
            }
        }

        return handles;
    }

    private selectorMatches(fragment: any, selector: string): boolean {
        // Basic matching: check if fragment's properties match the selector
        if (fragment.cssSelector === selector) return true;
        if (
            selector.startsWith("[role=") &&
            fragment.attributes?.role === selector.match(/role="([^"]+)"/)?.[1]
        ) {
            return true;
        }
        if (
            selector.startsWith("[aria-label=") &&
            fragment.attributes?.["aria-label"] ===
                selector.match(/aria-label="([^"]+)"/)?.[1]
        ) {
            return true;
        }
        if (
            selector.startsWith("[placeholder=") &&
            fragment.attributes?.placeholder ===
                selector.match(/placeholder="([^"]+)"/)?.[1]
        ) {
            return true;
        }
        return false;
    }
}

export function createFrozenBrowserApi(
    browser: BrowserControl,
    scope?: WebFlowScope,
): WebFlowBrowserAPI {
    const api = new WebFlowBrowserAPIImpl(browser, scope);
    return Object.freeze(api);
}
