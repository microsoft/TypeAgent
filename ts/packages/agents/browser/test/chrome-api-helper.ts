// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/// <reference path="types/jest-chrome-extensions.d.ts" />

import DOMPurify from "dompurify";

/**
 * Removes all <script>...</script> tags from the input HTML, including nested/multiple instances.
 */
function removeScriptTags(html: string): string {
    const cleanHtml = DOMPurify.sanitize(html);
    return cleanHtml;
}

/**
 * Initializes Chrome API mocks with default behaviors for testing
 */
function setupChromeApiMocks() {
    // Setup action API
    chrome.action.setBadgeText.mockImplementation(({ text }) => {
        return Promise.resolve();
    });

    chrome.action.setBadgeBackgroundColor.mockImplementation(({ color }) => {
        return Promise.resolve();
    });

    chrome.action.getBadgeText.mockImplementation(() => Promise.resolve(""));

    // Setup contextMenus API
    chrome.contextMenus.create.mockImplementation(() => "menu-item-id");
    chrome.contextMenus.remove.mockImplementation(() => Promise.resolve());

    // Setup downloads API
    chrome.downloads.download.mockImplementation(() => Promise.resolve(123));

    // Setup history API
    chrome.history.search.mockImplementation(() => Promise.resolve([]));

    // Setup bookmarks API
    chrome.bookmarks.search.mockImplementation(() => Promise.resolve([]));

    // Setup runtime API
    chrome.runtime.getURL.mockImplementation(
        (path) => `chrome-extension://abcdefgh/${path}`,
    );
    chrome.runtime.getManifest.mockReturnValue({ version: "1.0.0" });
    chrome.runtime.sendMessage.mockImplementation((message) => {
        // Handle offscreen document messages
        if (message && message.target === "offscreen") {
            if (message.type === "ping") {
                return Promise.resolve({
                    success: true,
                    messageId: message.messageId || "test-message-id",
                });
            }
            if (message.type === "downloadContent") {
                const url = message.url || "https://example.com";

                // Check for invalid URLs to simulate realistic behavior
                try {
                    new URL(url);
                } catch (error) {
                    return Promise.resolve({
                        success: false,
                        error: `Invalid URL: ${url}`,
                        messageId: message.messageId || "test-message-id",
                    });
                }

                const mockHtml = `<html><head><title>Test Page</title></head><body><h1>Test Content</h1><p>Mock content from ${url}</p></body></html>`;
                const cleanedHtml = removeScriptTags(mockHtml);

                const textContent = mockHtml
                    .replace(/<[^>]*>/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();

                return Promise.resolve({
                    success: true,
                    data: {
                        processedHtml: cleanedHtml,
                        textContent: textContent,
                        metadata: {
                            finalUrl: url,
                            processingMethod: "offscreen",
                            processingTime: 100,
                            originalSize: mockHtml.length,
                            processedSize: cleanedHtml.length,
                            reductionRatio:
                                cleanedHtml.length / mockHtml.length,
                            timestamp: Date.now(),
                            title: "Test Page",
                        },
                    },
                    messageId: message.messageId || "test-message-id",
                });
            }
            if (message.type === "processHtmlContent") {
                const html = message.htmlContent || "";
                const cleanedHtml = removeScriptTags(html);
                const textContent = html
                    .replace(/<[^>]*>/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();

                return Promise.resolve({
                    success: true,
                    data: {
                        html: cleanedHtml,
                        text: textContent,
                    },
                    messageId: message.messageId || "test-message-id",
                });
            }
            // Default success response for other offscreen messages
            return Promise.resolve({
                success: true,
                messageId: message.messageId || "test-message-id",
            });
        }
        return Promise.resolve({});
    });
    chrome.runtime.getContexts.mockImplementation(() => Promise.resolve([]));
    // chrome.runtime.id = "test-extension-id";

    chrome.runtime.connect.mockImplementation(() => ({
        postMessage: jest.fn(),
        disconnect: jest.fn(),
        onMessage: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
        onDisconnect: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
    }));

    // Setup scripting API
    chrome.scripting.executeScript.mockImplementation(() =>
        Promise.resolve([{ frameId: 0, result: "result" }]),
    );

    // Setup search API
    chrome.search.query.mockImplementation(() => Promise.resolve());

    // Setup sidePanel API
    chrome.sidePanel.open.mockImplementation(() => Promise.resolve());
    chrome.sidePanel.setPanelBehavior.mockImplementation(() =>
        Promise.resolve(),
    );

    // Setup storage API
    chrome.storage.local.get.mockImplementation(() => Promise.resolve({}));
    chrome.storage.local.set.mockImplementation(() => Promise.resolve());
    chrome.storage.local.remove.mockImplementation(() => Promise.resolve());
    chrome.storage.local.clear.mockImplementation(() => Promise.resolve());

    chrome.storage.session.get.mockImplementation(() => Promise.resolve({}));
    chrome.storage.session.set.mockImplementation(() => Promise.resolve());
    chrome.storage.session.remove.mockImplementation(() => Promise.resolve());
    chrome.storage.session.clear.mockImplementation(() => Promise.resolve());

    chrome.storage.sync.get.mockImplementation(() => Promise.resolve({}));
    chrome.storage.sync.set.mockImplementation(() => Promise.resolve());
    chrome.storage.sync.remove.mockImplementation(() => Promise.resolve());
    chrome.storage.sync.clear.mockImplementation(() => Promise.resolve());

    // Setup tabs API
    chrome.tabs.query.mockImplementation(() => Promise.resolve([]));
    chrome.tabs.get.mockImplementation((tabId) =>
        Promise.resolve({
            id: tabId,
            title: "Test Tab",
            url: "https://example.com",
        }),
    );
    chrome.tabs.create.mockImplementation(() => Promise.resolve({ id: 123 }));
    chrome.tabs.update.mockImplementation(() => Promise.resolve({ id: 123 }));
    chrome.tabs.remove.mockImplementation(() => Promise.resolve());
    chrome.tabs.sendMessage.mockImplementation(() => Promise.resolve({}));
    chrome.tabs.captureVisibleTab.mockImplementation(() =>
        Promise.resolve("data:image/png;base64,test"),
    );
    chrome.tabs.getZoom.mockImplementation(() => Promise.resolve(1));
    chrome.tabs.setZoom.mockImplementation(() => Promise.resolve());
    chrome.tabs.goBack.mockImplementation(() => Promise.resolve());
    chrome.tabs.goForward.mockImplementation(() => Promise.resolve());

    // Setup tts API
    chrome.tts.speak.mockImplementation((text, options, callback) => {
        if (callback && typeof callback === "function") callback();
    });
    chrome.tts.stop.mockImplementation(() => {});

    // Setup webNavigation API
    chrome.webNavigation.getAllFrames.mockImplementation(() =>
        Promise.resolve([{ frameId: 0, url: "https://example.com" }]),
    );

    // Setup windows API
    chrome.windows.get.mockImplementation(() =>
        Promise.resolve({ id: 1, focused: true }),
    );
    chrome.windows.getAll.mockImplementation(() =>
        Promise.resolve([
            {
                id: 1,
                focused: true,
                tabs: [
                    {
                        id: 123,
                        active: true,
                        title: "Test Tab",
                        url: "https://example.com",
                    },
                ],
            },
        ]),
    );
    chrome.windows.create.mockImplementation(() => Promise.resolve({ id: 1 }));
    chrome.windows.update.mockImplementation(() => Promise.resolve({ id: 1 }));
    chrome.windows.remove.mockImplementation(() => Promise.resolve());
    // chrome.windows.WINDOW_ID_NONE = -1;

    // Setup offscreen API
    chrome.offscreen.createDocument.mockImplementation(() => Promise.resolve());
    chrome.offscreen.closeDocument.mockImplementation(() => Promise.resolve());
    chrome.offscreen.hasDocument.mockImplementation(() =>
        Promise.resolve(false),
    );
}

module.exports = { setupChromeApiMocks };
