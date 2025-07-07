// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/// <reference path="../types/jest-chrome-extensions.d.ts" />

jest.mock("../../src/extension/serviceWorker/websocket", () => ({
    sendActionToAgent: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ success: true })),
    getWebSocket: jest.fn().mockReturnValue({
        readyState: 1, // WebSocket.OPEN
        send: jest.fn(),
    }),
}));

let contextMenuModule: any;

describe("Context Menu Module", () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Clear all mock implementations from Chrome API
        chrome.contextMenus.create.mockClear();
        chrome.contextMenus.remove.mockClear();
        chrome.sidePanel.open.mockClear();
        chrome.tabs.sendMessage.mockClear();

        // Reload the module under test for each test
        jest.isolateModules(() => {
            contextMenuModule = require("../../src/extension/serviceWorker/contextMenu");
        });
    });

    describe("initializeContextMenu", () => {
        it("should create context menu items", () => {
            contextMenuModule.initializeContextMenu();

            expect(chrome.contextMenus.create).toHaveBeenCalled();
            expect(
                chrome.contextMenus.create.mock.calls.length,
            ).toBeGreaterThan(1);
        });
    });

    describe("handleContextMenuClick", () => {
        it("should handle discoverPageSchema menu click", async () => {
            const mockTab = { id: 123, url: "https://example.com" };
            const mockInfo = { menuItemId: "discoverPageSchema" };

            chrome.sidePanel.open.mockImplementation(() => Promise.resolve());

            await contextMenuModule.handleContextMenuClick(mockInfo, mockTab);

            expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 123 });
        });

        it("should handle reInitCrosswordPage menu click", async () => {
            const mockTab = { id: 123, url: "https://example.com" };
            const mockInfo = { menuItemId: "reInitCrosswordPage" };

            chrome.tabs.sendMessage.mockImplementation(() => Promise.resolve());

            await contextMenuModule.handleContextMenuClick(mockInfo, mockTab);

            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(123, {
                type: "setup_UniversalCrossword",
            });
        });

        it("should return early if tab is undefined", async () => {
            const mockInfo = { menuItemId: "reInitCrosswordPage" };

            await contextMenuModule.handleContextMenuClick(mockInfo, undefined);

            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        });
    });
});
