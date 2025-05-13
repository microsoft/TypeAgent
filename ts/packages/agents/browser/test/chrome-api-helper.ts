/**
 * Initializes Chrome API mocks with default behaviors for testing
 */
function setupChromeApiMocks() {
    // Setup action API
    chrome.action.setBadgeText.mockImplementation(({ text }, callback) => {
        if (callback) callback();
        return Promise.resolve();
    });

    chrome.action.setBadgeBackgroundColor.mockImplementation(
        ({ color }, callback) => {
            if (callback) callback();
            return Promise.resolve();
        },
    );

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
    chrome.runtime.sendMessage.mockImplementation(() => Promise.resolve({}));
    chrome.runtime.id = "test-extension-id";

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
        Promise.resolve([{ result: "result" }]),
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
        if (callback) callback();
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
    chrome.windows.WINDOW_ID_NONE = -1;
}

module.exports = { setupChromeApiMocks };
