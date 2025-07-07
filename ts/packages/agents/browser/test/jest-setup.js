// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

require("jest-chrome");

global.chrome = {
    action: {
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
        getBadgeText: jest.fn(),
        onClicked: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
    },
    contextMenus: {
        create: jest.fn(),
        remove: jest.fn(),
        onClicked: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
    },
    downloads: {
        download: jest.fn(),
    },
    history: {
        search: jest.fn(),
    },
    bookmarks: {
        search: jest.fn(),
    },
    runtime: {
        getURL: jest.fn(),
        getManifest: jest.fn(),
        sendMessage: jest.fn(),
        onMessage: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
        onInstalled: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
        onStartup: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
        onConnect: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
        connect: jest.fn(),
    },
    scripting: {
        executeScript: jest.fn(),
    },
    search: {
        query: jest.fn(),
    },
    sidePanel: {
        open: jest.fn(),
        setOptions: jest.fn(),
        getOptions: jest.fn(),
        setPanelBehavior: jest.fn(),
    },
    storage: {
        local: {
            get: jest.fn(),
            set: jest.fn(),
            remove: jest.fn(),
            clear: jest.fn(),
        },
        session: {
            get: jest.fn(),
            set: jest.fn(),
            remove: jest.fn(),
            clear: jest.fn(),
        },
        sync: {
            get: jest.fn(),
            set: jest.fn(),
            remove: jest.fn(),
            clear: jest.fn(),
        },
        onChanged: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
    },
    tabs: {
        query: jest.fn(),
        get: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        sendMessage: jest.fn(),
        captureVisibleTab: jest.fn(),
        getZoom: jest.fn(),
        setZoom: jest.fn(),
        goBack: jest.fn(),
        goForward: jest.fn(),
        onActivated: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
        onCreated: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
        onRemoved: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
        onUpdated: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
    },
    tts: {
        speak: jest.fn(),
        stop: jest.fn(),
    },
    webNavigation: {
        getAllFrames: jest.fn(),
    },
    windows: {
        get: jest.fn(),
        getAll: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        onCreated: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
        onRemoved: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
        onFocusChanged: {
            addListener: jest.fn(),
            hasListeners: jest.fn(),
            removeListener: jest.fn(),
        },
        WINDOW_ID_NONE: -1,
    },
};

// Now we can call setupChromeApiMocks
const { setupChromeApiMocks } = require("./chrome-api-helper");
setupChromeApiMocks();

// Define WebSocket constants
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

// Create a simplified mock for WebSocket that avoids TypeScript errors
class MockWebSocket {
    constructor(url, protocols) {
        this.url = url;
        this.protocol = "";
        this.readyState = CONNECTING;
        this.bufferedAmount = 0;
        this.extensions = "";
        this.binaryType = "blob";

        // Event handlers
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;

        // Event map for addEventListener
        this.eventListeners = {
            open: [],
            message: [],
            close: [],
            error: [],
        };

        // Simulate an asynchronous connection
        setTimeout(() => {
            this.readyState = OPEN;

            // Create open event
            const openEvent = new Event("open");

            // Trigger onopen if defined
            if (this.onopen) {
                this.onopen(openEvent);
            }

            // Trigger any registered event listeners
            this.eventListeners.open.forEach((listener) => {
                listener(openEvent);
            });
        }, 10);
    }

    close(code, reason) {
        this.readyState = CLOSED;

        // Create close event
        const closeEvent = {
            code: code || 1000,
            reason: reason || "",
            wasClean: true,
            type: "close",
            target: this,
            currentTarget: this,
            srcElement: this,
            composed: false,
            bubbles: false,
            cancelable: false,
            defaultPrevented: false,
            returnValue: true,
            timeStamp: Date.now(),
            preventDefault: () => {},
            stopPropagation: () => {},
            stopImmediatePropagation: () => {},
            composedPath: () => [this],
            NONE: 0,
            CAPTURING_PHASE: 1,
            AT_TARGET: 2,
            BUBBLING_PHASE: 3,
            eventPhase: 2,
            initEvent: () => {},
        };

        // Trigger onclose if defined
        if (this.onclose) {
            this.onclose(closeEvent);
        }

        // Trigger any registered event listeners
        this.eventListeners.close.forEach((listener) => {
            listener(closeEvent);
        });
    }

    send(data) {
        // Just a mock implementation, does nothing
    }

    addEventListener(type, listener, options) {
        if (this.eventListeners[type]) {
            this.eventListeners[type].push(listener);
        } else {
            this.eventListeners[type] = [listener];
        }
    }

    removeEventListener(type, listener, options) {
        if (this.eventListeners[type]) {
            this.eventListeners[type] = this.eventListeners[type].filter(
                (l) => l !== listener,
            );
        }
    }

    dispatchEvent(event) {
        return true;
    }

    // Simulate receiving a message
    mockReceiveMessage(data) {
        const messageEvent = {
            data: new Blob([data]),
            origin: this.url,
            lastEventId: "",
            source: null,
            ports: [],
            type: "message",
            target: this,
            currentTarget: this,
            srcElement: this,
            composed: false,
            bubbles: false,
            cancelable: false,
            defaultPrevented: false,
            returnValue: true,
            timeStamp: Date.now(),
            preventDefault: () => {},
            stopPropagation: () => {},
            stopImmediatePropagation: () => {},
            composedPath: () => [this],
            NONE: 0,
            CAPTURING_PHASE: 1,
            AT_TARGET: 2,
            BUBBLING_PHASE: 3,
            eventPhase: 2,
            initEvent: () => {},
        };

        // Trigger onmessage if defined
        if (this.onmessage) {
            this.onmessage(messageEvent);
        }

        // Trigger any registered event listeners
        this.eventListeners.message.forEach((listener) => {
            listener(messageEvent);
        });
    }
}

// Add static constants to MockWebSocket
MockWebSocket.CONNECTING = CONNECTING;
MockWebSocket.OPEN = OPEN;
MockWebSocket.CLOSING = CLOSING;
MockWebSocket.CLOSED = CLOSED;

// Replace global WebSocket with our mock
global.WebSocket = MockWebSocket;

// Export for use in tests
module.exports = { MockWebSocket };
