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
}
