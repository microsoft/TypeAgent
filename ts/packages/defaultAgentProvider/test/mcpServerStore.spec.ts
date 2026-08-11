// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    openMcpServerStore,
    readMcpServersJson,
} from "../src/mcp/mcpServerStore.js";
import { NormalizedMcpServerConfig } from "../src/mcp/mcpServerConfig.js";

function tmpInstanceDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "ta-mcp-store-"));
}

function makeConfig(name: string): NormalizedMcpServerConfig {
    return {
        name,
        scope: "user",
        trust: "trusted",
        transport: { kind: "stdio", command: "node", args: ["server.js"] },
    };
}

describe("mcpServers.json store", () => {
    it("lists empty and creates a well-formed file on open", () => {
        const dir = tmpInstanceDir();
        const store = openMcpServerStore(dir);
        expect(store.list()).toEqual([]);
        expect(fs.existsSync(path.join(dir, "mcpServers.json"))).toBe(true);
        expect(readMcpServersJson(dir)).toEqual({ servers: {} });
    });

    it("set/get/has/remove roundtrips and writes through to disk", () => {
        const dir = tmpInstanceDir();
        const store = openMcpServerStore(dir);
        const config = makeConfig("alpha");

        expect(store.has("alpha")).toBe(false);
        expect(store.set(config)).toEqual(config);
        expect(store.has("alpha")).toBe(true);
        expect(store.get("alpha")).toEqual(config);
        expect(store.list()).toEqual([config]);

        // write-through: a fresh reader sees the committed add.
        expect(readMcpServersJson(dir)).toEqual({
            servers: { alpha: config },
        });

        expect(store.remove("alpha")).toBe(true);
        expect(store.has("alpha")).toBe(false);
        expect(store.remove("alpha")).toBe(false);
        expect(readMcpServersJson(dir)).toEqual({ servers: {} });
    });

    it("persists across reopen", () => {
        const dir = tmpInstanceDir();
        const first = openMcpServerStore(dir);
        first.set(makeConfig("beta"));

        const second = openMcpServerStore(dir);
        expect(second.has("beta")).toBe(true);
        expect(second.get("beta")).toEqual(makeConfig("beta"));
    });

    it("drops reserved-name collisions on open", () => {
        const dir = tmpInstanceDir();
        // Seed the file directly with a name that a shipped server owns.
        const store = openMcpServerStore(dir);
        store.set(makeConfig("shipped"));
        store.set(makeConfig("mine"));

        const reopened = openMcpServerStore(dir, new Set(["shipped"]));
        expect(reopened.has("shipped")).toBe(false);
        expect(reopened.has("mine")).toBe(true);
        // The dropped collision is normalized out of the file on open.
        expect(readMcpServersJson(dir)).toEqual({
            servers: { mine: makeConfig("mine") },
        });
    });

    it("refuses to store a reserved name", () => {
        const dir = tmpInstanceDir();
        const store = openMcpServerStore(dir, new Set(["shipped"]));
        expect(() => store.set(makeConfig("shipped"))).toThrow(/reserved/);
    });
});
