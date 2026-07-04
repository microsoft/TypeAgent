// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    readAgentsJson,
    writeAgentsJson,
    seedRecordsFromConfig,
    getBundledAgentNames,
    loadInstalledRecords,
} from "../src/installSources/installedAgents.js";
import { InstalledAgentRecord } from "../src/installSources/config.js";

function tmpInstanceDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "ta-agents-"));
}

describe("agents.json store", () => {
    it("read returns undefined when the file is absent", () => {
        const dir = tmpInstanceDir();
        expect(readAgentsJson(dir)).toBeUndefined();
    });

    it("write then read roundtrips records", () => {
        const dir = tmpInstanceDir();
        const record: InstalledAgentRecord = {
            name: "myagent",
            kind: "npm",
            path: "/some/where",
            source: "path",
        };
        writeAgentsJson(dir, { agents: { myagent: record } });
        const read = readAgentsJson(dir);
        expect(read).toEqual({ agents: { myagent: record } });
        expect(fs.existsSync(path.join(dir, "agents.json"))).toBe(true);
    });
});

describe("seedRecordsFromConfig", () => {
    it("materializes the default config agents as builtin module records", () => {
        const records = seedRecordsFromConfig();
        // player -> module "music", source "builtin"
        expect(records.player).toBeDefined();
        expect(records.player.module).toBe("music");
        expect(records.player.path).toBeUndefined();
        expect(records.player.source).toBe("builtin");
        expect(records.player.kind).toBe("npm");
        // every seeded record carries exactly one resolution handle
        for (const record of Object.values(records)) {
            const hasModule = record.module !== undefined;
            const hasPath = record.path !== undefined;
            expect(hasModule || hasPath).toBe(true);
            expect(hasModule && hasPath).toBe(false);
            expect(record.source).toBe("builtin");
        }
    });

    it("carries execMode from config entries", () => {
        const records = seedRecordsFromConfig();
        // chat -> execMode "dispatcher" in the default config
        expect(records.chat.loaderConfig?.execMode).toBe("dispatcher");
    });

    it("getBundledAgentNames lists the bundled agent set", () => {
        const names = getBundledAgentNames();
        expect(names.has("player")).toBe(true);
        expect(names.has("chat")).toBe(true);
    });
});

describe("loadInstalledRecords", () => {
    it("returns no installs (and writes an empty agents.json) on first run", () => {
        const dir = tmpInstanceDir();
        const records = loadInstalledRecords(dir);
        // bundled agents are NOT installs - they are a separate provider
        expect(records.player).toBeUndefined();
        expect(Object.keys(records)).toHaveLength(0);
        const onDisk = readAgentsJson(dir);
        expect(onDisk).toBeDefined();
        expect(onDisk!.agents).toEqual({});
    });

    it("returns only the persisted installs (no bundled agents)", () => {
        const dir = tmpInstanceDir();
        const record: InstalledAgentRecord = {
            name: "only",
            kind: "npm",
            module: "only-pkg",
            source: "typeagent",
            ref: "only-pkg@1.0.0",
        };
        writeAgentsJson(dir, { agents: { only: record } });
        const records = loadInstalledRecords(dir);
        expect(records.only).toEqual(record);
        // bundled agents are not merged in here
        expect(records.player).toBeUndefined();
    });

    it("drops a persisted install whose name collides with a bundled agent", () => {
        const dir = tmpInstanceDir();
        writeAgentsJson(dir, {
            agents: {
                // collides with the bundled "player" - the bundled provider owns it
                player: {
                    name: "player",
                    kind: "npm",
                    path: "/old/player",
                    source: "path",
                },
                mine: {
                    name: "mine",
                    kind: "npm",
                    path: "/abs/mine",
                    source: "path",
                },
            },
        });
        const records = loadInstalledRecords(dir);
        expect(records.player).toBeUndefined();
        expect(records.mine).toBeDefined();
        // the collision is stripped from the persisted file too
        expect(readAgentsJson(dir)!.agents.player).toBeUndefined();
    });
});
