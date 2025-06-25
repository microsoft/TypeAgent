// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ContentScriptRpc = {
    scrollUp(): Promise<void>;
    scrollDown(): Promise<void>;
    getPageLinksByQuery(query: string): Promise<string | undefined>;
    getPageLinksByPosition(position: number): Promise<string | undefined>;

    runPaleoBioDbAction(action: any): Promise<void>;
};
