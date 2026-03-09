// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ContinuationState,
    webAgentStorage,
} from "../contentScript/webAgentStorage";

export interface UIActions {
    clickOn(selector: string): Promise<void>;
    enterTextIn(
        selector: string,
        text: string,
        options?: EnterTextOptions,
    ): Promise<void>;
    setDropdown(selector: string, optionLabel: string): Promise<void>;
    scroll(direction: "up" | "down"): Promise<void>;
}

export interface EnterTextOptions {
    delay?: number;
    clearExisting?: boolean;
    triggerBlur?: boolean;
    triggerSubmit?: boolean;
    enterAtPageScope?: boolean;
}

export interface WebAgentContext {
    ui: UIActions;
    extractComponent<T>(type: string, userRequest?: string): Promise<T>;
    notify(message: string, notificationId?: string): Promise<void>;
    continuation?: ContinuationState;
    storage: typeof webAgentStorage;
    getTabId(): Promise<string | null>;
    getCurrentUrl(): string;
}

export interface WebAgent {
    name: string;
    urlPatterns: RegExp[];

    initialize(context: WebAgentContext): Promise<void>;

    handleContinuation?(
        continuation: ContinuationState,
        context: WebAgentContext,
    ): Promise<void>;
}

export interface WebAgentActionResult {
    success: boolean;
    message?: string;
    data?: unknown;
    continuation?: Omit<ContinuationState, "tabId" | "createdAt">;
}

export function matchesUrl(url: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(url));
}
