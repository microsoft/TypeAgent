// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    STUDIO_REGISTRY_PROTOCOL_VERSION,
    studioWorkspaceKey,
} from "@typeagent/core/runtime";
import type { StudioServiceEntry } from "@typeagent/core/runtime";
import {
    StudioRegistryServer,
    announceStudioService,
    lookupStudioService,
} from "../src/studioRegistry.js";

// The registry validates that workspaceKey derives from repoRoot, so build
// valid entries: pick the repoRoot and derive the key.
function makeEntry(over: Partial<StudioServiceEntry> = {}): StudioServiceEntry {
    const repoRoot = over.repoRoot ?? "/repo/ts";
    return {
        workspaceKey: studioWorkspaceKey(repoRoot),
        repoRoot,
        port: 12345,
        token: "a".repeat(64),
        pid: 4242,
        protocolVersion: STUDIO_REGISTRY_PROTOCOL_VERSION,
        startedAt: Date.now(),
        ...over,
        // Ensure the key matches the (possibly overridden) repoRoot.
        ...(over.workspaceKey === undefined
            ? { workspaceKey: studioWorkspaceKey(over.repoRoot ?? repoRoot) }
            : {}),
    };
}

const KEY_TS = studioWorkspaceKey("/repo/ts");

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
                (await lookupStudioService(KEY_TS, { endpoint }))?.port,
            ).toBe(2222);
            // Closing the first (stale) announcer must NOT evict the live entry.
            first.close();
            await tick();
            expect(
                (await lookupStudioService(KEY_TS, { endpoint }))?.port,
            ).toBe(2222);
        } finally {
            second.close();
        }
    });

    it("tracks independent workspaces separately", async () => {
        const a = await announceStudioService(
            makeEntry({ repoRoot: "/repo/a", port: 1 }),
            { endpoint },
        );
        const b = await announceStudioService(
            makeEntry({ repoRoot: "/repo/b", port: 2 }),
            { endpoint },
        );
        try {
            const keyA = studioWorkspaceKey("/repo/a");
            const keyB = studioWorkspaceKey("/repo/b");
            expect((await lookupStudioService(keyA, { endpoint }))?.port).toBe(
                1,
            );
            expect((await lookupStudioService(keyB, { endpoint }))?.port).toBe(
                2,
            );
            expect(server.size()).toBe(2);
        } finally {
            a.close();
            b.close();
        }
    });

    it("rejects an announcement whose key doesn't match its repoRoot", async () => {
        const spoof = makeEntry({ workspaceKey: "not-the-real-key" });
        // The announcer terminates + retries on the rejected invoke, so just
        // confirm the registry never stored it.
        const announcement = await announceStudioService(spoof, {
            endpoint,
            firstAttemptTimeoutMs: 300,
        });
        try {
            await tick(100);
            expect(server.size()).toBe(0);
            expect(
                await lookupStudioService(spoof.workspaceKey, { endpoint }),
            ).toBeNull();
        } finally {
            announcement.close();
        }
    });
});
