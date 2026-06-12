// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocket } from "ws";
import type { SessionContext } from "@typeagent/agent-sdk";
import {
    initializeStudioContext,
    updateStudioContext,
    closeStudioContext,
    getSharedStudioPort,
    getSharedStudioToken,
    type StudioActionContext,
} from "../src/lib/studioServiceLifecycle.js";

/** Open an authenticated socket to the shared server (Bearer capability token). */
function connectAuthed(port: number): WebSocket {
    return new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { Authorization: `Bearer ${getSharedStudioToken()}` },
    });
}

/** Build a fake SessionContext exposing only what the lifecycle touches. */
async function makeCtx(): Promise<{
    ctx: SessionContext<StudioActionContext>;
    released: () => number;
    lastCount: () => number | undefined;
    counts: () => number[];
}> {
    const agentContext = await initializeStudioContext();
    let releaseCount = 0;
    const reportedCounts: number[] = [];
    const ctx = {
        agentContext,
        registerPort: (_role: string, _port: number) => ({
            release: () => {
                releaseCount++;
            },
        }),
        notifyClientCountChanged: async (_role: string, count: number) => {
            reportedCounts.push(count);
        },
    } as unknown as SessionContext<StudioActionContext>;
    return {
        ctx,
        released: () => releaseCount,
        lastCount: () => reportedCounts[reportedCounts.length - 1],
        counts: () => reportedCounts,
    };
}

/** Poll until `predicate` is true or the timeout elapses. */
async function waitFor(
    predicate: () => boolean,
    timeoutMs = 2000,
): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error("waitFor timed out");
        }
        await new Promise((r) => setTimeout(r, 10));
    }
}

describe("studio service lifecycle", () => {
    it("starts the shared server on first enable and stops it when the last session closes", async () => {
        expect(getSharedStudioPort()).toBeUndefined();

        // Session 1 enables → server starts, port registered.
        const s1 = await makeCtx();
        await updateStudioContext(true, s1.ctx, "studioActions");
        const port = getSharedStudioPort();
        expect(typeof port).toBe("number");

        // The bound port is actually accepting (authenticated) connections.
        const socket = connectAuthed(port!);
        await new Promise<void>((resolve, reject) => {
            socket.on("open", () => resolve());
            socket.on("error", reject);
        });
        socket.close();

        // Session 2 shares the same server (no new bind).
        const s2 = await makeCtx();
        await updateStudioContext(true, s2.ctx, "studioActions");
        expect(getSharedStudioPort()).toBe(port);

        // Closing session 1 keeps the server up (session 2 still holds a ref).
        await closeStudioContext(s1.ctx);
        expect(s1.released()).toBe(1);
        expect(getSharedStudioPort()).toBe(port);

        // Closing the last session releases its registration and stops the server.
        await closeStudioContext(s2.ctx);
        expect(s2.released()).toBe(1);
        expect(getSharedStudioPort()).toBeUndefined();
    });

    it("is idempotent for repeated enable of the same schema", async () => {
        const s = await makeCtx();
        await updateStudioContext(true, s.ctx, "studioActions");
        await updateStudioContext(true, s.ctx, "studioActions");
        expect(getSharedStudioPort()).toBeDefined();
        await closeStudioContext(s.ctx);
        expect(getSharedStudioPort()).toBeUndefined();
    });

    it("reports the live client count for `@system ports`", async () => {
        const s1 = await makeCtx();
        await updateStudioContext(true, s1.ctx, "studioActions");
        const port = getSharedStudioPort()!;
        // Initial registration publishes a baseline count of 0.
        expect(s1.lastCount()).toBe(0);

        // Second session is non-primary: it reports 0 to avoid the
        // `@system ports` per-session sum double-counting the shared server.
        const s2 = await makeCtx();
        await updateStudioContext(true, s2.ctx, "studioActions");
        expect(s2.lastCount()).toBe(0);

        // A client connects → primary (s1) reports 1, non-primary stays 0.
        const socket = connectAuthed(port);
        await new Promise<void>((resolve, reject) => {
            socket.on("open", () => resolve());
            socket.on("error", reject);
        });
        await waitFor(() => s1.lastCount() === 1);
        expect(s1.lastCount()).toBe(1);
        expect(s2.lastCount()).toBe(0);

        // Client disconnects → primary returns to 0.
        socket.close();
        await waitFor(() => s1.lastCount() === 0);
        expect(s1.lastCount()).toBe(0);

        await closeStudioContext(s1.ctx);
        await closeStudioContext(s2.ctx);
        expect(getSharedStudioPort()).toBeUndefined();
    });

    it("rejects connections without a valid capability token", async () => {
        const s = await makeCtx();
        await updateStudioContext(true, s.ctx, "studioActions");
        const port = getSharedStudioPort()!;
        try {
            // No Authorization header → upgrade rejected (401).
            const noToken = new WebSocket(`ws://127.0.0.1:${port}`);
            const noTokenStatus = await new Promise<number | "open">(
                (resolve) => {
                    noToken.on("open", () => resolve("open"));
                    noToken.on("unexpected-response", (_req, res) =>
                        resolve(res.statusCode ?? 0),
                    );
                    noToken.on("error", () => resolve(0));
                },
            );
            expect(noTokenStatus).toBe(401);

            // Wrong token → also rejected.
            const badToken = new WebSocket(`ws://127.0.0.1:${port}`, {
                headers: { Authorization: `Bearer ${"0".repeat(64)}` },
            });
            const badStatus = await new Promise<number | "open">((resolve) => {
                badToken.on("open", () => resolve("open"));
                badToken.on("unexpected-response", (_req, res) =>
                    resolve(res.statusCode ?? 0),
                );
                badToken.on("error", () => resolve(0));
            });
            expect(badStatus).toBe(401);

            // Correct token → connects.
            const good = connectAuthed(port);
            await new Promise<void>((resolve, reject) => {
                good.on("open", () => resolve());
                good.on("error", reject);
            });
            good.close();
        } finally {
            await closeStudioContext(s.ctx);
        }
    });
});
