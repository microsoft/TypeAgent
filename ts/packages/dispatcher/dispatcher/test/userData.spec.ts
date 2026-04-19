// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    getUserDataDir,
    getInstanceDirAsync,
    getTraceIdAsync,
    _resetCacheForTest,
} from "../src/helpers/userData.js";

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-test-"));
}

function readGlobalJson(dataDir: string) {
    const p = path.join(dataDir, "global.json");
    return JSON.parse(fs.readFileSync(p, "utf-8"));
}

// Simulate a server that successfully started: register its instance dir and
// actually create the profile folder (normally done by lockInstanceDir →
// ensureDirectory in fsUtils.ts).
async function simulateStartedServer(
    dataDir: string,
    instanceName: string,
): Promise<string> {
    process.env.TYPEAGENT_USER_DATA_DIR = dataDir;
    process.env.INSTANCE_NAME = instanceName;
    _resetCacheForTest();
    const dir = await getInstanceDirAsync();
    fs.mkdirSync(dir, { recursive: true }); // profile dir created on startup
    return dir;
}

// Simulate an orphaned lock file left behind by a crashed server process.
// proper-lockfile creates a <path>.lock directory containing a JSON file.
function simulateOrphanedLock(instanceDir: string) {
    const lockDir = instanceDir + ".lock";
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
        path.join(lockDir, "pid"),
        JSON.stringify({ pid: 99999999, hostname: os.hostname() }),
    );
}

beforeEach(() => {
    _resetCacheForTest();
});

afterEach(() => {
    delete process.env.TYPEAGENT_USER_DATA_DIR;
    delete process.env.INSTANCE_NAME;
    _resetCacheForTest();
});

// ──────────────────────────────────────────────
// getUserDataDir
// ──────────────────────────────────────────────

describe("getUserDataDir", () => {
    it("respects TYPEAGENT_USER_DATA_DIR override", () => {
        process.env.TYPEAGENT_USER_DATA_DIR = "/tmp/custom-dir";
        expect(getUserDataDir()).toBe("/tmp/custom-dir");
    });

    it("falls back to ~/.typeagent when env var is not set", () => {
        delete process.env.TYPEAGENT_USER_DATA_DIR;
        expect(getUserDataDir()).toBe(path.join(os.homedir(), ".typeagent"));
    });
});

// ──────────────────────────────────────────────
// getInstanceDirAsync — basic correctness
// ──────────────────────────────────────────────

describe("getInstanceDirAsync — basic", () => {
    it("creates a profile entry in global.json", async () => {
        const tmp = makeTempDir();
        process.env.TYPEAGENT_USER_DATA_DIR = tmp;
        process.env.INSTANCE_NAME = "basic-test";

        const dir = await getInstanceDirAsync();

        expect(dir).toContain("profiles");
        const config = readGlobalJson(tmp);
        expect(config.instances?.["basic-test"]).toBeDefined();
    });

    it("returns the same dir on repeated calls (cache hit)", async () => {
        const tmp = makeTempDir();
        process.env.TYPEAGENT_USER_DATA_DIR = tmp;
        process.env.INSTANCE_NAME = "repeat-test";

        const dir1 = await getInstanceDirAsync();
        _resetCacheForTest();
        const dir2 = await getInstanceDirAsync();

        expect(dir1).toBe(dir2);
    });

    it("assigns distinct dirs for distinct instance names", async () => {
        const tmp = makeTempDir();
        const dirs: string[] = [];

        for (const name of ["inst-a", "inst-b", "inst-c"]) {
            process.env.TYPEAGENT_USER_DATA_DIR = tmp;
            process.env.INSTANCE_NAME = name;
            _resetCacheForTest();
            dirs.push(await getInstanceDirAsync());
        }

        expect(new Set(dirs).size).toBe(3);
    });

    it("concurrent calls for the same instance resolve to the same dir", async () => {
        const tmp = makeTempDir();
        process.env.TYPEAGENT_USER_DATA_DIR = tmp;
        process.env.INSTANCE_NAME = "concurrent-same";

        const dirs = await Promise.all(
            Array.from({ length: 5 }, () => getInstanceDirAsync()),
        );

        expect(new Set(dirs).size).toBe(1);
    });
});

// ──────────────────────────────────────────────
// Load scenario — many instances registering sequentially
// (multi-process concurrency is tested by the server spin-up script)
// ──────────────────────────────────────────────

describe("getInstanceDirAsync — load", () => {
    it("registers N instances without corrupting global.json", async () => {
        const tmp = makeTempDir();
        const N = 20;
        const results: string[] = [];

        for (let i = 0; i < N; i++) {
            // simulateStartedServer creates the profile dir, so pruning doesn't
            // remove previous instances when the next one acquires the lock.
            results.push(await simulateStartedServer(tmp, `load-inst-${i}`));
        }

        // All dirs are unique
        expect(new Set(results).size).toBe(N);

        // global.json is valid JSON and has all N entries
        const config = readGlobalJson(tmp);
        for (let i = 0; i < N; i++) {
            expect(config.instances?.[`load-inst-${i}`]).toBeDefined();
        }
    });

    it("global.json stays valid when lock is acquired after many prior entries", async () => {
        const tmp = makeTempDir();

        // Pre-populate global.json with 50 existing entries
        fs.mkdirSync(tmp, { recursive: true });
        const instances: Record<string, string> = {};
        for (let i = 0; i < 50; i++) {
            instances[`pre-inst-${i}`] = `pre-inst-${i}`;
            fs.mkdirSync(path.join(tmp, "profiles", `pre-inst-${i}`), {
                recursive: true,
            });
        }
        fs.writeFileSync(
            path.join(tmp, "global.json"),
            JSON.stringify({
                traceId: "00000000-0000-0000-0000-000000000001",
                instances,
            }),
        );

        // Register a new instance — triggers lock acquisition + pruning
        process.env.TYPEAGENT_USER_DATA_DIR = tmp;
        process.env.INSTANCE_NAME = "new-after-50";
        const dir = await getInstanceDirAsync();

        expect(dir).toContain("profiles");
        const config = readGlobalJson(tmp);
        // All 50 pre-existing entries kept (their dirs exist)
        expect(Object.keys(config.instances).length).toBe(51);
        expect(config.instances["new-after-50"]).toBeDefined();
    });
});

// ──────────────────────────────────────────────
// getTraceIdAsync
// ──────────────────────────────────────────────

describe("getTraceIdAsync", () => {
    it("creates and persists a traceId", async () => {
        const tmp = makeTempDir();
        process.env.TYPEAGENT_USER_DATA_DIR = tmp;

        const id1 = await getTraceIdAsync();
        expect(id1).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );

        _resetCacheForTest();
        const id2 = await getTraceIdAsync();
        expect(id2).toBe(id1);
    });

    it("concurrent calls return the same traceId", async () => {
        const tmp = makeTempDir();
        process.env.TYPEAGENT_USER_DATA_DIR = tmp;

        const ids = await Promise.all(
            Array.from({ length: 5 }, () => getTraceIdAsync()),
        );

        expect(new Set(ids).size).toBe(1);
    });
});

// ──────────────────────────────────────────────
// Stale instance pruning
// ──────────────────────────────────────────────

describe("stale instance pruning", () => {
    it("keeps entries for instances whose profile dirs exist", async () => {
        const tmp = makeTempDir();
        await simulateStartedServer(tmp, "keep-alive");

        // Trigger a lock acquisition for a new instance
        process.env.TYPEAGENT_USER_DATA_DIR = tmp;
        process.env.INSTANCE_NAME = "trigger-prune";
        _resetCacheForTest();
        await getInstanceDirAsync();

        const config = readGlobalJson(tmp);
        expect(config.instances?.["keep-alive"]).toBeDefined();
        expect(config.instances?.["trigger-prune"]).toBeDefined();
    });

    it("removes entries for instances whose profile dirs were deleted", async () => {
        const tmp = makeTempDir();
        await simulateStartedServer(tmp, "keep-me");
        const deadDir = await simulateStartedServer(tmp, "delete-me");

        // Simulate the dead server's dir being cleaned up
        fs.rmSync(deadDir, { recursive: true, force: true });

        // Trigger pruning via a new lock acquisition
        process.env.TYPEAGENT_USER_DATA_DIR = tmp;
        process.env.INSTANCE_NAME = "trigger-prune";
        _resetCacheForTest();
        await getInstanceDirAsync();

        const config = readGlobalJson(tmp);
        expect(config.instances?.["keep-me"]).toBeDefined();
        expect(config.instances?.["delete-me"]).toBeUndefined();
        expect(config.instances?.["trigger-prune"]).toBeDefined();
    });

    it("prunes ghost entries (registered but dir never created)", async () => {
        const tmp = makeTempDir();
        fs.mkdirSync(tmp, { recursive: true });

        // Directly write a ghost entry — dir was never created on disk
        fs.writeFileSync(
            path.join(tmp, "global.json"),
            JSON.stringify({
                traceId: "00000000-0000-0000-0000-000000000000",
                instances: {
                    ghost: "ghost-dir",
                },
            }),
        );

        process.env.TYPEAGENT_USER_DATA_DIR = tmp;
        process.env.INSTANCE_NAME = "new-inst";
        await getInstanceDirAsync();

        const config = readGlobalJson(tmp);
        expect(config.instances?.["ghost"]).toBeUndefined();
        expect(config.instances?.["new-inst"]).toBeDefined();
    });

    it("does NOT prune entries with orphaned lock files — dir still exists", async () => {
        const tmp = makeTempDir();
        const dir = await simulateStartedServer(tmp, "crashed-server");
        simulateOrphanedLock(dir);

        // Trigger pruning
        process.env.TYPEAGENT_USER_DATA_DIR = tmp;
        process.env.INSTANCE_NAME = "trigger-prune";
        _resetCacheForTest();
        await getInstanceDirAsync();

        // The crashed server's entry should still be in global.json because
        // its profile dir is still on disk — pruning is dir-existence based,
        // not lock-state based, to avoid a race between dir creation and
        // lockInstanceDir acquisition.
        const config = readGlobalJson(tmp);
        expect(config.instances?.["crashed-server"]).toBeDefined();
    });

    it("prunes multiple stale entries in a single lock acquisition", async () => {
        const tmp = makeTempDir();
        await simulateStartedServer(tmp, "live-1");
        await simulateStartedServer(tmp, "live-2");
        const dead1 = await simulateStartedServer(tmp, "dead-1");
        const dead2 = await simulateStartedServer(tmp, "dead-2");
        const dead3 = await simulateStartedServer(tmp, "dead-3");

        fs.rmSync(dead1, { recursive: true, force: true });
        fs.rmSync(dead2, { recursive: true, force: true });
        fs.rmSync(dead3, { recursive: true, force: true });

        process.env.TYPEAGENT_USER_DATA_DIR = tmp;
        process.env.INSTANCE_NAME = "new-inst";
        _resetCacheForTest();
        await getInstanceDirAsync();

        const config = readGlobalJson(tmp);
        expect(config.instances?.["live-1"]).toBeDefined();
        expect(config.instances?.["live-2"]).toBeDefined();
        expect(config.instances?.["dead-1"]).toBeUndefined();
        expect(config.instances?.["dead-2"]).toBeUndefined();
        expect(config.instances?.["dead-3"]).toBeUndefined();
        expect(config.instances?.["new-inst"]).toBeDefined();
    });
});
