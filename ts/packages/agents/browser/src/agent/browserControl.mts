// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface BrowserControl {
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

    setAgentStatus(isBusy: boolean, message: string): void;
    scrollUp(): Promise<void>;
    scrollDown(): Promise<void>;
}

export type BrowserControlInvokeFunctions = {
    openWebPage(url: string): Promise<void>;
    closeWebPage(): Promise<void>;
    goForward(): Promise<void>;
    goBack(): Promise<void>;
    reload(): Promise<void>;
    getPageUrl(): Promise<string>;
    scrollUp(): Promise<void>;
    scrollDown(): Promise<void>;
};

export type BrowserControlCallFunctions = {
    setAgentStatus(isBusy: boolean, message: string): void;
};
