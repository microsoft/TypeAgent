// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

jest.mock("../../src/extension/serviceWorker/storage", () => ({
    getSettings: jest.fn().mockImplementation(() =>
        Promise.resolve({
            websocketHost: "ws://localhost:8080/",
        }),
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
        it("should create a WebSocket connection", async () => {
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
            // Make sure setInterval is properly mocked
            jest.spyOn(global, "setInterval");

            const reconnectWebSocket = websocketModule.reconnectWebSocket;
            reconnectWebSocket();

            // Verify setInterval was called
            expect(setInterval).toHaveBeenCalled();

            // Test if the callback works correctly
            // by advancing timers and checking what happens
            jest.advanceTimersByTime(5000);
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
