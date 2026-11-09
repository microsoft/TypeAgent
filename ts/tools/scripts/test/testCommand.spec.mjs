// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
    runBoundedTestCommand,
    workspaceTestTimeout,
} from "../lib/testCommand.mjs";
import { runLocalTestPhases } from "../lib/testRetry.mjs";

test("workspace deadlines are opt-in and invalid configuration fails explicitly", () => {
    assert.equal(workspaceTestTimeout(undefined), undefined);
    assert.equal(workspaceTestTimeout(""), undefined);
    assert.equal(workspaceTestTimeout("10800000"), 180 * 60 * 1000);
    for (const value of [
        "0",
        "-1",
        "1.5",
        "NaN",
        "Infinity",
        " 1",
        "2147483648",
    ]) {
        assert.throws(() => workspaceTestTimeout(value), /WORKSPACE_TIMEOUT/);
    }
});

for (const status of [0, 7]) {
    test(`bounded commands preserve exit ${status}`, async () => {
        const result = await runBoundedTestCommand(
            process.execPath,
            ["-e", `process.exitCode = ${status}`],
            { timeoutMs: 10000, stdio: "ignore" },
        );
        assert.equal(result.status, status);
        assert.equal(result.signal, null);
        assert.equal(result.error, undefined);
    });
}

test("spawn errors remain explicit infrastructure failures", async () => {
    const result = await runBoundedTestCommand(
        path.join(os.tmpdir(), `missing-test-command-${process.pid}`),
        [],
        { timeoutMs: 1000, stdio: "ignore" },
    );
    assert.equal(result.error.code, "ENOENT");
    assert.equal(result.status, null);
});

for (const stage of ["first pass", "retry"]) {
    test(
        `the real harness keeps ${stage} timeouts blocking and still runs root tests`,
        { timeout: 25000 },
        (t) => {
            const directory = fs.mkdtempSync(
                path.join(os.tmpdir(), "test-harness-deadline-"),
            );
            t.after(() =>
                fs.rmSync(directory, { recursive: true, force: true }),
            );
            const packageDirectory = path.join(
                directory,
                "packages",
                "fixture",
            );
            fs.mkdirSync(packageDirectory, { recursive: true });
            fs.writeFileSync(
                path.join(packageDirectory, "package.json"),
                JSON.stringify({
                    name: "deadline-fixture",
                    scripts: {
                        "test:local": "pnpm run jest-esm",
                        "jest-esm":
                            "node --no-warnings --experimental-vm-modules ./node_modules/jest/bin/jest.js",
                    },
                }),
            );
            fs.writeFileSync(
                path.join(packageDirectory, "original.spec.js"),
                "",
            );
            const rootMarker = path.join(directory, "root-ran");
            const retryMarker = path.join(directory, "retry-ran");
            const fake = path.join(directory, "fake-pnpm.cjs");
            fs.writeFileSync(
                fake,
                `
            const fs = require('node:fs');
            const path = require('node:path');
            const args = process.argv.slice(2);
            if (args.includes('test:local:scripts')) {
                fs.writeFileSync(${JSON.stringify(rootMarker)}, '');
            } else if (args.includes('test:local:packages')) {
                fs.writeFileSync(path.join(process.env.TYPEAGENT_TEST_FAILURES_DIR, 'failure.json'),
                    JSON.stringify([{
                        testFilePath: ${JSON.stringify(path.join(packageDirectory, "original.spec.js"))},
                        fullName: 'original assertion remains failed',
                        failureMessages: ['original failure evidence'],
                    }]));
                ${stage === "retry" ? "process.exitCode = 1;" : "setInterval(() => {}, 1000);"}
            } else {
                fs.writeFileSync(${JSON.stringify(retryMarker)}, '');
                setInterval(() => {}, 1000);
            }
        `,
            );
            const windows = process.platform === "win32";
            const shim = path.join(directory, windows ? "pnpm.cmd" : "pnpm");
            fs.writeFileSync(
                shim,
                windows
                    ? `@"${process.execPath}" "${fake}" %*\r\n`
                    : `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`,
                { mode: 0o755 },
            );
            const env = {
                ...process.env,
                TYPEAGENT_TEST_WORKSPACE_TIMEOUT_MS: "3000",
                TYPEAGENT_TEST_PHASE: "all",
            };
            const pathKey = Object.keys(env).find(
                (key) => key.toLowerCase() === "path",
            );
            env[pathKey] = `${directory}${path.delimiter}${env[pathKey]}`;
            const result = spawnSync(
                process.execPath,
                [
                    path.resolve(
                        import.meta.dirname,
                        "../runTestLocalWithSummary.mjs",
                    ),
                ],
                { cwd: directory, env, encoding: "utf8", timeout: 20000 },
            );
            assert.ifError(result.error);
            assert.equal(result.status, 1, result.stdout + result.stderr);
            assert.match(result.stderr, /deadline exceeded/);
            assert.match(result.stderr, /original assertion remains failed/);
            assert.match(result.stderr, /BUILD-BLOCKING TEST FAILURES/);
            assert.equal(fs.existsSync(rootMarker), true);
            assert.equal(fs.existsSync(retryMarker), stage === "retry");
        },
    );
}

test(
    "a leaked test process and its child are terminated without clearing recorded failures",
    { timeout: 15000 },
    async (t) => {
        const directory = fs.mkdtempSync(
            path.join(os.tmpdir(), "test-deadline-"),
        );
        const report = path.join(directory, "failure.json");
        const pids = path.join(directory, "pids.json");
        t.after(() => {
            if (fs.existsSync(pids)) {
                for (const pid of JSON.parse(fs.readFileSync(pids, "utf8"))) {
                    try {
                        process.kill(pid, "SIGKILL");
                    } catch (error) {
                        if (error.code !== "ESRCH") throw error;
                    }
                }
            }
            fs.rmSync(directory, { force: true, recursive: true });
        });
        const source = `
        const fs = require('node:fs');
        const { spawn } = require('node:child_process');
        process.on('SIGTERM', () => {});
        const child = spawn(process.execPath, ['-e',
            "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"
        ], { stdio: 'ignore' });
        fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({ failed: 1 }));
        fs.writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.pid, child.pid]));
        setInterval(() => {}, 1000);
    `;
        let rootRan = false;
        const status = await runLocalTestPhases(
            async () => {
                const result = await runBoundedTestCommand(
                    process.execPath,
                    ["-e", source],
                    { timeoutMs: 3000, graceMs: 100, stdio: "ignore" },
                );
                assert.match(result.error.message, /deadline exceeded/);
                assert.equal(result.status, null);
                return 1;
            },
            () => {
                rootRan = true;
                return 0;
            },
        );
        assert.equal(status, 1);
        assert.equal(rootRan, true);
        assert.deepEqual(JSON.parse(fs.readFileSync(report, "utf8")), {
            failed: 1,
        });
        for (const pid of JSON.parse(fs.readFileSync(pids, "utf8"))) {
            const deadline = Date.now() + 2000;
            let alive = true;
            while (alive && Date.now() < deadline) {
                try {
                    process.kill(pid, 0);
                    await new Promise((resolve) => setTimeout(resolve, 20));
                } catch (error) {
                    if (error.code !== "ESRCH") throw error;
                    alive = false;
                }
            }
            assert.equal(alive, false, `Owned process ${pid} survived cleanup`);
        }
    },
);
