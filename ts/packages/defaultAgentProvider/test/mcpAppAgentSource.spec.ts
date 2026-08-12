// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
    AppAgentProvider,
    AppAgentProviderSetController,
    AppAgentProviderSetMutation,
    AppAgentProviderSetRunResult,
} from "agent-dispatcher";
import { createMcpAppAgentSource } from "../src/mcp/mcpAppAgentSource.js";
import { openMcpServerStore } from "../src/mcp/mcpServerStore.js";
import { NormalizedMcpServerConfig } from "../src/mcp/mcpServerConfig.js";

const clientInfo = { name: "test", version: "0.0.0" };

function tmpInstanceDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "ta-mcp-src-"));
}

function makeConfig(name: string): NormalizedMcpServerConfig {
    return {
        name,
        scope: "user",
        trust: "trusted",
        transport: { kind: "stdio", command: "node", args: ["server.js"] },
    };
}

type Op = { op: "add"; names: string[] } | { op: "remove"; names: string[] };

// A fake controller that records every add/remove fanned out to it. Providers
// are single-name, so we record their name for assertion. `closed` sessions
// return the closed status without invoking the callback, matching the real
// controller's contract when a session is mid-teardown.
function fakeController(closed = false): {
    controller: AppAgentProviderSetController;
    ops: Op[];
} {
    const ops: Op[] = [];
    const mutation: AppAgentProviderSetMutation = {
        async addProvider(provider: AppAgentProvider) {
            ops.push({ op: "add", names: provider.getAppAgentNames() });
        },
        async removeProvider(provider: AppAgentProvider) {
            ops.push({ op: "remove", names: provider.getAppAgentNames() });
        },
    };
    const controller: AppAgentProviderSetController = {
        async runExclusive<T>(
            cb: (m: AppAgentProviderSetMutation) => Promise<T> | T,
        ): Promise<AppAgentProviderSetRunResult<T>> {
            if (closed) {
                return { status: "closed" };
            }
            const value = await cb(mutation);
            return { status: "completed", value };
        },
    };
    return { controller, ops };
}

describe("createMcpAppAgentSource", () => {
    it("seeds shipped servers and the user store on connect", () => {
        const dir = tmpInstanceDir();
        const store = openMcpServerStore(dir);
        store.set(makeConfig("mine"));
        const source = createMcpAppAgentSource(
            store,
            { shipped: makeConfig("shipped") },
            clientInfo,
        );

        expect(source.testApi.listServers().sort()).toEqual([
            "mine",
            "shipped",
        ]);

        const { controller } = fakeController();
        const conn = source.connect(controller);
        return conn.providers.then((providers) => {
            const names = providers.flatMap((p) => p.getAppAgentNames()).sort();
            expect(names).toEqual(["mine", "shipped"]);
            conn.dispose();
        });
    });

    it("fans an addServer out to connected sessions and persists it", async () => {
        const dir = tmpInstanceDir();
        const store = openMcpServerStore(dir);
        const source = createMcpAppAgentSource(store, {}, clientInfo);

        const a = fakeController();
        const b = fakeController();
        source.connect(a.controller);
        source.connect(b.controller);

        await source.testApi.addServer(makeConfig("new"), a.controller);

        expect(a.ops).toEqual([{ op: "add", names: ["new"] }]);
        expect(b.ops).toEqual([{ op: "add", names: ["new"] }]);
        expect(store.has("new")).toBe(true);
        expect(source.testApi.listServers()).toContain("new");
    });

    it("replaces in place with remove-then-add on re-add", async () => {
        const dir = tmpInstanceDir();
        const store = openMcpServerStore(dir);
        const source = createMcpAppAgentSource(store, {}, clientInfo);

        const a = fakeController();
        source.connect(a.controller);

        await source.testApi.addServer(makeConfig("dup"), a.controller);
        await source.testApi.addServer(makeConfig("dup"), a.controller);

        expect(a.ops).toEqual([
            { op: "add", names: ["dup"] },
            { op: "remove", names: ["dup"] },
            { op: "add", names: ["dup"] },
        ]);
    });

    it("fans a removeServer out and drops it from the store", async () => {
        const dir = tmpInstanceDir();
        const store = openMcpServerStore(dir);
        store.set(makeConfig("gone"));
        const source = createMcpAppAgentSource(store, {}, clientInfo);

        const a = fakeController();
        source.connect(a.controller);

        const removed = await source.testApi.removeServer("gone", a.controller);
        expect(removed).toBe(true);
        expect(a.ops).toEqual([{ op: "remove", names: ["gone"] }]);
        expect(store.has("gone")).toBe(false);
    });

    it("removeServer returns false for an unknown server", async () => {
        const dir = tmpInstanceDir();
        const store = openMcpServerStore(dir);
        const source = createMcpAppAgentSource(store, {}, clientInfo);
        expect(await source.testApi.removeServer("nope")).toBe(false);
    });

    it("refuses to add or remove a shipped (seed) name", async () => {
        const dir = tmpInstanceDir();
        const store = openMcpServerStore(dir);
        const source = createMcpAppAgentSource(
            store,
            { shipped: makeConfig("shipped") },
            clientInfo,
        );
        await expect(
            source.testApi.addServer(makeConfig("shipped")),
        ).rejects.toThrow(/reserved/);
        await expect(source.testApi.removeServer("shipped")).rejects.toThrow(
            /shipped/,
        );
    });

    it("does not fan out to a disposed session", async () => {
        const dir = tmpInstanceDir();
        const store = openMcpServerStore(dir);
        const source = createMcpAppAgentSource(store, {}, clientInfo);

        const a = fakeController();
        const conn = source.connect(a.controller);
        conn.dispose();

        await source.testApi.addServer(makeConfig("late"));
        expect(a.ops).toEqual([]);
    });

    it("tolerates a closed session during fan-out", async () => {
        const dir = tmpInstanceDir();
        const store = openMcpServerStore(dir);
        const source = createMcpAppAgentSource(store, {}, clientInfo);

        const open = fakeController();
        const closed = fakeController(true);
        source.connect(open.controller);
        source.connect(closed.controller);

        await source.testApi.addServer(makeConfig("x"), open.controller);
        expect(open.ops).toEqual([{ op: "add", names: ["x"] }]);
        expect(closed.ops).toEqual([]);
        expect(store.has("x")).toBe(true);
    });
});
