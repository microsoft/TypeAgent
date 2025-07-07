// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Mock for agent-rpc/rpc
export const createRpc = jest.fn(() => ({
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    invoke: jest.fn(),
}));
