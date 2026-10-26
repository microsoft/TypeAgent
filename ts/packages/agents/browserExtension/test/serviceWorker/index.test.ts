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
    initContextMenuSettings: jest.fn(),
    handleContextMenuClick: jest.fn(),
    setContextMenuRpcSend: jest.fn(),
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
let initContextMenuSettings: jest.Mock;
let getWebSocket: jest.Mock;

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
            getWebSocket = websocketModule.getWebSocket as jest.Mock;
            showBadgeError = uiModule.showBadgeError as jest.Mock;
            initializeContextMenu =
                contextMenuModule.initializeContextMenu as jest.Mock;
            initContextMenuSettings =
                contextMenuModule.initContextMenuSettings as jest.Mock;

            const indexModule = require("../../src/extension/serviceWorker/index");
            initialize = indexModule.initialize;
        });
    });

    it("waits for menu replacement before configuring settings and listeners", async () => {
        await initialize();
        jest.clearAllMocks();
        let finishMenus!: () => void;
        initializeContextMenu.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishMenus = resolve;
            }),
        );
        const pending = initialize();
        await Promise.resolve();
        expect(initializeContextMenu).toHaveBeenCalledTimes(1);
        expect(initContextMenuSettings).not.toHaveBeenCalled();
        expect(
            chrome.contextMenus.onClicked.addListener,
        ).not.toHaveBeenCalled();
        finishMenus();
        await pending;
        expect(initContextMenuSettings).toHaveBeenCalledTimes(1);
        expect(chrome.contextMenus.onClicked.addListener).toHaveBeenCalledTimes(
            1,
        );
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

    it("does not expose private decision replies or accept private methods through the page port", async () => {
        await initialize();
        const socket = new EventTarget() as EventTarget & {
            readyState: number;
            send: jest.Mock;
        };
        socket.readyState = WebSocket.OPEN;
        socket.send = jest.fn();
        getWebSocket.mockReturnValue(socket);
        const onMessage = { addListener: jest.fn() };
        const port = {
            name: "typeagent",
            sender: {
                tab: { id: 7, title: "Puzzle", url: "https://example.com" },
                frameId: 2,
            },
            onMessage,
            onDisconnect: { addListener: jest.fn() },
            postMessage: jest.fn(),
            disconnect: jest.fn(),
        };
        const onConnect = (
            chrome.runtime.onConnect.addListener as jest.Mock
        ).mock.calls.at(-1)![0];
        await onConnect(port);
        const sendFromPage = onMessage.addListener.mock.calls[0][0];
        for (const method of [
            "resolveCrosswordClue",
            "getCrosswordDecisionCapabilities",
            "cancelCrosswordDecision",
        ]) {
            sendFromPage({
                source: "webAgent",
                method: "webAgent/message",
                params: {
                    type: "builtInRpc",
                    id: "page",
                    method,
                    params: { origin: { tabId: 99 } },
                },
            });
        }
        expect(socket.send).not.toHaveBeenCalled();
        socket.dispatchEvent(
            new MessageEvent("message", {
                data: JSON.stringify({
                    source: "dispatcher",
                    method: "crosswordDecision/response",
                    type: "builtInRpcResponse",
                    id: "private",
                    result: { candidateId: "c1" },
                }),
            }),
        );
        await Promise.resolve();
        expect(port.postMessage).not.toHaveBeenCalled();
        socket.dispatchEvent(
            new MessageEvent("message", {
                data: JSON.stringify({
                    source: "dispatcher",
                    method: "webAgent/message",
                    params: {},
                }),
            }),
        );
        await Promise.resolve();
        expect(port.postMessage).toHaveBeenCalledTimes(1);
    });

    it("routes runtime decisions using sender identity and replies only to the originating frame", async () => {
        await initialize();
        Object.defineProperty(chrome.runtime, "id", {
            configurable: true,
            value: "test-extension",
        });
        Object.defineProperty(chrome, "permissions", {
            configurable: true,
            value: { contains: jest.fn().mockResolvedValue(true) },
        });
        const socket = new EventTarget() as EventTarget & {
            readyState: number;
            send: jest.Mock;
        };
        socket.readyState = WebSocket.OPEN;
        socket.send = jest.fn();
        getWebSocket.mockReturnValue(socket);
        let sequence = 0;
        Object.defineProperty(crypto, "randomUUID", {
            configurable: true,
            value: () => `runtime-${++sequence}`,
        });
        const listener = (
            chrome.runtime.onMessage.addListener as jest.Mock
        ).mock.calls.at(-1)![0];
        const params = {
            origin: { tabId: 999, frameId: 999, documentId: "spoof" },
            clueNumber: 1,
            clueDirection: "across",
            snapshot: {
                snapshotId: "s1",
                documentToken: "token",
                puzzleId: "puzzle",
                revision: 0,
                modeGeneration: 0,
                createdAt: Date.now(),
                collectorVersion: 1,
                complete: true,
                candidates: [{ id: "c1", text: "Clue", context: "Across" }],
            },
        };
        const first = jest.fn();
        const second = jest.fn();
        const sender = {
            id: chrome.runtime.id,
            tab: { id: 7 },
            frameId: 0,
            documentId: "top-document",
            url: "https://example.com/puzzle",
        };
        const message = {
            type: "crosswordDecisionRpc",
            method: "resolveCrosswordClue",
            params,
        };
        expect(listener(message, sender, first)).toBe(true);
        expect(
            listener(
                message,
                { ...sender, frameId: 2, documentId: "iframe-document" },
                second,
            ),
        ).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const sent = socket.send.mock.calls.map(([value]: [string]) =>
            JSON.parse(value),
        );
        expect(sent[0].params.params.origin).toEqual({
            tabId: 7,
            frameId: 0,
            documentId: "top-document",
        });
        expect(sent[1].params.params.origin).toEqual({
            tabId: 7,
            frameId: 2,
            documentId: "iframe-document",
        });
        const result = {
            ...params.snapshot,
            candidates: undefined,
            status: "resolved",
            candidateId: "c1",
            configGeneration: "1",
        };
        const reply = (id: string) =>
            socket.dispatchEvent(
                new MessageEvent("message", {
                    data: JSON.stringify({
                        source: "dispatcher",
                        method: "crosswordDecision/response",
                        type: "builtInRpcResponse",
                        id,
                        result,
                    }),
                }),
            );
        reply(sent[1].params.id);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
        reply(sent[0].params.id);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(first).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.query).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });
});
