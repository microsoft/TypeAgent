// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ExtractionMode = "basic" | "summary" | "content" | "full";

export interface BrowserSettings {
    autoIndexing: boolean;
    extractionMode: ExtractionMode;
}

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
    closeWindow(title?: string): Promise<void>;
    search(
        query?: string,
        sites?: string[],
        searchProvider?: SearchProvider,
        options?: { waitForPageLoad?: boolean; newTab?: boolean },
    ): Promise<URL>;
    switchTabs(tabDescription: string, tabIndex?: number): Promise<boolean>;

    // REVIEW: external browser only
    readPageContent(): Promise<void>;
    stopReadPageContent(): Promise<void>;
    captureScreenshot(): Promise<string>;
    getPageTextContent(): Promise<string>;

    // Settings access methods
    getAutoIndexSetting(): Promise<boolean>;
    getBrowserSettings(): Promise<BrowserSettings>;

    getHtmlFragments(
        useTimestampIds?: boolean,
        compressionMode?: string,
    ): Promise<any[]>;
    clickOn(cssSelector: string): Promise<any>;
    setDropdown(cssSelector: string, optionLabel: string): Promise<any>;
    enterTextIn(
        textValue: string,
        cssSelector?: string,
        submitForm?: boolean,
    ): Promise<any>;
    awaitPageLoad(timeout?: number): Promise<string>;
    awaitPageInteraction(timeout?: number): Promise<void>;
    downloadImage(
        cssSelector?: string,
        imageDescription?: string,
        filename?: string,
    ): Promise<string>;
    runBrowserAction(
        actionName: string,
        parameters: any,
        schemaName?: string,
    ): Promise<any>;
};

export type BrowserControlCallFunctions = {
    setAgentStatus(isBusy: boolean, message: string): void;
};

export type BrowserControl = BrowserControlInvokeFunctions &
    BrowserControlCallFunctions;

export function createBrowserControlRpcFacade(
    browserControl: BrowserControl,
): BrowserControl {
    return {
        openWebPage: (...args) => browserControl.openWebPage(...args),
        closeWebPage: (...args) => browserControl.closeWebPage(...args),
        closeAllWebPages: (...args) => browserControl.closeAllWebPages(...args),
        goForward: (...args) => browserControl.goForward(...args),
        goBack: (...args) => browserControl.goBack(...args),
        reload: (...args) => browserControl.reload(...args),
        getPageUrl: (...args) => browserControl.getPageUrl(...args),
        scrollUp: (...args) => browserControl.scrollUp(...args),
        scrollDown: (...args) => browserControl.scrollDown(...args),
        zoomIn: (...args) => browserControl.zoomIn(...args),
        zoomOut: (...args) => browserControl.zoomOut(...args),
        zoomReset: (...args) => browserControl.zoomReset(...args),
        followLinkByText: (...args) => browserControl.followLinkByText(...args),
        followLinkByPosition: (...args) =>
            browserControl.followLinkByPosition(...args),
        closeWindow: (...args) => browserControl.closeWindow(...args),
        search: (...args) => browserControl.search(...args),
        switchTabs: (...args) => browserControl.switchTabs(...args),
        readPageContent: (...args) => browserControl.readPageContent(...args),
        stopReadPageContent: (...args) =>
            browserControl.stopReadPageContent(...args),
        captureScreenshot: (...args) =>
            browserControl.captureScreenshot(...args),
        getPageTextContent: (...args) =>
            browserControl.getPageTextContent(...args),
        getAutoIndexSetting: (...args) =>
            browserControl.getAutoIndexSetting(...args),
        getBrowserSettings: (...args) =>
            browserControl.getBrowserSettings(...args),
        getHtmlFragments: (...args) => browserControl.getHtmlFragments(...args),
        clickOn: (...args) => browserControl.clickOn(...args),
        setDropdown: (...args) => browserControl.setDropdown(...args),
        enterTextIn: (...args) => browserControl.enterTextIn(...args),
        awaitPageLoad: (...args) => browserControl.awaitPageLoad(...args),
        awaitPageInteraction: (...args) =>
            browserControl.awaitPageInteraction(...args),
        downloadImage: (...args) => browserControl.downloadImage(...args),
        runBrowserAction: (...args) => browserControl.runBrowserAction(...args),
        setAgentStatus: (...args) => browserControl.setAgentStatus(...args),
    };
}

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
