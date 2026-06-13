// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { STUDIO_REGISTRY_PROTOCOL_VERSION } from "@typeagent/core/runtime";
import type { StudioServiceEntry } from "@typeagent/core/runtime";
import {
    StudioRegistryServer,
    announceStudioService,
    lookupStudioService,
} from "../src/studioRegistry.js";

function makeEntry(over: Partial<StudioServiceEntry> = {}): StudioServiceEntry {
    return {
        workspaceKey: "ws-aaa",
        repoRoot: "/repo/ts",
        port: 12345,
        token: "a".repeat(64),
        pid: 4242,
        protocolVersion: STUDIO_REGISTRY_PROTOCOL_VERSION,
        startedAt: Date.now(),
        ...over,
    };
}

/** Let queued socket close handlers (eviction) run. */
function tick(ms = 25): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

describe("studio service registry relay", () => {
    let server: StudioRegistryServer;
    let endpoint: string;

    beforeEach(async () => {
        server = await StudioRegistryServer.start(0);
        endpoint = `ws://127.0.0.1:${server.port}`;
    });

    afterEach(async () => {
        await server.close();
    });

    it("lookup returns null for an unknown workspace", async () => {
        expect(await lookupStudioService("nope", { endpoint })).toBeNull();
    });

    it("announce then lookup round-trips the entry", async () => {
        const entry = makeEntry();
        const announcement = await announceStudioService(entry, { endpoint });
        try {
            const found = await lookupStudioService(entry.workspaceKey, {
                endpoint,
            });
            expect(found).not.toBeNull();
            expect(found?.port).toBe(entry.port);
            expect(found?.token).toBe(entry.token);
            expect(found?.repoRoot).toBe(entry.repoRoot);
        } finally {
            announcement.close();
        }
    });

    it("evicts the entry when the announcing socket closes", async () => {
        const entry = makeEntry();
        const announcement = await announceStudioService(entry, { endpoint });
        expect(
            await lookupStudioService(entry.workspaceKey, { endpoint }),
        ).not.toBeNull();
        announcement.close();
        await tick();
        expect(
            await lookupStudioService(entry.workspaceKey, { endpoint }),
        ).toBeNull();
        expect(server.size()).toBe(0);
    });

    it("newest-wins: a re-announce replaces the entry and a stale close doesn't evict it", async () => {
        const first = await announceStudioService(makeEntry({ port: 1111 }), {
            endpoint,
        });
        const second = await announceStudioService(makeEntry({ port: 2222 }), {
            endpoint,
        });
        try {
            // The second announce owns the key now.
            expect(
                (await lookupStudioService("ws-aaa", { endpoint }))?.port,
            ).toBe(2222);
            // Closing the first (stale) announcer must NOT evict the live entry.
            first.close();
            await tick();
            expect(
                (await lookupStudioService("ws-aaa", { endpoint }))?.port,
            ).toBe(2222);
        } finally {
            second.close();
        }
    });

    it("tracks independent workspaces separately", async () => {
        const a = await announceStudioService(
            makeEntry({ workspaceKey: "ws-a", port: 1 }),
            { endpoint },
        );
        const b = await announceStudioService(
            makeEntry({ workspaceKey: "ws-b", port: 2 }),
            { endpoint },
        );
        try {
            expect(
                (await lookupStudioService("ws-a", { endpoint }))?.port,
            ).toBe(1);
            expect(
                (await lookupStudioService("ws-b", { endpoint }))?.port,
            ).toBe(2);
            expect(server.size()).toBe(2);
        } finally {
            a.close();
            b.close();
        }
    });
});
