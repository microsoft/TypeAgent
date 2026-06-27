// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    readAgentsJson,
    writeAgentsJson,
    seedRecordsFromBundledCatalog,
    seedRecordsFromConfig,
    migrateLegacyExternalAgents,
    loadInstalledRecords,
} from "../src/installSources/installedAgents.js";
import { InstalledAgentRecord } from "agent-dispatcher";

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

describe("seedRecordsFromBundledCatalog", () => {
    it("materializes the bundled preinstall entries as builtin module records", () => {
        const records = seedRecordsFromBundledCatalog();
        // player -> module "music", source "builtin" (design §4.2 example)
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

    it("carries execMode from catalog entries", () => {
        const records = seedRecordsFromBundledCatalog();
        // chat -> execMode "dispatcher" in the bundled catalog
        expect(records.chat.execMode).toBe("dispatcher");
    });
});

describe("seedRecordsFromConfig", () => {
    it("seeds a named config's agent set", () => {
        const records = seedRecordsFromConfig("test");
        // config.test.json contains calendar/list/chat/greeting
        expect(records.calendar).toBeDefined();
        expect(records.calendar.module).toBe("calendar");
        expect(records.calendar.source).toBe("builtin");
        expect(records.chat.execMode).toBe("dispatcher");
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

    it("never lets a legacy path entry shadow an existing (builtin) record", () => {
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
            source: "builtin",
        };
        const records: Record<string, InstalledAgentRecord> = {
            player: builtin,
        };
        migrateLegacyExternalAgents(dir, records);
        // builtin preserved, not overwritten by the legacy path entry
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
    it("in-memory (no instance dir, default config) seeds the bundled builtins", () => {
        const records = loadInstalledRecords(undefined, undefined);
        expect(records.player).toBeDefined();
        expect(records.player.module).toBe("music");
    });

    it("first run writes agents.json from the bundled seed", () => {
        const dir = tmpInstanceDir();
        const records = loadInstalledRecords(dir, undefined);
        expect(records.player).toBeDefined();
        const onDisk = readAgentsJson(dir);
        expect(onDisk).toBeDefined();
        expect(onDisk!.agents.player.module).toBe("music");
    });

    it("steady state reads an existing agents.json verbatim", () => {
        const dir = tmpInstanceDir();
        const record: InstalledAgentRecord = {
            name: "only",
            kind: "npm",
            module: "only-pkg",
            source: "typeagent",
            ref: "only-pkg@1.0.0",
        };
        writeAgentsJson(dir, { agents: { only: record } });
        const records = loadInstalledRecords(dir, undefined);
        expect(Object.keys(records)).toEqual(["only"]);
        expect(records.only).toEqual(record);
    });

    it("first run merges migrated legacy path entries with the seed", () => {
        const dir = tmpInstanceDir();
        fs.writeFileSync(
            path.join(dir, "externalAgentsConfig.json"),
            JSON.stringify({
                agents: { mine: { name: "mine-pkg", path: "/abs/mine" } },
            }),
        );
        const records = loadInstalledRecords(dir, undefined);
        // bundled builtins present
        expect(records.player).toBeDefined();
        // migrated path agent present
        expect(records.mine).toBeDefined();
        expect(records.mine.source).toBe("path");
        expect(records.mine.path).toBe("/abs/mine");
        // persisted together
        const onDisk = readAgentsJson(dir);
        expect(onDisk!.agents.mine.path).toBe("/abs/mine");
        // legacy file renamed
        expect(fs.existsSync(path.join(dir, "externalAgentsConfig.json"))).toBe(
            false,
        );
    });
});
