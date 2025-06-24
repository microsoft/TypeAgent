// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ContentScriptRpc = {
    scrollUp(): Promise<void>;
    scrollDown(): Promise<void>;
};
