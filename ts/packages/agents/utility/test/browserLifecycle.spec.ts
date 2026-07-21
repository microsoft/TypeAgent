// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest, describe, test, expect, beforeEach } from "@jest/globals";

// --- Fake browser & page ---------------------------------------------------

let disconnectedHandler: (() => void) | undefined;

function makeFakeBrowser() {
    disconnectedHandler = undefined;
    return {
        on: jest.fn((event: string, handler: () => void) => {
            if (event === "disconnected") {
                disconnectedHandler = handler;
            }
        }),
        newPage: jest.fn(() =>
            Promise.resolve({
                goto: jest.fn(),
                content: jest.fn(),
                close: jest.fn(),
            }),
        ),
        close: jest.fn(() => Promise.resolve()),
    };
}

let fakeBrowser = makeFakeBrowser();

// Mutable reference updated each beforeEach so the mock factory always sees
// the latest fake browser without needing to re-import puppeteer-extra.
const launchMock = jest.fn(() => Promise.resolve(fakeBrowser));

// --- ESM mocks (must precede dynamic import) --------------------------------

jest.unstable_mockModule("puppeteer-extra", () => ({
    default: {
        use: jest.fn(),
        launch: launchMock,
    },
}));

jest.unstable_mockModule("puppeteer-extra-plugin-stealth", () => ({
    default: jest.fn(),
}));

jest.unstable_mockModule("@typeagent/browser-control-rpc/htmlReducer", () => ({
    createNodeHtmlReducer: jest.fn(),
}));

jest.unstable_mockModule("html-to-text", () => ({
    convert: jest.fn(),
}));

jest.unstable_mockModule("@anthropic-ai/claude-agent-sdk", () => ({
    query: jest.fn(),
}));

// --- Import module under test -----------------------------------------------

const { instantiate } = await import("../src/actionHandler.mjs");

describe("browser lifecycle", () => {
    beforeEach(() => {
        fakeBrowser = makeFakeBrowser();
        launchMock.mockImplementation(() => Promise.resolve(fakeBrowser));
    });

    test("instantiate() exports closeAgentContext", () => {
        const agent = instantiate();
        expect(agent.closeAgentContext).toBeDefined();
        expect(typeof agent.closeAgentContext).toBe("function");
    });

    test("initializeAgentContext pre-warms browserPromise after a tick", async () => {
        const agent = instantiate();
        const ctx = await agent.initializeAgentContext!();
        // Pre-warm is fire-and-forget; let microtasks settle
        await new Promise((r) => setTimeout(r, 0));
        expect((ctx as any).browserPromise).not.toBeNull();
    });

    test("closeAgentContext closes browser and nulls browserPromise", async () => {
        const agent = instantiate();
        const agentContext = await agent.initializeAgentContext!();
        await new Promise((r) => setTimeout(r, 0));
        expect((agentContext as any).browserPromise).not.toBeNull();

        const sessionContext = { agentContext } as any;
        await agent.closeAgentContext!(sessionContext);

        expect(fakeBrowser.close).toHaveBeenCalledTimes(1);
        expect((agentContext as any).browserPromise).toBeNull();
    });

    test("double close is a no-op", async () => {
        const agent = instantiate();
        const agentContext = await agent.initializeAgentContext!();
        await new Promise((r) => setTimeout(r, 0));

        const sessionContext = { agentContext } as any;
        await agent.closeAgentContext!(sessionContext);
        await agent.closeAgentContext!(sessionContext);

        expect(fakeBrowser.close).toHaveBeenCalledTimes(1);
    });

    test("browser disconnected event clears browserPromise", async () => {
        const agent = instantiate();
        const agentContext = await agent.initializeAgentContext!();
        await new Promise((r) => setTimeout(r, 0));

        expect((agentContext as any).browserPromise).not.toBeNull();
        expect(disconnectedHandler).toBeDefined();

        // Simulate browser crash/disconnect
        disconnectedHandler!();

        expect((agentContext as any).browserPromise).toBeNull();
    });
});
