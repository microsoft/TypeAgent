// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Mock for contentScriptRpc/client.mjs
export const createContentScriptRpcClient = jest.fn(() => ({
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    invoke: jest.fn(),
}));
