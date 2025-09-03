// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type BrowserControlInvokeFunctions = {
    /**
     * open a new browser view with the specified URL.
     * @param url The URL to open in the browser.
     * @param newTab Whether to open the URL in a new tab.
     * @return A promise that resolves when the browser window is opened.
     */
    openWebPage(url: string, options?: { newTab?: boolean }): Promise<void>;
    /**
     * close the browser view.
     */
    closeWebPage(): Promise<void>;
    closeAllWebPages(): Promise<void>;
    goForward(): Promise<void>;
    goBack(): Promise<void>;
    reload(): Promise<void>;
    getPageUrl(): Promise<string>;
    scrollUp(): Promise<void>;
    scrollDown(): Promise<void>;
    zoomIn(): Promise<void>;
    zoomOut(): Promise<void>;
    zoomReset(): Promise<void>;
    // returns the URL, or undefined if not found
    followLinkByText(
        keywords: string,
        openInNewTab?: boolean,
    ): Promise<string | undefined>;
    // returns the URL, or undefined if not found
    followLinkByPosition(
        position: number,
        openInNewTab?: boolean,
    ): Promise<string | undefined>;
    closeWindow(): Promise<void>;
    search(
        query?: string,
        sites?: string[],
        searchProvider?: SearchProvider,
        options?: { waitForPageLoad?: boolean; newTab?: boolean },
    ): Promise<URL>;
    switchTabs(tabDescription: string, tabIndex?: number): Promise<boolean>;

    // REVIEW: external browser only
    readPage(): Promise<void>;
    stopReadPage(): Promise<void>;
    captureScreenshot(): Promise<string>;
    getPageContents(): Promise<string>;
};

export type BrowserControlCallFunctions = {
    setAgentStatus(isBusy: boolean, message: string): void;
};

export type BrowserControl = BrowserControlInvokeFunctions &
    BrowserControlCallFunctions;

export type SearchProvider = {
    name: string;
    url: string;
};

export const defaultSearchProviders: SearchProvider[] = [
    {
        name: "Bing",
        url: "https://www.bing.com/?q=%s",
    },
    {
        name: "Google",
        url: "https://www.google.com/search?q=%s",
    },
    {
        name: "Yahoo",
        url: "https://search.yahoo.com/search?p=%s",
    },
    {
        name: "DuckDuckGo",
        url: "https://duckduckgo.com/?q=%s",
    },
];
