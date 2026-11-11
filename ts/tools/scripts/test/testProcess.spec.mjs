// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import {
    formatTestCommandFailure,
    runTestCommand,
} from "../lib/testProcess.mjs";

test("fixture commands preserve output and explicitly expected failure exits", () => {
    const result = runTestCommand(
        process.execPath,
        [
            "-e",
            'console.log("out"); console.error("err"); process.exitCode = 7;',
        ],
        { expectedStatus: 7 },
    );
    assert.equal(result.stdout, "out\n");
    assert.equal(result.stderr, "err\n");
    assert.throws(
        () => runTestCommand(process.execPath, ["-e", "process.exitCode = 7;"]),
        /status: 7; expected: 0/,
    );
});

test("empty Windows Git failures retain command, stage, status, and process context", () => {
    const details = formatTestCommandFailure(
        "git",
        ["-C", "fixture with spaces", "add", "-A"],
        { status: 4294967295, signal: null, pid: 123, stdout: "", stderr: "" },
        {
            stage: "generated-file fixture: git",
            cwd: "fixture-root",
            elapsedMs: 42,
            env: {},
        },
    );
    for (const fragment of [
        "generated-file fixture: git failed",
        '["git","-C","fixture with spaces","add","-A"]',
        "cwd: fixture-root",
        "pid: 123",
        "elapsed: 42ms",
        "status: 4294967295; expected: 0",
        "signal: none",
        "spawn error: none",
        "stdout:\n<empty>",
        "stderr:\n<empty>",
    ]) {
        assert.ok(details.includes(fragment), details);
    }
});

test("spawn errors and timeouts retain actionable failure diagnostics", () => {
    assert.throws(
        () =>
            runTestCommand(
                path.join(
                    os.tmpdir(),
                    `missing-fixture-command-${process.pid}`,
                ),
                [],
                { stage: "fixture setup" },
            ),
        /fixture setup failed[\s\S]*spawn error: ENOENT/,
    );
    assert.throws(
        () =>
            runTestCommand(
                process.execPath,
                ["-e", "setInterval(() => {}, 1000)"],
                {
                    stage: "fixture timeout",
                    timeout: 200,
                },
            ),
        /fixture timeout failed[\s\S]*spawn error: ETIMEDOUT/,
    );
});

test("signal termination cannot pass as a successful fixture command", () => {
    assert.throws(
        () =>
            runTestCommand(
                process.execPath,
                ["-e", "process.kill(process.pid)"],
                {
                    stage: "fixture termination",
                },
            ),
        /fixture termination failed[\s\S]*signal:/,
    );
});

test("diagnostics redact credentials before clipping bounded output", () => {
    const secret = "sentinel-live-value";
    const details = formatTestCommandFailure(
        "git",
        ["https://user:password@example.com/repo", `--token=${secret}`],
        {
            status: 1,
            signal: null,
            error: Object.assign(new Error(`failure ${secret}`), {
                code: "EFAIL",
            }),
            stdout: `GITHUB_TOKEN=${secret}\n${"x".repeat(9000)}\ntail evidence`,
            stderr: "Authorization: Bearer sentinel-header\n_authToken=sentinel-config",
        },
        { env: { GITHUB_TOKEN: secret } },
    );
    assert.doesNotMatch(details, /sentinel-|user:password/);
    assert.match(details, /\[redacted\]/);
    assert.match(details, /\[truncated \d+ characters\]/);
    assert.match(details, /tail evidence/);
    assert.ok(
        details.length < 5000,
        `Unexpected diagnostic length: ${details.length}`,
    );
});
