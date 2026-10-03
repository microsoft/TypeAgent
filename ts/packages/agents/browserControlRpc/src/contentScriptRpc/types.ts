// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { BrowserCaptureSnapshot } from "../browserControl.js";

export type ContentScriptRpc = {
    capturePageSnapshot(
        expectedUrl: string,
    ): Promise<Omit<BrowserCaptureSnapshot, "pageId">>;
    scrollUp(): Promise<void>;
    scrollDown(): Promise<void>;
    getPageLinksByQuery(query: string): Promise<string | undefined>;
    getPageLinksByPosition(position: number): Promise<string | undefined>;
    clickOn(cssSelector: string): Promise<any>;
    setDropdown(cssSelector: string, optionLabel: string): Promise<any>;
    enterTextIn(
        textValue: string,
        cssSelector?: string,
        submitForm?: boolean,
    ): Promise<any>;
    awaitPageLoad(timeout?: number): Promise<string>;
    awaitPageInteraction(timeout?: number): Promise<void>;

    runPaleoBioDbAction(action: any): Promise<void>;
};
