// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

jest.mock("ws", () => {
    const connectionHandlers: Function[] = [];
    const errorHandlers: Function[] = [];
    const listeningHandlers: Function[] = [];
    let lastVerifyClient: any;
    const mockWss: any = {
        on: jest.fn((event: string, handler: Function) => {
            if (event === "connection") connectionHandlers.push(handler);
            if (event === "error") errorHandlers.push(handler);
            if (event === "listening") listeningHandlers.push(handler);
        }),
        once: jest.fn((event: string, handler: Function) => {
            if (event === "connection") connectionHandlers.push(handler);
            if (event === "error") errorHandlers.push(handler);
            if (event === "listening") listeningHandlers.push(handler);
        }),
        removeListener: jest.fn(),
        close: jest.fn((cb?: () => void) => {
            if (cb) cb();
        }),
        address: jest.fn(() => ({ port: 8081, family: "IPv4", address: "" })),
        _triggerConnection: (ws: any, req: any) => {
            connectionHandlers.forEach((h) => h(ws, req));
        },
        _triggerListening: () => {
            listeningHandlers.forEach((h) => h());
        },
        _getVerifyClient: () => lastVerifyClient,
    };
    return {
        WebSocketServer: jest.fn((opts: any) => {
            lastVerifyClient = opts?.verifyClient;
            // Auto-fire 'listening' on next tick so start() resolves.
            setTimeout(() => mockWss._triggerListening(), 0);
            return mockWss;
        }),
        WebSocket: { OPEN: 1 },
        __mockWss: mockWss,
    };
});

jest.mock("@typeagent/agent-rpc/channel", () => ({
    createChannelProviderAdapter: jest.fn(() => ({
        createChannel: jest.fn(() => ({})),
        notifyMessage: jest.fn(),
        notifyDisconnected: jest.fn(),
    })),
}));

jest.mock("@typeagent/agent-rpc/rpc", () => ({
    createRpc: jest.fn(() => ({
        send: jest.fn(),
        invoke: jest.fn(),
    })),
}));

jest.mock("debug", () => {
    return jest.fn(() => jest.fn());
});

import { AgentWebSocketServer } from "../../src/agent/agentWebSocketServer.mjs";
import { isAllowedAgentOrigin } from "../../src/agent/originAllowlist.mjs";
import { createAgentOriginAllowlist } from "@typeagent/websocket-utils/originAllowlist";

function makeMockSocket() {
    const handlers: Record<string, Function> = {};
    return {
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn((event: string, handler: Function) => {
            handlers[event] = handler;
        }),
        readyState: 1,
        _handlers: handlers,
    };
}

function makeMockReq(clientId: string, sessionId: string) {
    return {
        url: `/?clientId=${clientId}&sessionId=${sessionId}`,
    };
}

function getWss(): any {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const wsMod = require("ws");
    return wsMod.__mockWss;
}

function connectClient(
    wss: any,
    clientId: string,
    sessionId: string,
): ReturnType<typeof makeMockSocket> {
    const socket = makeMockSocket();
    const req = makeMockReq(clientId, sessionId);
    wss._triggerConnection(socket, req);
    return socket;
}

describe("AgentWebSocketServer", () => {
    let server: AgentWebSocketServer;
    let wss: any;

    beforeEach(async () => {
        jest.clearAllMocks();
        server = await AgentWebSocketServer.start(8081);
        wss = getWss();
    });

    afterEach(async () => {
        await server.close();
    });

    describe("same clientId in different sessions don't collide", () => {
        it("should store clients independently per session", () => {
            server.registerSession("s1", {});
            server.registerSession("s2", {});

            connectClient(wss, "ext1", "s1");
            connectClient(wss, "ext1", "s2");

            const clientS1 = server.getClient("s1", "ext1");
            const clientS2 = server.getClient("s2", "ext1");

            expect(clientS1).not.toBeNull();
            expect(clientS2).not.toBeNull();
            expect(clientS1).not.toBe(clientS2);
            expect(clientS1!.sessionId).toBe("s1");
            expect(clientS2!.sessionId).toBe("s2");
        });
    });

    describe("duplicate detection is scoped per session", () => {
        it("should close the old socket when the same (sessionId, clientId) connects twice", () => {
            server.registerSession("s1", {});

            const socket1 = connectClient(wss, "ext1", "s1");
            const socket2 = connectClient(wss, "ext1", "s1");

            // First socket should have been closed as duplicate
            expect(socket1.close).toHaveBeenCalledWith(1013, "duplicate");

            // Second socket should be the current client
            const client = server.getClient("s1", "ext1");
            expect(client).not.toBeNull();
            expect(client!.socket).toBe(socket2);
        });

        it("should NOT close a client with the same clientId in a different session", () => {
            server.registerSession("s1", {});
            server.registerSession("s2", {});

            const socketS1 = connectClient(wss, "ext1", "s1");
            // Connecting same clientId in s2 should not affect s1
            connectClient(wss, "ext1", "s2");

            expect(socketS1.close).not.toHaveBeenCalled();

            const clientS1 = server.getClient("s1", "ext1");
            expect(clientS1).not.toBeNull();
            expect(clientS1!.socket).toBe(socketS1);
        });
    });

    describe("unregisterSession only removes its own session's clients", () => {
        it("should remove clients from the unregistered session only", () => {
            server.registerSession("s1", {});
            server.registerSession("s2", {});

            connectClient(wss, "ext1", "s1");
            connectClient(wss, "ext1", "s2");

            server.unregisterSession("s1");

            expect(server.getClient("s1", "ext1")).toBeNull();
            expect(server.getClient("s2", "ext1")).not.toBeNull();
        });

        it("should leave the other session's clients in listClients()", () => {
            server.registerSession("s1", {});
            server.registerSession("s2", {});

            connectClient(wss, "client1", "s1");
            connectClient(wss, "client2", "s2");

            server.unregisterSession("s1");

            const clients = server.listClients();
            expect(clients).toHaveLength(1);
            expect(clients[0].id).toBe("client2");
            expect(clients[0].sessionId).toBe("s2");
        });
    });

    describe("getActiveClient returns the right client per session", () => {
        it("should track activeClientId independently per session", () => {
            server.registerSession("s1", {});
            server.registerSession("s2", {});

            connectClient(wss, "clientA", "s1");
            connectClient(wss, "clientB", "s2");

            // Each session auto-selects its first client as active
            const activeS1 = server.getActiveClient("s1");
            const activeS2 = server.getActiveClient("s2");

            expect(activeS1).not.toBeNull();
            expect(activeS1!.id).toBe("clientA");
            expect(activeS1!.sessionId).toBe("s1");

            expect(activeS2).not.toBeNull();
            expect(activeS2!.id).toBe("clientB");
            expect(activeS2!.sessionId).toBe("s2");
        });

        it("should return null for a session with no registered handlers", () => {
            const result = server.getActiveClient("nonexistent");
            expect(result).toBeNull();
        });
    });

    describe("listClients returns clients from all sessions", () => {
        it("should aggregate clients across sessions", () => {
            server.registerSession("s1", {});
            server.registerSession("s2", {});

            connectClient(wss, "ext1", "s1");
            connectClient(wss, "ext2", "s2");

            const clients = server.listClients();
            expect(clients).toHaveLength(2);

            const ids = clients.map((c) => `${c.sessionId}:${c.id}`).sort();
            expect(ids).toEqual(["s1:ext1", "s2:ext2"]);
        });

        it("should return empty array when no clients are connected", () => {
            expect(server.listClients()).toHaveLength(0);
        });
    });

    describe("close event cleans up the nested map", () => {
        it("should remove the client from getClient after disconnect", () => {
            server.registerSession("s1", {});

            const socket = connectClient(wss, "ext1", "s1");

            expect(server.getClient("s1", "ext1")).not.toBeNull();

            // Simulate the close event
            socket._handlers["close"]();

            expect(server.getClient("s1", "ext1")).toBeNull();
        });

        it("should remove the outer map entry when the session's inner map becomes empty", () => {
            server.registerSession("s1", {});

            const socket = connectClient(wss, "ext1", "s1");

            // Simulate disconnect
            socket._handlers["close"]();

            // After the only client disconnects, listClients should be empty
            expect(server.listClients()).toHaveLength(0);

            // Reconnecting should still work (the server recreates the inner map)
            connectClient(wss, "ext1", "s1");
            expect(server.getClient("s1", "ext1")).not.toBeNull();
        });

        it("should not affect clients in other sessions when one disconnects", () => {
            server.registerSession("s1", {});
            server.registerSession("s2", {});

            const socketS1 = connectClient(wss, "ext1", "s1");
            connectClient(wss, "ext1", "s2");

            // Disconnect from s1 only
            socketS1._handlers["close"]();

            expect(server.getClient("s1", "ext1")).toBeNull();
            expect(server.getClient("s2", "ext1")).not.toBeNull();
        });
    });

    describe("client type detection", () => {
        it("should detect inlineBrowser as electron type", () => {
            server.registerSession("s1", {});

            connectClient(wss, "inlineBrowser", "s1");

            const client = server.getClient("s1", "inlineBrowser");
            expect(client).not.toBeNull();
            expect(client!.type).toBe("electron");
        });

        it("should detect other clientIds as extension type", () => {
            server.registerSession("s1", {});

            connectClient(wss, "chrome-ext-abc123", "s1");

            const client = server.getClient("s1", "chrome-ext-abc123");
            expect(client).not.toBeNull();
            expect(client!.type).toBe("extension");
        });
    });

    describe("connection rejection", () => {
        it("should close the socket if clientId is missing", () => {
            const socket = makeMockSocket();
            const req = { url: "/?sessionId=s1" };
            wss._triggerConnection(socket, req);

            expect(socket.send).toHaveBeenCalledWith(
                expect.stringContaining("Missing clientId or sessionId"),
            );
            expect(socket.close).toHaveBeenCalled();
        });

        it("should close the socket if sessionId is missing", () => {
            const socket = makeMockSocket();
            const req = { url: "/?clientId=ext1" };
            wss._triggerConnection(socket, req);

            expect(socket.send).toHaveBeenCalledWith(
                expect.stringContaining("Missing clientId or sessionId"),
            );
            expect(socket.close).toHaveBeenCalled();
        });
    });

    describe("Origin allowlist (verifyClient)", () => {
        // verifyClient is a synchronous gate the WebSocket server runs on
        // every upgrade. Anything we reject here never fires `connection`.
        function verify(origin: string | undefined): {
            ok: boolean;
            code?: number;
        } {
            const verifyClient = wss._getVerifyClient();
            let result: { ok: boolean; code?: number } = { ok: false };
            verifyClient(
                { origin, req: { headers: { origin } } } as any,
                (ok: boolean, code?: number) => {
                    result = { ok, code };
                },
            );
            return result;
        }

        it("accepts chrome-extension Origin", () => {
            expect(verify("chrome-extension://abc123")).toEqual({ ok: true });
        });

        it("accepts localhost http Origin", () => {
            expect(verify("http://localhost:5173")).toEqual({ ok: true });
        });

        it("accepts undefined Origin (Node ws clients)", () => {
            expect(verify(undefined)).toEqual({ ok: true });
        });

        it("rejects arbitrary web Origin with 403", () => {
            expect(verify("https://evil.example.com")).toEqual({
                ok: false,
                code: 403,
            });
        });
    });

    describe("close() tears down tracked clients", () => {
        it("closes every client across every session map", async () => {
            // Fresh server so we can assert close behavior independently
            // of the suite's afterEach.
            const local = await AgentWebSocketServer.start(0);
            local.registerSession("s1", {});
            local.registerSession("s2", {});
            const a = connectClient(wss, "ext1", "s1");
            const b = connectClient(wss, "ext2", "s2");
            await local.close();
            expect(a.close).toHaveBeenCalled();
            expect(b.close).toHaveBeenCalled();
        });
    });
});

describe("isAllowedAgentOrigin", () => {
    it("returns true for chrome-extension:// origins", () => {
        expect(isAllowedAgentOrigin("chrome-extension://abc")).toBe(true);
    });
    it("returns true for moz-extension:// origins", () => {
        expect(isAllowedAgentOrigin("moz-extension://xyz")).toBe(true);
    });
    it("returns true for localhost http(s) origins", () => {
        expect(isAllowedAgentOrigin("http://localhost")).toBe(true);
        expect(isAllowedAgentOrigin("http://localhost:1234")).toBe(true);
        expect(isAllowedAgentOrigin("https://localhost:5173")).toBe(true);
        expect(isAllowedAgentOrigin("http://127.0.0.1:8081")).toBe(true);
    });
    it("returns true for IPv6 loopback origins", () => {
        // Browsers running on IPv6-first networks may report the
        // origin with the bracketed `[::1]` host. Important for the
        // Electron shell's inline browser when bound to ::1.
        expect(isAllowedAgentOrigin("http://[::1]")).toBe(true);
        expect(isAllowedAgentOrigin("http://[::1]:8081")).toBe(true);
        expect(isAllowedAgentOrigin("https://[::1]:5173")).toBe(true);
    });
    it("returns true for missing/null Origin", () => {
        expect(isAllowedAgentOrigin(undefined)).toBe(true);
        expect(isAllowedAgentOrigin("")).toBe(true);
        expect(isAllowedAgentOrigin("null")).toBe(true);
    });
    it("rejects arbitrary http(s) origins", () => {
        expect(isAllowedAgentOrigin("https://evil.example.com")).toBe(false);
        expect(isAllowedAgentOrigin("http://attacker.test:80")).toBe(false);
    });
    it("rejects file://, ftp:// and other non-http schemes", () => {
        expect(isAllowedAgentOrigin("file://localhost/etc/passwd")).toBe(false);
        expect(isAllowedAgentOrigin("ftp://localhost")).toBe(false);
    });
    it("rejects malformed Origin strings", () => {
        expect(isAllowedAgentOrigin("not a url")).toBe(false);
    });
});

// Direct tests of the shared factory cover the policy knobs we expose
// (`allowNullOrigin`, the `string[]` header normalization). The
// agent-side wrapper above tests the default `allowNullOrigin: true`
// branch as a side effect; these tests add explicit coverage for the
// view-server posture where `"null"` must be rejected.
describe("createAgentOriginAllowlist", () => {
    describe("allowNullOrigin option", () => {
        it('rejects Origin: "null" when allowNullOrigin is false', () => {
            const allow = createAgentOriginAllowlist({
                allowNullOrigin: false,
            });
            expect(allow("null")).toBe(false);
        });
        it("still allows missing/empty Origin when allowNullOrigin is false", () => {
            const allow = createAgentOriginAllowlist({
                allowNullOrigin: false,
            });
            expect(allow(undefined)).toBe(true);
            expect(allow("")).toBe(true);
        });
        it("still allows loopback origins when allowNullOrigin is false", () => {
            const allow = createAgentOriginAllowlist({
                allowNullOrigin: false,
            });
            expect(allow("http://localhost:1234")).toBe(true);
            expect(allow("http://127.0.0.1")).toBe(true);
            expect(allow("http://[::1]:5173")).toBe(true);
        });
        it('accepts Origin: "null" by default (backwards-compat)', () => {
            const allow = createAgentOriginAllowlist();
            expect(allow("null")).toBe(true);
        });
        it('accepts Origin: "null" when allowNullOrigin is explicitly true', () => {
            const allow = createAgentOriginAllowlist({
                allowNullOrigin: true,
            });
            expect(allow("null")).toBe(true);
        });
    });
    describe("string[] header normalization", () => {
        // Node's TS header types claim repeated headers may surface as
        // `string[]`. At runtime the parser joins repeated Origin
        // headers into a single comma-separated string, so the array
        // form is not expected — but if it ever does arrive, anything
        // other than a single entry is inherently ambiguous and must be
        // rejected.
        it("rejects an empty array", () => {
            const allow = createAgentOriginAllowlist();
            expect(allow([])).toBe(false);
        });
        it("rejects an array with more than one entry", () => {
            const allow = createAgentOriginAllowlist();
            expect(
                allow(["http://localhost", "https://evil.example.com"]),
            ).toBe(false);
            // Even two loopback entries are ambiguous and rejected.
            expect(allow(["http://localhost", "http://127.0.0.1"])).toBe(false);
        });
        it("normalizes a single-element array to that entry", () => {
            const allow = createAgentOriginAllowlist();
            expect(allow(["http://localhost:1234"])).toBe(true);
            expect(allow(["https://evil.example.com"])).toBe(false);
        });
    });
});
