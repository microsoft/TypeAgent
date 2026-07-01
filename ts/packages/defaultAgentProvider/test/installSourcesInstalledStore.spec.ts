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
    migrateLegacyExternalAgents,
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

describe("migrateLegacyExternalAgents", () => {
    it("migrates only path entries and drops module-only (feed) entries", () => {
        const dir = tmpInstanceDir();
        const legacy = path.join(dir, "externalAgentsConfig.json");
        fs.writeFileSync(
            legacy,
            JSON.stringify({
                agents: {
                    localagent: { name: "local-pkg", path: "/abs/local" },
                    feedagent: { name: "@scope/feed-pkg" },
                },
            }),
        );
        const records: Record<string, InstalledAgentRecord> = {};
        migrateLegacyExternalAgents(dir, records);

        expect(records.localagent).toBeDefined();
        expect(records.localagent.path).toBe("/abs/local");
        expect(records.localagent.source).toBe("path");
        expect(records.localagent.module).toBeUndefined();
        // feed/module-only entry is dropped, not guessed into a feed source
        expect(records.feedagent).toBeUndefined();

        // the old file is renamed (not deleted) so migration is one-time
        expect(fs.existsSync(legacy)).toBe(false);
        expect(fs.existsSync(`${legacy}.migrated`)).toBe(true);
    });

    it("is a no-op when there is no legacy file", () => {
        const dir = tmpInstanceDir();
        const records: Record<string, InstalledAgentRecord> = {};
        expect(() => migrateLegacyExternalAgents(dir, records)).not.toThrow();
        expect(Object.keys(records)).toHaveLength(0);
    });

    it("never lets a legacy path entry shadow an existing bundled record", () => {
        const dir = tmpInstanceDir();
        fs.writeFileSync(
            path.join(dir, "externalAgentsConfig.json"),
            JSON.stringify({
                agents: { player: { name: "old", path: "/old/player" } },
            }),
        );
        const builtin: InstalledAgentRecord = {
            name: "player",
            kind: "npm",
            module: "music",
            source: "bundled",
        };
        const records: Record<string, InstalledAgentRecord> = {
            player: builtin,
        };
        migrateLegacyExternalAgents(dir, records);
        // existing bundled record preserved, not overwritten by the legacy path entry
        expect(records.player).toEqual(builtin);
    });

    it("resolves a relative legacy path against the instance dir", () => {
        const dir = tmpInstanceDir();
        fs.writeFileSync(
            path.join(dir, "externalAgentsConfig.json"),
            JSON.stringify({
                agents: {
                    rel: { name: "rel-pkg", path: "externalagents/rel" },
                },
            }),
        );
        const records: Record<string, InstalledAgentRecord> = {};
        migrateLegacyExternalAgents(dir, records);
        expect(records.rel.path).toBe(path.resolve(dir, "externalagents/rel"));
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

    it("first run merges migrated legacy path entries", () => {
        const dir = tmpInstanceDir();
        fs.writeFileSync(
            path.join(dir, "externalAgentsConfig.json"),
            JSON.stringify({
                agents: { mine: { name: "mine-pkg", path: "/abs/mine" } },
            }),
        );
        const records = loadInstalledRecords(dir);
        // migrated path agent present (bundled agents are not installs)
        expect(records.player).toBeUndefined();
        expect(records.mine).toBeDefined();
        expect(records.mine.source).toBe("path");
        expect(records.mine.path).toBe("/abs/mine");
        // persisted
        const onDisk = readAgentsJson(dir);
        expect(onDisk!.agents.mine.path).toBe("/abs/mine");
        // legacy file renamed
        expect(fs.existsSync(path.join(dir, "externalAgentsConfig.json"))).toBe(
            false,
        );
    });
});
