// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createDiscoveryHandlers } from "@typeagent/agent-server-protocol";
import {
    clearVisualStudioBridgeCredentialCacheForTests,
    createVisualStudioClientHello,
    createVisualStudioDiscoveryRequestAuth,
    createVisualStudioSecureFrame,
    getVisualStudioBridgeCredentialPath,
    loadOrCreateVisualStudioBridgeCredential,
    protectVisualStudioDiscoveryResponse,
    VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV,
    verifyVisualStudioDiscoveryResponse,
    verifyVisualStudioSecureFrame,
    verifyVisualStudioServerHello,
    type VisualStudioBridgeCredential,
    type VisualStudioSessionKeys,
} from "@typeagent/websocket-utils/visualStudioBridgeAuth";
import { AddressInfo, createServer } from "node:net";
import WebSocket from "ws";
import { VisualStudioBridge } from "@typeagent/visualstudio-agent/agent/handlers";

type TestClient = {
    ws: WebSocket;
    sessionId: string;
    sessionExpiresAt: number;
    keys: VisualStudioSessionKeys;
    receiveSequence: number;
    sendSequence: number;
};

type RequestPayload = {
    actionName: string;
    parameters: unknown;
};

function makeCredential(fill: number): VisualStudioBridgeCredential {
    const secret = Buffer.alloc(32, fill);
    return {
        version: 1,
        credentialId: createHash("sha256")
            .update(secret)
            .digest("hex")
            .slice(0, 32),
        secret,
    };
}

function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
    });
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error("Timed out waiting for WebSocket message")),
            2_000,
        );
        ws.once("message", (data) => {
            clearTimeout(timer);
            resolve(JSON.parse(data.toString()) as unknown);
        });
        ws.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

function waitForClose(
    ws: WebSocket,
): Promise<{ code: number; reason: string }> {
    return new Promise((resolve) => {
        ws.once("close", (code, reason) =>
            resolve({ code, reason: reason.toString() }),
        );
    });
}

async function connectAuthenticated(
    bridge: VisualStudioBridge,
    credential: VisualStudioBridgeCredential,
): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    await waitForOpen(ws);
    const clientHello = createVisualStudioClientHello(
        credential,
        randomBytes(16).toString("hex"),
    );
    ws.send(JSON.stringify(clientHello));
    const verified = verifyVisualStudioServerHello(
        credential,
        clientHello,
        await waitForMessage(ws),
    );
    if (verified === undefined) {
        throw new Error("Server hello did not authenticate");
    }
    return {
        ws,
        sessionId: verified.hello.sessionId,
        sessionExpiresAt: verified.hello.expiresAt,
        keys: verified.keys,
        receiveSequence: 0,
        sendSequence: 0,
    };
}

async function receiveRequest(
    client: TestClient,
): Promise<{ id: string; payload: RequestPayload }> {
    const verified = verifyVisualStudioSecureFrame<RequestPayload>(
        await waitForMessage(client.ws),
        client.sessionId,
        client.receiveSequence + 1,
        "request",
        client.keys.serverToClient,
        Date.now(),
        client.sessionExpiresAt,
    );
    if (verified === undefined) {
        throw new Error("Request frame did not authenticate");
    }
    client.receiveSequence = verified.frame.sequence;
    return { id: verified.frame.id, payload: verified.payload };
}

function sendResponse(client: TestClient, id: string, result: unknown): void {
    client.ws.send(
        JSON.stringify(
            createVisualStudioSecureFrame(
                client.sessionId,
                ++client.sendSequence,
                "response",
                id,
                { id, success: true, result },
                client.keys.clientToServer,
            ),
        ),
    );
}

describe("Visual Studio bridge authentication", () => {
    const credential = makeCredential(0x31);
    let bridge: VisualStudioBridge | undefined;
    const clients: WebSocket[] = [];

    afterEach(async () => {
        for (const client of clients.splice(0)) {
            client.terminate();
        }
        await bridge?.stop();
        bridge = undefined;
    });

    it("does not route actions to a client before authentication", async () => {
        bridge = await VisualStudioBridge.start(0, {
            credential,
            sendTimeoutMs: 100,
        });
        const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
        clients.push(ws);
        await waitForOpen(ws);
        ws.send(
            JSON.stringify({
                id: "0".repeat(32),
                success: true,
            }),
        );
        const closed = await waitForClose(ws);
        expect(closed.code).toBe(1008);
        expect(closed.reason).toBe("Authentication failed");
        expect(bridge.getConnectedCount()).toBe(0);
        await expect(bridge.send("executeCommand", {})).rejects.toThrow(
            "No host plugin connected",
        );
    });

    it("rejects wrong, expired, and replayed client credentials", async () => {
        bridge = await VisualStudioBridge.start(0, { credential });

        const wrongWs = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
        clients.push(wrongWs);
        await waitForOpen(wrongWs);
        const wrongHello = createVisualStudioClientHello(
            makeCredential(0x32),
            randomBytes(16).toString("hex"),
        );
        const wrongClose = waitForClose(wrongWs);
        wrongWs.send(JSON.stringify(wrongHello));
        expect((await wrongClose).code).toBe(1008);

        const expiredWs = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
        clients.push(expiredWs);
        await waitForOpen(expiredWs);
        const expiredHello = createVisualStudioClientHello(
            credential,
            randomBytes(16).toString("hex"),
            Date.now() - 60_000,
        );
        const expiredClose = waitForClose(expiredWs);
        expiredWs.send(JSON.stringify(expiredHello));
        expect((await expiredClose).code).toBe(1008);

        const firstWs = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
        clients.push(firstWs);
        await waitForOpen(firstWs);
        const replayedHello = createVisualStudioClientHello(
            credential,
            randomBytes(16).toString("hex"),
        );
        firstWs.send(JSON.stringify(replayedHello));
        expect(
            verifyVisualStudioServerHello(
                credential,
                replayedHello,
                await waitForMessage(firstWs),
            ),
        ).toBeDefined();

        const replayWs = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
        clients.push(replayWs);
        await waitForOpen(replayWs);
        const replayClose = waitForClose(replayWs);
        replayWs.send(JSON.stringify(replayedHello));
        expect((await replayClose).code).toBe(1008);
        expect(bridge.getConnectedCount()).toBe(1);
    });

    it("authenticates requests and responses on the negotiated session", async () => {
        bridge = await VisualStudioBridge.start(0, { credential });
        const client = await connectAuthenticated(bridge, credential);
        clients.push(client.ws);

        const resultPromise = bridge.send("executeCommand", {
            commandName: "File.SaveAll",
        });
        const request = await receiveRequest(client);
        expect(request.payload).toEqual({
            actionName: "executeCommand",
            parameters: { commandName: "File.SaveAll" },
        });
        sendResponse(client, request.id, { ok: true });
        await expect(resultPromise).resolves.toEqual({ ok: true });
    });

    it("binds responses to the exact authenticated client and session", async () => {
        bridge = await VisualStudioBridge.start(0, { credential });
        const older = await connectAuthenticated(bridge, credential);
        const newest = await connectAuthenticated(bridge, credential);
        clients.push(older.ws, newest.ws);

        const resultPromise = bridge.send("getActiveFile", {});
        const request = await receiveRequest(newest);
        const olderClosed = waitForClose(older.ws);
        sendResponse(older, request.id, { forged: true });
        expect((await olderClosed).code).toBe(1008);

        sendResponse(newest, request.id, { path: "safe.cs" });
        await expect(resultPromise).resolves.toEqual({ path: "safe.cs" });
    });

    it("ignores authenticated late responses without disrupting live requests", async () => {
        bridge = await VisualStudioBridge.start(0, {
            credential,
            sendTimeoutMs: 50,
        });
        const client = await connectAuthenticated(bridge, credential);
        clients.push(client.ws);

        const timedOutResult = bridge.send("getActiveFile", {});
        const timedOutRequest = await receiveRequest(client);
        await expect(timedOutResult).rejects.toThrow("timed out");

        const liveResult = bridge.send("getSolutionInfo", {});
        const liveRequest = await receiveRequest(client);
        sendResponse(client, timedOutRequest.id, { late: true });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(client.ws.readyState).toBe(WebSocket.OPEN);
        expect(bridge.getConnectedCount()).toBe(1);

        sendResponse(client, liveRequest.id, { name: "safe" });
        await expect(liveResult).resolves.toEqual({ name: "safe" });
    });

    it("negotiates a fresh session after reconnect and keeps newest-client routing", async () => {
        bridge = await VisualStudioBridge.start(0, { credential });
        const first = await connectAuthenticated(bridge, credential);
        clients.push(first.ws);
        const firstClosed = waitForClose(first.ws);
        first.ws.close();
        await firstClosed;

        const reconnected = await connectAuthenticated(bridge, credential);
        const second = await connectAuthenticated(bridge, credential);
        clients.push(reconnected.ws, second.ws);
        expect(reconnected.sessionId).not.toBe(first.sessionId);

        const resultPromise = bridge.send("getSolutionInfo", {});
        const request = await receiveRequest(second);
        sendResponse(second, request.id, "newest");
        await expect(resultPromise).resolves.toBe("newest");

        const secondClosed = waitForClose(second.ws);
        second.ws.close();
        await secondClosed;
        const fallbackPromise = bridge.send("getActiveFile", {});
        const fallbackRequest = await receiveRequest(reconnected);
        sendResponse(reconnected, fallbackRequest.id, "fallback");
        await expect(fallbackPromise).resolves.toBe("fallback");
    });

    it("keeps authentication mandatory on an explicit port", async () => {
        const probe = await new Promise<import("node:net").Server>(
            (resolve) => {
                const server = createServer();
                server.listen(0, "127.0.0.1", () => resolve(server));
            },
        );
        const port = (probe.address() as AddressInfo).port;
        await new Promise<void>((resolve) => probe.close(() => resolve()));

        bridge = await VisualStudioBridge.start(port, { credential });
        expect(bridge.port).toBe(port);
        const unauthenticated = new WebSocket(`ws://127.0.0.1:${port}`);
        clients.push(unauthenticated);
        await waitForOpen(unauthenticated);
        const closed = waitForClose(unauthenticated);
        unauthenticated.send("{}");
        expect((await closed).code).toBe(1008);
    });

    it("rejects foreign and null browser origins while allowing native clients", async () => {
        bridge = await VisualStudioBridge.start(0, { credential });
        for (const origin of ["https://evil.example", "null"]) {
            const status = await new Promise<number>((resolve, reject) => {
                const ws = new WebSocket(`ws://127.0.0.1:${bridge!.port}`, {
                    headers: { Origin: origin },
                });
                ws.once("unexpected-response", (_request, response) => {
                    resolve(response.statusCode ?? 0);
                    response.resume();
                });
                ws.once("error", reject);
            });
            expect(status).toBe(403);
        }

        const nativeClient = await connectAuthenticated(bridge, credential);
        clients.push(nativeClient.ws);
        expect(bridge.getConnectedCount()).toBe(1);
    });

    it("stops handshaking sockets without allowing post-stop authentication", async () => {
        bridge = await VisualStudioBridge.start(0, { credential });
        const handshaking = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
        clients.push(handshaking);
        await waitForOpen(handshaking);
        const closed = waitForClose(handshaking);

        const stopPromise = bridge.stop();
        handshaking.send(
            JSON.stringify(
                createVisualStudioClientHello(
                    credential,
                    randomBytes(16).toString("hex"),
                ),
            ),
            () => {},
        );
        await stopPromise;
        await closed;
        expect(bridge.getConnectedCount()).toBe(0);
        bridge = undefined;
    });
});

describe("Visual Studio discovery authentication", () => {
    let userDataDirectory: string;
    let originalCredentialPath: string | undefined;

    beforeAll(async () => {
        originalCredentialPath =
            process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV];
        userDataDirectory = await fs.mkdtemp(
            path.join(os.tmpdir(), "typeagent-vs-auth-"),
        );
        process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV] = path.join(
            userDataDirectory,
            "visual-studio",
            "bridge-credential.json",
        );
        clearVisualStudioBridgeCredentialCacheForTests();
    });

    afterAll(async () => {
        clearVisualStudioBridgeCredentialCacheForTests();
        if (originalCredentialPath === undefined) {
            delete process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV];
        } else {
            process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV] =
                originalCredentialPath;
        }
        await fs.rm(userDataDirectory, { recursive: true, force: true });
    });

    it("signs the requested tuple and port while leaving unrelated discovery compatible", async () => {
        const credential = await loadOrCreateVisualStudioBridgeCredential();
        const handlers = createDiscoveryHandlers(
            (agentName) => (agentName === "visualStudio" ? 43123 : 43124),
            undefined,
            protectVisualStudioDiscoveryResponse,
        );
        const auth = createVisualStudioDiscoveryRequestAuth(
            credential,
            "visualStudio",
            "default",
        );
        const result = await handlers.lookupPort({
            agentName: "visualStudio",
            role: "default",
            auth,
        });
        expect(
            verifyVisualStudioDiscoveryResponse(
                credential,
                {
                    agentName: "visualStudio",
                    role: "default",
                    auth,
                },
                result,
            ),
        ).toBe(true);
        expect(
            verifyVisualStudioDiscoveryResponse(
                credential,
                {
                    agentName: "visualStudio",
                    role: "default",
                    auth,
                },
                { ...result, port: 6553 },
            ),
        ).toBe(false);

        await expect(
            handlers.lookupPort({ agentName: "code", role: "default" }),
        ).resolves.toEqual({ port: 43124 });
    }, 30_000);

    it("rejects missing, wrong, replayed, expired, and cross-user proofs", async () => {
        const credential = await loadOrCreateVisualStudioBridgeCredential();
        const handlers = createDiscoveryHandlers(
            () => 43123,
            undefined,
            protectVisualStudioDiscoveryResponse,
        );
        await expect(
            handlers.lookupPort({
                agentName: "visualStudio",
                role: "default",
            }),
        ).rejects.toThrow("Discovery authentication failed");

        const wrong = createVisualStudioDiscoveryRequestAuth(
            makeCredential(0x41),
            "visualStudio",
            "default",
        );
        await expect(
            handlers.lookupPort({
                agentName: "visualStudio",
                role: "default",
                auth: wrong,
            }),
        ).rejects.toThrow("Discovery authentication failed");

        const expired = createVisualStudioDiscoveryRequestAuth(
            credential,
            "visualStudio",
            "default",
            Date.now() - 60_000,
        );
        await expect(
            handlers.lookupPort({
                agentName: "visualStudio",
                role: "default",
                auth: expired,
            }),
        ).rejects.toThrow("Discovery authentication failed");

        const replayed = createVisualStudioDiscoveryRequestAuth(
            credential,
            "visualStudio",
            "default",
        );
        await expect(
            handlers.lookupPort({
                agentName: "visualStudio",
                role: "default",
                auth: replayed,
            }),
        ).resolves.toMatchObject({ port: 43123 });
        await expect(
            handlers.lookupPort({
                agentName: "visualStudio",
                role: "default",
                auth: replayed,
            }),
        ).rejects.toThrow("Discovery authentication failed");
    });
});

describe("Visual Studio bridge credential path", () => {
    const generalUserDataEnvironmentVariable = "TYPEAGENT_USER_DATA_DIR";
    let originalCredentialPath: string | undefined;
    let originalUserDataDirectory: string | undefined;
    let originalWorkingDirectory: string;
    let temporaryDirectory: string;

    beforeAll(async () => {
        originalCredentialPath =
            process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV];
        originalUserDataDirectory =
            process.env[generalUserDataEnvironmentVariable];
        originalWorkingDirectory = process.cwd();
        temporaryDirectory = await fs.mkdtemp(
            path.join(os.tmpdir(), "typeagent-vs-path-"),
        );
    });

    afterEach(() => {
        process.chdir(originalWorkingDirectory);
        delete process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV];
        delete process.env[generalUserDataEnvironmentVariable];
    });

    afterAll(async () => {
        if (originalCredentialPath !== undefined) {
            process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV] =
                originalCredentialPath;
        }
        if (originalUserDataDirectory !== undefined) {
            process.env[generalUserDataEnvironmentVariable] =
                originalUserDataDirectory;
        }
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
    });

    it("uses the stable fallback regardless of the general user-data override", () => {
        const expected = path.resolve(
            os.homedir(),
            ".typeagent",
            "visual-studio",
            "bridge-credential.json",
        );
        process.env[generalUserDataEnvironmentVariable] = path.join(
            temporaryDirectory,
            "different-process-user-data",
        );
        expect(getVisualStudioBridgeCredentialPath()).toBe(expected);
    });

    it.each(["", "   ", "relative/bridge-credential.json"])(
        "rejects an invalid dedicated override %p",
        (value) => {
            process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV] = value;
            expect(() => getVisualStudioBridgeCredentialPath()).toThrow(
                "must be a canonicalizable absolute path",
            );
        },
    );

    it("canonicalizes an absolute override independently of the working directory", async () => {
        const otherWorkingDirectory = path.join(
            temporaryDirectory,
            "working-directory",
        );
        await fs.mkdir(otherWorkingDirectory);
        const override = path.join(
            temporaryDirectory,
            "credential-root",
            "..",
            "bridge-credential.json",
        );
        const expected = path.resolve(override);
        process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV] = override;

        expect(getVisualStudioBridgeCredentialPath()).toBe(expected);
        process.chdir(otherWorkingDirectory);
        expect(getVisualStudioBridgeCredentialPath()).toBe(expected);
    });
});
