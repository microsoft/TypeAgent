// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
    new URL("../ciVerifyNativeRuntime.mjs", import.meta.url),
);

export function probeSqlite(root, expectedRuntime) {
    assert.ok(
        ["node", "electron"].includes(expectedRuntime),
        "Unknown native runtime",
    );
    const runtime = process.versions.electron ? "electron" : "node";
    assert.equal(
        runtime,
        expectedRuntime,
        "Wrong runtime for native SQLite verification",
    );
    const require = createRequire(
        path.join(root, "packages/memory/storage/package.json"),
    );
    const Database = require("better-sqlite3");
    const database = new Database(":memory:");
    try {
        database.exec("CREATE TABLE native_probe (value INTEGER NOT NULL)");
        database.prepare("INSERT INTO native_probe (value) VALUES (?)").run(42);
        assert.deepEqual(
            database.prepare("SELECT value FROM native_probe").get(),
            { value: 42 },
            "Native SQLite read/write verification failed",
        );
        return {
            runtime,
            version: process.versions.electron ?? process.versions.node,
            abi: process.versions.modules,
            platform: process.platform,
            arch: process.arch,
            packageVersion: require("better-sqlite3/package.json").version,
            sqliteVersion: database
                .prepare("SELECT sqlite_version() AS version")
                .get().version,
        };
    } finally {
        database.close();
    }
}

export function verifyNativeRuntimes(
    root,
    { run = spawnSync, electronExecutable } = {},
) {
    const nodeEnvironment = { ...process.env };
    delete nodeEnvironment.ELECTRON_RUN_AS_NODE;
    const node = run(process.execPath, [cli, "probe", "node"], {
        cwd: root,
        env: nodeEnvironment,
        stdio: "inherit",
        timeout: 60000,
    });
    verifyResult("Node", node);
    const require = createRequire(
        path.join(root, "packages/shell/package.json"),
    );
    const electron = run(
        electronExecutable ?? require("electron"),
        [cli, "probe", "electron"],
        {
            cwd: root,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: "1",
                NODE_OPTIONS: "",
            },
            stdio: "inherit",
            timeout: 60000,
        },
    );
    verifyResult("Electron", electron);
}

function verifyResult(runtime, result) {
    if (result.error) {
        throw new Error(
            `${runtime} native verification could not run: ${result.error.message}`,
            {
                cause: result.error,
            },
        );
    }
    assert.equal(
        result.status,
        0,
        `${runtime} native verification failed (signal ${result.signal ?? "none"})`,
    );
}
