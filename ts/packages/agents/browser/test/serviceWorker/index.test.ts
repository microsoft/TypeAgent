// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    // showBadgeError,
    showBadgeHealthy,
} from "../../src/extension/serviceWorker/ui";
// import { initializeContextMenu } from "../../src/extension/serviceWorker/contextMenu";
import { toggleSiteTranslator } from "../../src/extension/serviceWorker/siteTranslator";

jest.mock("../../src/extension/serviceWorker/websocket", () => {
    const ensureWebsocketConnectedMock = jest.fn().mockImplementation(() => {
        return Promise.resolve(true);
    });

    return {
        ensureWebsocketConnected: ensureWebsocketConnectedMock,
        reconnectWebSocket: jest.fn(),
        getWebSocket: jest.fn(),
    };
});

jest.mock("../../src/extension/serviceWorker/ui", () => ({
    showBadgeError: jest.fn(),
    showBadgeHealthy: jest.fn(),
}));

jest.mock("../../src/extension/serviceWorker/contextMenu", () => ({
    initializeContextMenu: jest.fn(),
    handleContextMenuClick: jest.fn(),
}));

jest.mock("../../src/extension/serviceWorker/siteTranslator", () => ({
    toggleSiteTranslator: jest.fn(),
}));

jest.mock("../../src/extension/serviceWorker/tabManager", () => ({
    getActiveTab: jest.fn(),
}));

jest.mock("../../src/extension/serviceWorker/messageHandlers", () => ({
    handleMessage: jest.fn(),
}));

let initialize: () => Promise<void>;
let ensureWebsocketConnected: jest.Mock;
let reconnectWebSocket: jest.Mock;
let showBadgeError: jest.Mock;
let initializeContextMenu: jest.Mock;

describe("Service Worker initialization", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();

        // Reset the module to get a fresh initialize function with fresh mocks for each test
        jest.isolateModules(() => {
            const websocketModule = require("../../src/extension/serviceWorker/websocket");
            const uiModule = require("../../src/extension/serviceWorker/ui");
            const contextMenuModule = require("../../src/extension/serviceWorker/contextMenu");

            ensureWebsocketConnected =
                websocketModule.ensureWebsocketConnected as jest.Mock;
            reconnectWebSocket =
                websocketModule.reconnectWebSocket as jest.Mock;
            showBadgeError = uiModule.showBadgeError as jest.Mock;
            initializeContextMenu =
                contextMenuModule.initializeContextMenu as jest.Mock;

            const indexModule = require("../../src/extension/serviceWorker/index");
            initialize = indexModule.initialize;
        });
    });

    it("should successfully initialize when websocket connects", async () => {
        // Setup the mock to return a successful connection
        ensureWebsocketConnected.mockResolvedValue(true);

        await initialize();

        expect(ensureWebsocketConnected).toHaveBeenCalled();
        expect(reconnectWebSocket).not.toHaveBeenCalled();
        expect(showBadgeError).not.toHaveBeenCalled();
        expect(initializeContextMenu).toHaveBeenCalled();
    });

    it("should reconnect and show error badge when websocket fails to connect", async () => {
        // Setup the mock to return a failed connection
        ensureWebsocketConnected.mockResolvedValue(false);

        await initialize();

        expect(ensureWebsocketConnected).toHaveBeenCalled();
        expect(reconnectWebSocket).toHaveBeenCalled();
        expect(showBadgeError).toHaveBeenCalled();
        expect(initializeContextMenu).toHaveBeenCalled();
    });

    it("should handle errors during websocket connection", async () => {
        // Setup the mock to throw an error
        ensureWebsocketConnected.mockRejectedValue(
            new Error("Connection failed"),
        );

        await initialize();

        expect(ensureWebsocketConnected).toHaveBeenCalled();
        expect(reconnectWebSocket).toHaveBeenCalled();
        expect(showBadgeError).toHaveBeenCalled();
        expect(initializeContextMenu).toHaveBeenCalled();
    });
});
