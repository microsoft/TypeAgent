// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocket } from "ws";
import type { SessionContext } from "@typeagent/agent-sdk";
import {
    initializeStudioContext,
    updateStudioContext,
    closeStudioContext,
    getSharedStudioPort,
    type StudioActionContext,
} from "../src/lib/studioServiceLifecycle.js";

/** Build a fake SessionContext exposing only what the lifecycle touches. */
async function makeCtx(): Promise<{
    ctx: SessionContext<StudioActionContext>;
    released: () => number;
}> {
    const agentContext = await initializeStudioContext();
    let releaseCount = 0;
    const ctx = {
        agentContext,
        registerPort: (_role: string, _port: number) => ({
            release: () => {
                releaseCount++;
            },
        }),
    } as unknown as SessionContext<StudioActionContext>;
    return { ctx, released: () => releaseCount };
}

describe("studio service lifecycle", () => {
    it("starts the shared server on first enable and stops it when the last session closes", async () => {
        expect(getSharedStudioPort()).toBeUndefined();

        // Session 1 enables → server starts, port registered.
        const s1 = await makeCtx();
        await updateStudioContext(true, s1.ctx, "studioActions");
        const port = getSharedStudioPort();
        expect(typeof port).toBe("number");

        // The bound port is actually accepting connections.
        const socket = new WebSocket(`ws://127.0.0.1:${port}`);
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
});
