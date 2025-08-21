// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type BrowserControlInvokeFunctions = {
    /**
     * open a new browser view with the specified URL.
     * @param url The URL to open in the browser.
     * @return A promise that resolves when the browser window is opened.
     */
    openWebPage(url: string): Promise<void>;
    /**
     * close the browser view.
     */
    closeWebPage(): Promise<void>;
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

    // REVIEW: external browser only
    search(query?: string, searchProvider?: SearchProvider): Promise<void>;
    readPage(): Promise<void>;
    stopReadPage(): Promise<void>;
    captureScreenshot(): Promise<string>;
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
    }
];

