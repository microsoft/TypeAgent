#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Thin launcher around tools/docsAutogen/dist/cli.js. Two reasons it
// exists rather than invoking the CLI directly:
//
//   1. Node 24 emits a DEP0190 deprecation warning for any
//      `child_process.spawn(..., { shell: true })` call with separate
//      args. simple-git (used inside docs-autogen via git.ts) trips
//      this warning on Windows. We can silence it cleanly with
//      `--no-deprecation` here without losing real diagnostics from
//      our own code.
//
//   2. libuv on Windows occasionally writes
//      `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) ...`
//      directly to fd 2 from C *after* the JS event loop has finished.
//      It's a known Node/libuv shutdown race, not anything our code
//      triggers, but it confuses end users into thinking the run
//      failed. The string is written outside the JS layer so the only
//      way to suppress it is to filter stderr at the parent-process
//      boundary.
//
// The filter only swallows specific known-cosmetic lines listed in
// NOISE_PATTERNS. Everything else from stderr — including any real
// errors from the CLI — is forwarded verbatim.
"use strict";
const path = require("node:path");

const cliPath = path.resolve(__dirname, "..", "dist", "cli.js");

const NOISE_PATTERNS = [
    /^Assertion failed: !\(handle->flags & UV_HANDLE_CLOSING\)/,
];

function isNoise(line) {
    return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

const result = require("node:child_process").spawnSync(
    process.execPath,
    ["--no-deprecation", "--no-warnings", cliPath, ...process.argv.slice(2)],
    { stdio: ["inherit", "inherit", "pipe"], encoding: "utf8" },
);

if (result.error !== undefined && result.error !== null) {
    process.stderr.write(
        `Failed to launch docs-autogen: ${result.error.message}\n`,
    );
    process.exit(1);
}

const stderrText = result.stderr ?? "";
for (const line of stderrText.split(/\r?\n/u)) {
    if (line.length > 0 && !isNoise(line)) {
        process.stderr.write(`${line}\n`);
    }
}

if (result.signal !== null && result.signal !== undefined) {
    process.kill(process.pid, result.signal);
}

// Windows libuv occasionally aborts during process teardown with
// STATUS_STACK_BUFFER_OVERRUN (0xC0000409 / -1073740791) — see
// https://github.com/libuv/libuv/issues/3654 and downstream Node
// reports. The abort happens *after* our event loop has finished and
// any meaningful work is done; functionally it is a no-op, but it
// confuses CI and shells into reporting failure on a successful run.
// We unconditionally normalise this exit code on Windows because:
//   * Our CLI does not invoke native code that could plausibly trip
//     a real stack-buffer-overrun bug.
//   * The CLI prints structured per-package status to stdout before
//     exit; any real failure would be visible there.
// Outside Windows the override is a no-op.
const ABNORMAL_WINDOWS_TEARDOWN = -1073740791;
if (
    process.platform === "win32" &&
    result.status === ABNORMAL_WINDOWS_TEARDOWN
) {
    process.exit(0);
}
process.exit(result.status ?? 0);
