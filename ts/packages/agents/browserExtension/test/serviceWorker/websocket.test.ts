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
    discoverPort: jest
        .fn()
        .mockImplementation(() =>
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

    describe("agentRpc rebind across reconnect", () => {
        // Drives ensureWebsocketConnected to completion: flushes the
        // getSettings/discoverPort microtasks and fires the MockWebSocket's
        // 10ms open timer.
        async function connectAndOpen(): Promise<any> {
            const p = websocketModule.ensureWebsocketConnected();
            await jest.advanceTimersByTimeAsync(20);
            return p;
        }

        it("reuses the same agentRpc instance across a reconnect (rebind, not recreate)", async () => {
            const socket1 = await connectAndOpen();
            expect(socket1).toBeDefined();
            const rpc1 = websocketModule.getAgentRpc();
            expect(rpc1).toBeDefined();

            // Drop the connection.
            socket1.close();
            expect(websocketModule.getWebSocket()).toBeUndefined();
            // Rebindable rpc is kept across the drop rather than nulled.
            expect(websocketModule.getAgentRpc()).toBe(rpc1);

            // Reconnect.
            const socket2 = await connectAndOpen();
            expect(socket2).toBeDefined();
            expect(socket2).not.toBe(socket1);
            // Same object, rebound to the fresh channel.
            expect(websocketModule.getAgentRpc()).toBe(rpc1);
        });

        it("ignores a stale onclose from a superseded socket", async () => {
            const socket1 = await connectAndOpen();
            const rpc1 = websocketModule.getAgentRpc();

            socket1.close();
            const socket2 = await connectAndOpen();
            expect(websocketModule.getWebSocket()).toBe(socket2);

            // The abandoned socket's onclose fires late; it must not tear down
            // the live connection or the rebound rpc.
            socket1.onclose({ reason: "" });

            expect(websocketModule.getWebSocket()).toBe(socket2);
            expect(websocketModule.getAgentRpc()).toBe(rpc1);
        });

        it("fails fast (does not poison) after a disconnect", async () => {
            await connectAndOpen();
            const socket = websocketModule.getWebSocket();
            socket.close();

            // Rebindable rpc rejects calls in the disconnected window instead of
            // hanging, and is not permanently poisoned.
            await expect(
                websocketModule.sendActionToAgent({
                    actionName: "testAction",
                    parameters: {},
                }),
            ).rejects.toThrow("Agent channel disconnected");
        });
    });
});
