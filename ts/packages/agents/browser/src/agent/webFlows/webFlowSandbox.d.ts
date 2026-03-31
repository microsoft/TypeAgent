// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Static type declarations for the webFlow script sandbox environment.
// This file is read at runtime by the script validator to type-check
// generated TypeScript scripts. Only the types declared here (plus a
// per-flow FlowParams interface) are available inside scripts.

interface ComponentDef {
    typeName: string;
    schema: string;
}

interface PageStateResult {
    matched: boolean;
    explanation: string;
}

interface ContentQueryResult {
    answered: boolean;
    answerText?: string;
    confidence?: number;
}

interface WebFlowBrowserAPI {
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
    captureScreenshot(): Promise<string>;

    waitForNavigation(timeout?: number): Promise<void>;

    extractComponent<T = unknown>(
        componentDef: ComponentDef,
        userRequest?: string,
    ): Promise<T>;

    checkPageState(expectedStateDescription: string): Promise<PageStateResult>;

    queryContent(question: string): Promise<ContentQueryResult>;
}

interface WebFlowResult {
    success: boolean;
    message?: string;
    data?: unknown;
    error?: string;
}

declare const browser: Readonly<WebFlowBrowserAPI>;
declare const params: Readonly<FlowParams>;
declare const console: {
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
};
