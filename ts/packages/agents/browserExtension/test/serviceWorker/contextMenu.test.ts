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

jest.mock("../../src/extension/serviceWorker/messageHandlers", () => ({
    indexPageContent: jest.fn(),
}));

import { indexPageContent } from "../../src/extension/serviceWorker/messageHandlers";
import { sendActionToAgent } from "../../src/extension/serviceWorker/websocket";

let contextMenuModule: any;
const mockIndexPageContent = indexPageContent as jest.MockedFunction<
    typeof indexPageContent
>;

describe("Context Menu Module", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(sendActionToAgent).mockResolvedValue({
            url: "http://localhost:49152",
        });

        // Clear all mock implementations from Chrome API
        chrome.contextMenus.create.mockClear();
        chrome.contextMenus.remove.mockClear();
        chrome.contextMenus.removeAll.mockResolvedValue(undefined);
        chrome.sidePanel.open.mockClear();
        chrome.tabs.sendMessage.mockClear();
        chrome.action.setTitle = jest.fn().mockResolvedValue(undefined);
        mockIndexPageContent.mockResolvedValue({
            indexed: true,
            warnings: [],
            howTo: { enabled: true, candidateCount: 1 },
        });

        // Reload the module under test for each test
        jest.isolateModules(() => {
            contextMenuModule = require("../../src/extension/serviceWorker/contextMenu");
        });
    });

    describe("initializeContextMenu", () => {
        it("reports menu cleanup failures without registering replacements", async () => {
            chrome.contextMenus.removeAll.mockRejectedValueOnce(
                new Error("Menu cleanup failed"),
            );
            await expect(
                contextMenuModule.initializeContextMenu(),
            ).rejects.toThrow("Menu cleanup failed");
            expect(chrome.contextMenus.create).not.toHaveBeenCalled();
        });

        it("waits for stale entries to be removed before registering replacements", async () => {
            let removed!: () => void;
            chrome.contextMenus.removeAll.mockReturnValueOnce(
                new Promise<void>((resolve) => {
                    removed = resolve;
                }),
            );
            const pending = contextMenuModule.initializeContextMenu();
            expect(chrome.contextMenus.create).not.toHaveBeenCalled();
            removed();
            await pending;
            expect(chrome.contextMenus.create).toHaveBeenCalled();
        });

        it("replaces existing menus and exposes Memory without retired duplicates", async () => {
            await contextMenuModule.initializeContextMenu();

            expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1);
            expect(
                chrome.contextMenus.removeAll.mock.invocationCallOrder[0],
            ).toBeLessThan(
                chrome.contextMenus.create.mock.invocationCallOrder[0],
            );
            expect(chrome.contextMenus.create).toHaveBeenCalled();
            expect(
                chrome.contextMenus.create.mock.calls.length,
            ).toBeGreaterThan(1);
            const ids = chrome.contextMenus.create.mock.calls.map(
                ([item]) => item.id,
            );
            expect(
                ids.slice(
                    ids.indexOf("menuSeparator1"),
                    ids.indexOf("menuSeparator2"),
                ),
            ).toEqual(["menuSeparator1", "saveThisPage"]);
            expect(ids).not.toContain("askAboutPage");
            expect(ids).not.toContain("showMemoryCenter");
            expect(ids).not.toContain("showWebsiteLibrary");
            expect(ids.filter((id) => id === "showMemoryHub")).toHaveLength(1);
            expect(chrome.contextMenus.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: "showMemoryHub",
                    title: "Memory",
                }),
            );
            expect(chrome.contextMenus.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: "saveThisPage",
                    documentUrlPatterns: ["http://*/*", "https://*/*"],
                }),
            );
        });
    });

    describe("handleContextMenuClick", () => {
        it("should handle openChatPanel menu click", async () => {
            const mockTab = { id: 123, url: "https://example.com" };
            const mockInfo = { menuItemId: "openChatPanel" };

            chrome.sidePanel.open.mockImplementation(() => Promise.resolve());
            chrome.sidePanel.setOptions.mockImplementation(() =>
                Promise.resolve(),
            );

            await contextMenuModule.handleContextMenuClick(mockInfo, mockTab);

            expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 123 });
        });

        it.each([
            ["showMemoryHub", "memory/hub/"],
            ["showAutomations", "automations/"],
            ["showAnnotationsLibrary", "annotations/"],
        ])(
            "opens %s on the live local view host",
            async (menuItemId, route) => {
                chrome.tabs.query.mockResolvedValue([]);
                await contextMenuModule.handleContextMenuClick(
                    { menuItemId },
                    { id: 123, url: "https://example.com" },
                );
                expect(chrome.tabs.create).toHaveBeenCalledWith({
                    url: `http://localhost:49152/${route}`,
                    active: true,
                });
                expect(sendActionToAgent).toHaveBeenCalledWith({
                    actionName: "getViewHostUrl",
                    parameters: {},
                });
            },
        );

        it("focuses an existing local library tab", async () => {
            chrome.tabs.query.mockResolvedValue([{ id: 456, windowId: 789 }]);
            await contextMenuModule.handleContextMenuClick(
                { menuItemId: "showMemoryHub" },
                { id: 123, url: "https://example.com" },
            );
            expect(chrome.tabs.update).toHaveBeenCalledWith(456, {
                active: true,
            });
            expect(chrome.windows.update).toHaveBeenCalledWith(789, {
                focused: true,
            });
            expect(chrome.tabs.create).not.toHaveBeenCalled();
        });

        it("fails rather than opening an invalid or unavailable view host", async () => {
            jest.mocked(sendActionToAgent).mockResolvedValue({
                error: "Unavailable",
            });
            await expect(
                contextMenuModule.handleContextMenuClick(
                    { menuItemId: "showMemoryHub" },
                    { id: 123, url: "https://example.com" },
                ),
            ).rejects.toThrow(/unavailable/);
            expect(chrome.tabs.create).not.toHaveBeenCalled();
        });

        it("saves the clicked tab and reports discovered candidates", async () => {
            const tab = {
                id: 123,
                url: "https://example.com/guide",
                title: "Guide",
            };
            await contextMenuModule.handleContextMenuClick(
                { menuItemId: "saveThisPage" },
                tab,
            );

            expect(mockIndexPageContent).toHaveBeenCalledWith(tab, true, {
                activityType: "captured",
                mode: "content",
                reportHowToStatus: true,
            });
            expect(chrome.sidePanel.open).not.toHaveBeenCalled();
            expect(chrome.action.setTitle).toHaveBeenCalledWith(
                expect.objectContaining({
                    tabId: 123,
                    title: expect.stringContaining("1 how-to candidate"),
                }),
            );
        });

        it("does not index a missing or unsupported tab", async () => {
            await contextMenuModule.handleContextMenuClick({
                menuItemId: "saveThisPage",
            });
            await contextMenuModule.handleContextMenuClick(
                { menuItemId: "saveThisPage" },
                { id: 123, url: "chrome://settings" },
            );
            expect(mockIndexPageContent).not.toHaveBeenCalled();
        });

        it("shows indexing failures and how-to warnings without claiming success", async () => {
            const tab = { id: 123, url: "https://example.com" };
            mockIndexPageContent.mockResolvedValueOnce({
                indexed: false,
                error: "Not connected",
            });
            await contextMenuModule.handleContextMenuClick(
                { menuItemId: "saveThisPage" },
                tab,
            );
            expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
                tabId: 123,
                title: "Could not save page: Not connected",
            });

            mockIndexPageContent.mockResolvedValueOnce({
                indexed: true,
                warnings: ["Procedure candidate extraction failed"],
            });
            await contextMenuModule.handleContextMenuClick(
                { menuItemId: "saveThisPage" },
                tab,
            );
            expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
                tabId: 123,
                title: expect.stringContaining(
                    "Procedure candidate extraction failed",
                ),
            });
            expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
                tabId: 123,
                text: "!",
            });
        });

        it("distinguishes no how-to match from disabled detection", async () => {
            const tab = { id: 123, url: "https://example.com" };
            mockIndexPageContent.mockResolvedValueOnce({
                indexed: true,
                warnings: [],
                howTo: { enabled: true, candidateCount: 0 },
            });
            await contextMenuModule.handleContextMenuClick(
                { menuItemId: "saveThisPage" },
                tab,
            );
            expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
                tabId: 123,
                title: expect.stringContaining("0 how-to candidate(s)"),
            });

            mockIndexPageContent.mockResolvedValueOnce({
                indexed: true,
                warnings: [],
                howTo: { enabled: false, candidateCount: 0 },
            });
            await contextMenuModule.handleContextMenuClick(
                { menuItemId: "saveThisPage" },
                tab,
            );
            expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
                tabId: 123,
                title: expect.stringContaining("How-to detection is disabled"),
            });
        });
    });
});
