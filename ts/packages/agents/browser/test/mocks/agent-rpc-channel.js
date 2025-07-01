// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Mock for agent-rpc/channel
export const createGenericChannel = jest.fn(() => ({
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
}));
