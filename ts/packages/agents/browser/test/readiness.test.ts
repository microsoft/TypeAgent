// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the browser agent's readiness wiring.
 *
 * Pure-decision (`evaluateBrowserReadiness`) and session-client probe
 * (`hasClientForSession`) — both exercised without spawning an actual
 * WebSocket server.
 */

import {
    BrowserSeenRecord,
    SEEN_FILE,
    evaluateBrowserReadiness,
    hasClientForSession,
    loadSeenRecord,
    recordClientSeen,
} from "../src/agent/readiness.mjs";
import type {
    AgentWebSocketServer,
    BrowserClient,
} from "../src/agent/agentWebSocketServer.mjs";
import type { Storage } from "@typeagent/agent-sdk";

describe("evaluateBrowserReadiness", () => {
    test("ready when in-process control is available (Electron-shell mode)", () => {
        // Both connection paths checked: the in-process path wins
        // regardless of WebSocket state. seenClientBefore is irrelevant
        // when we're already ready.
        expect(
            evaluateBrowserReadiness({
                hasInProcessControl: true,
                hasConnectedClient: false,
                seenClientBefore: false,
            }),
        ).toEqual({ state: "ready" });
        expect(
            evaluateBrowserReadiness({
                hasInProcessControl: true,
                hasConnectedClient: true,
                seenClientBefore: true,
            }),
        ).toEqual({ state: "ready" });
    });

    test("ready when an extension client is connected", () => {
        expect(
            evaluateBrowserReadiness({
                hasInProcessControl: false,
                hasConnectedClient: true,
                seenClientBefore: true,
            }),
        ).toEqual({ state: "ready" });
    });

    test("setup-required (NEW-USER branch) when no connection AND never seen one before", () => {
        // First-time setup. Message must point at install instructions.
        const r = evaluateBrowserReadiness({
            hasInProcessControl: false,
            hasConnectedClient: false,
            seenClientBefore: false,
        });
        expect(r.state).toBe("setup-required");
        expect(r.message).toMatch(/hasn't connected yet/i);
        expect(r.details).toMatch(/installed the extension/i);
        expect(r.details).toMatch(/packages\/agents\/browser\/README/);
    });

    test("setup-required (RETURNING-USER branch) when no connection BUT seen one before", () => {
        // Returning user, browser is just closed. Message must NOT
        // suggest the user is missing setup — the install step is done.
        const r = evaluateBrowserReadiness({
            hasInProcessControl: false,
            hasConnectedClient: false,
            seenClientBefore: true,
        });
        expect(r.state).toBe("setup-required");
        expect(r.message).toMatch(/isn't currently connected/i);
        expect(r.details).not.toMatch(/installed the extension/i);
        expect(r.details).not.toMatch(/README/);
        expect(r.details).toMatch(/auto-connect/i);
    });
});

describe("hasClientForSession", () => {
    function makeServer(clients: BrowserClient[]): AgentWebSocketServer {
        // Minimal stub — only listClients is exercised. Cast through
        // unknown to avoid mocking the entire surface.
        return {
            listClients: () => clients,
        } as unknown as AgentWebSocketServer;
    }

    function fakeClient(sessionId: string): BrowserClient {
        return {
            id: `client-${sessionId}-${Math.random().toString(36).slice(2, 7)}`,
            sessionId,
            type: "extension",
            socket: {} as any,
            connectedAt: new Date(),
            lastActivity: new Date(),
        };
    }

    test("returns false when server is undefined (initial probe before updateAgentContext)", () => {
        expect(hasClientForSession(undefined, "default")).toBe(false);
    });

    test("returns false when no clients are connected", () => {
        expect(hasClientForSession(makeServer([]), "default")).toBe(false);
    });

    test("returns true when any client matches the session", () => {
        const server = makeServer([fakeClient("default"), fakeClient("other")]);
        expect(hasClientForSession(server, "default")).toBe(true);
    });

    test("filters by session — clients on other sessions don't satisfy us", () => {
        const server = makeServer([
            fakeClient("session-A"),
            fakeClient("session-B"),
        ]);
        expect(hasClientForSession(server, "default")).toBe(false);
    });
});

describe("loadSeenRecord / recordClientSeen", () => {
    // Minimal in-memory Storage stub. Only the read/write/exists methods
    // the readiness module touches — every other method on Storage
    // throws so we catch accidental coupling.
    function makeStorage(initial?: Record<string, string>): Storage {
        const files = new Map<string, string>(Object.entries(initial ?? {}));
        return {
            async read(path: string, encoding: string) {
                if (encoding !== "utf8") {
                    throw new Error("only utf8 expected");
                }
                if (!files.has(path)) {
                    const e: any = new Error(`ENOENT: ${path}`);
                    e.code = "ENOENT";
                    throw e;
                }
                return files.get(path) as any;
            },
            async write(path: string, content: string | Buffer) {
                files.set(path, String(content));
            },
            async exists(path: string) {
                return files.has(path);
            },
            // The following are required by Storage but unused here.
            async list() {
                throw new Error("not implemented");
            },
            async delete() {
                throw new Error("not implemented");
            },
        } as unknown as Storage;
    }

    test("loadSeenRecord returns undefined when storage is undefined", async () => {
        expect(await loadSeenRecord(undefined)).toBeUndefined();
    });

    test("loadSeenRecord returns undefined when the file doesn't exist", async () => {
        const storage = makeStorage();
        expect(await loadSeenRecord(storage)).toBeUndefined();
    });

    test("loadSeenRecord returns undefined for malformed JSON (swallowed)", async () => {
        // Defensive: a corrupt seen file shouldn't crash readiness; we
        // just degrade to "not seen" and the next connect will rewrite.
        const storage = makeStorage({
            [SEEN_FILE]: "{ this is not json",
        });
        expect(await loadSeenRecord(storage)).toBeUndefined();
    });

    test("loadSeenRecord returns undefined when fields don't validate", async () => {
        const storage = makeStorage({
            [SEEN_FILE]: JSON.stringify({ firstSeen: 12345 }),
        });
        expect(await loadSeenRecord(storage)).toBeUndefined();
    });

    test("loadSeenRecord returns the record on a happy round-trip", async () => {
        const stamp: BrowserSeenRecord = {
            firstSeen: "2026-05-01T00:00:00.000Z",
            lastSeen: "2026-05-08T12:34:00.000Z",
        };
        const storage = makeStorage({
            [SEEN_FILE]: JSON.stringify(stamp),
        });
        expect(await loadSeenRecord(storage)).toEqual(stamp);
    });

    test("recordClientSeen creates the file on first call (no existing record)", async () => {
        const storage = makeStorage();
        await recordClientSeen(storage);
        const r = await loadSeenRecord(storage);
        expect(r).toBeDefined();
        expect(r!.firstSeen).toEqual(r!.lastSeen);
        // ISO 8601 sanity check
        expect(r!.firstSeen).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test("recordClientSeen preserves firstSeen on subsequent calls and bumps lastSeen", async () => {
        // Important behavior — firstSeen is the long-term install-date
        // signal we care about for messaging; lastSeen is fresh on each
        // connect.
        const storage = makeStorage({
            [SEEN_FILE]: JSON.stringify({
                firstSeen: "2020-01-01T00:00:00.000Z",
                lastSeen: "2020-01-01T00:00:00.000Z",
            }),
        });
        await recordClientSeen(storage);
        const r = await loadSeenRecord(storage);
        expect(r!.firstSeen).toBe("2020-01-01T00:00:00.000Z");
        expect(r!.lastSeen).not.toBe("2020-01-01T00:00:00.000Z");
    });

    test("recordClientSeen is a no-op when storage is undefined", async () => {
        // Should not throw. Nothing to assert on the result; the test
        // passes if the call resolves.
        await expect(recordClientSeen(undefined)).resolves.toBeUndefined();
    });
});
