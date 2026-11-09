// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs, { type PathLike } from "node:fs";
import { test } from "node:test";
import { _electron as electron } from "@playwright/test";
import { startShell } from "../testHelper.js";

test("startup retries after Electron exits without resolving its disposed process handle", async (t) => {
    const originalEnv = { ...process.env };
    t.after(() => {
        process.env = originalEnv;
    });
    process.env.TEST_WORKER_INDEX = "0";
    process.env.TEST_PARALLEL_INDEX = "0";
    const exists = fs.existsSync;
    t.mock.method(
        fs,
        "existsSync",
        (file: PathLike) =>
            file.toString().endsWith("config.local.yaml") || exists(file),
    );

    const proc = spawn(process.execPath, ["-e", ""]);
    await once(proc, "exit");
    const kill = t.mock.method(proc, "kill", () => {
        assert.fail("An exited process must not be killed");
    });
    let processCalls = 0;
    let disposed = false;
    const app = {
        process: () => {
            processCalls++;
            if (disposed)
                throw new Error("Electron process handle has been disposed");
            return proc;
        },
        windows: () => {
            disposed = true;
            throw new Error("Electron exited before its chat window opened");
        },
    };
    let launchCalls = 0;
    const launch = t.mock.method(electron, "launch", async () => {
        if (++launchCalls === 1) return app;
        throw new Error("Controlled subsequent launch failure");
    });

    await assert.rejects(startShell(), /Failed to start electron app/);
    assert.equal(launch.mock.callCount(), 11);
    assert.equal(processCalls, 1);
    assert.equal(kill.mock.callCount(), 0);
});
