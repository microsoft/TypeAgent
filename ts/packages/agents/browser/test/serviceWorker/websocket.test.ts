// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

jest.mock("../../src/extension/serviceWorker/storage", () => ({
    getSettings: jest.fn().mockImplementation(() =>
        Promise.resolve({
            // Empty agentServerHost → service worker uses
            // AGENT_SERVER_DEFAULT_URL (ws://localhost:8999/) for the
            // discovery channel, then dials the discovered port for the
            // actual browser-agent connection.
            agentServerHost: "",
        }),
    ),
}));

// `discoverPort` lives in @typeagent/agent-server-client/discovery and
// transitively pulls in isomorphic-ws / Node WebSocket — neither of
// which loads cleanly under jsdom. Mock the helper to a synchronous
// stub so the websocket module under test can use it without spinning
// a real network call.
jest.mock("@typeagent/agent-server-client/discovery", () => ({
    discoverPort: jest.fn().mockImplementation(() =>
        Promise.resolve({ kind: "found", port: 8080 }),
    ),
}));

jest.mock("../../src/extension/serviceWorker/ui", () => ({
    showBadgeError: jest.fn(),
    showBadgeHealthy: jest.fn(),
    showBadgeBusy: jest.fn(),
}));

jest.mock("../../src/extension/serviceWorker/browserActions", () => ({
    runBrowserAction: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ message: "OK" })),
}));

let websocketModule: any;

describe("WebSocket Module", () => {
    beforeEach(async () => {
        jest.clearAllMocks();

        jest.useFakeTimers();
        jest.resetModules();

        websocketModule = await import(
            "../../src/extension/serviceWorker/websocket"
        );
    });

    afterEach(() => {
        jest.useRealTimers();

        const ws = websocketModule.getWebSocket();
        if (ws) {
            ws.close();
        }
    });

    describe("createWebSocket", () => {
        it("should create a WebSocket connection on the discovered port", async () => {
            const createWebSocket = websocketModule.createWebSocket;
            jest.useRealTimers();
            const socket = await createWebSocket();

            expect(socket).toBeDefined();
            expect(socket.url).toContain("ws://localhost:8080/");
            expect(socket.url).toContain("channel=browser");
        });
    });

    describe("ensureWebsocketConnected", () => {
        it("should create a new connection if none exists", async () => {
            const ensureWebsocketConnected =
                websocketModule.ensureWebsocketConnected;
            const getWebSocket = websocketModule.getWebSocket;

            jest.useRealTimers();
            const socket = await ensureWebsocketConnected();
            expect(socket).toBeDefined();
            expect(getWebSocket()).toBe(socket);
        });
    });

    describe("reconnectWebSocket", () => {
        it("should set up a reconnection interval", () => {
            jest.spyOn(global, "setInterval");

            const reconnectWebSocket = websocketModule.reconnectWebSocket;
            reconnectWebSocket();

            expect(setInterval).toHaveBeenCalled();

            jest.advanceTimersByTime(5000);
        });

        it("should not schedule a second interval when called twice (singleton)", () => {
            const setIntervalSpy = jest.spyOn(global, "setInterval");

            const reconnectWebSocket = websocketModule.reconnectWebSocket;
            reconnectWebSocket();
            reconnectWebSocket();
            reconnectWebSocket();

            // Only the first call should have scheduled an interval —
            // the singleton guard short-circuits the rest. This is the
            // bug we fixed in PR 3 (was creating a fresh interval on
            // every onclose).
            expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe("sendActionToAgent", () => {
        it("should throw error if no websocket connection", async () => {
            const sendActionToAgent = websocketModule.sendActionToAgent;

            await expect(async () => {
                await sendActionToAgent({
                    actionName: "testAction",
                    parameters: { test: true },
                });
            }).rejects.toThrow();
        });
    });
});

