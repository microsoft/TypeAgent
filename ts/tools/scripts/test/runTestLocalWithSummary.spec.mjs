// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runner = fileURLToPath(
    new URL("../runTestLocalWithSummary.mjs", import.meta.url),
);

for (const scenario of [
    {
        name: "passed package remains in retry union",
        initial: 1,
        retry: 0,
        scripts: 0,
        secondPackage: true,
        mixedRecovery: true,
    },
    {
        name: "missing file falls back safely",
        initial: 1,
        retry: 0,
        scripts: 0,
        missingFile: true,
        fallback: true,
    },
    { name: "first pass succeeds", initial: 0, retry: 0, scripts: 0 },
    { name: "failed file retry recovers", initial: 1, retry: 0, scripts: 0 },
    { name: "script failure after recovery", initial: 1, retry: 0, scripts: 1 },
    { name: "package retry stays failing", initial: 1, retry: 1, scripts: 0 },
    {
        name: "unknown runner falls back",
        initial: 1,
        retry: 0,
        scripts: 0,
        script: "node --test test/*.spec.mjs",
        fallback: true,
    },
    {
        name: "browser chained phases fall back",
        initial: 1,
        retry: 0,
        scripts: 0,
        script: "jest && npm run test:views:gateway && npm run test:views:client",
        fallback: true,
    },
    {
        name: "setup phases fall back",
        initial: 1,
        retry: 0,
        scripts: 0,
        script: 'pnpm run build && pnpm run jest-esm --testPathPattern=".*[.]spec[.]js"',
        fallback: true,
    },
    {
        name: "retry introduces another failed file",
        initial: 1,
        retry: 0,
        scripts: 0,
        newFile: true,
    },
    {
        name: "unreported retry cannot recover",
        initial: 1,
        retry: 1,
        scripts: 0,
        unreportedRetry: true,
    },
    {
        name: "one unreported package cannot hide behind another package",
        initial: 1,
        retry: 1,
        scripts: 0,
        secondPackage: true,
        unreportedRetry: true,
    },
    {
        name: "unreported package failure",
        initial: 1,
        retry: 0,
        scripts: 0,
        unreported: true,
    },
]) {
    test(`local test accounting: ${scenario.name}`, (t) => {
        const root = fs.mkdtempSync(
            path.join(
                path.dirname(fileURLToPath(import.meta.url)),
                ".typeagent phases & fixtures-",
            ),
        );
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        for (const name of scenario.secondPackage
            ? ["example", "other"]
            : ["example"]) {
            const packageDir = path.join(root, "packages", name);
            fs.mkdirSync(packageDir, { recursive: true });
            fs.mkdirSync(path.join(packageDir, "test"), { recursive: true });
            for (const file of ["x file.spec.js", "new file.spec.js"]) {
                if (!scenario.missingFile)
                    fs.writeFileSync(path.join(packageDir, "test", file), "");
            }
            fs.writeFileSync(
                path.join(packageDir, "package.json"),
                JSON.stringify({
                    name,
                    scripts: {
                        "test:local":
                            scenario.script ??
                            'pnpm run jest-esm --testPathPattern=".*[.]spec[.]js"',
                        "jest-esm":
                            "node --no-warnings --experimental-vm-modules ./node_modules/jest/bin/jest.js",
                    },
                }),
            );
        }
        const fakePnpm = path.join(root, "fakePnpm.mjs");
        fs.writeFileSync(
            fakePnpm,
            `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const root = process.env.TEST_PHASE_ROOT;
const log = path.join(root, "calls.jsonl");
const earlier = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\\n").map(JSON.parse) : [];
fs.appendFileSync(log, JSON.stringify({args, cwd: process.cwd(),
    failures: process.env.TYPEAGENT_TEST_FAILURES_DIR,
    noCache: process.env.TYPEAGENT_JEST_NO_CACHE}) + "\\n");
const scenario = JSON.parse(process.env.TEST_PHASE_SCENARIO);
const scripts = args.includes("test:local:scripts");
const retry = !scripts && !args.includes("test:local:packages");
const retryNumber = earlier.filter((call) => call.args.includes("--runTestsByPath")).length + 1;
const status = scripts ? scenario.scripts : retry ?
    ((scenario.newFile && retryNumber === 1) ||
     (scenario.mixedRecovery && retryNumber === 2) ? 1 : scenario.retry) : scenario.initial;
if (status && !scripts && !scenario.unreported &&
    !(retry && scenario.unreportedRetry && (!scenario.secondPackage || path.basename(process.cwd()) === "other"))) {
    const names = !retry && scenario.secondPackage ? ["example", "other"] : [retry ? path.basename(process.cwd()) : "example"];
    fs.writeFileSync(path.join(process.env.TYPEAGENT_TEST_FAILURES_DIR, "failures.json"),
        JSON.stringify(names.map((name) => ({
            testFilePath: path.join(root, "packages", name, "test", scenario.newFile && retry ? "new file.spec.js" : "x file.spec.js"),
            fullName: "fails", failureMessages: ["expected failure"]}))));
}
process.exitCode = status;
`,
        );
        if (process.platform === "win32") {
            fs.writeFileSync(
                path.join(root, "pnpm.cmd"),
                `@"${process.execPath}" "${fakePnpm}" %*\r\n`,
            );
        } else {
            fs.copyFileSync(fakePnpm, path.join(root, "pnpm"));
            fs.chmodSync(path.join(root, "pnpm"), 0o755);
        }
        const result = spawnSync(process.execPath, [runner], {
            cwd: root,
            env: {
                ...process.env,
                PATH: `${root}${path.delimiter}${process.env.PATH}`,
                GITHUB_ACTIONS: "true",
                GITHUB_STEP_SUMMARY: path.join(root, "summary.md"),
                TEST_PHASE_SCENARIO: JSON.stringify(scenario),
                TEST_PHASE_ROOT: root,
            },
            encoding: "utf8",
        });
        assert.ifError(result.error);
        const expectedFailure =
            scenario.scripts !== 0 ||
            (scenario.initial !== 0 &&
                (scenario.unreported || scenario.retry !== 0));
        assert.equal(result.status, expectedFailure ? 1 : 0, result.stderr);
        const summary = fs.readFileSync(path.join(root, "summary.md"), "utf8");
        const workspaceFailed =
            scenario.initial !== 0 &&
            (scenario.unreported || scenario.retry !== 0);
        assert.ok(
            summary.includes(
                `### Workspace tests (including retries)\n\nResult: **${workspaceFailed ? "failed" : "passed"}**`,
            ),
        );
        assert.ok(
            summary.includes(
                `### Root script tests\n\nResult: **${scenario.scripts ? "failed" : "passed"}**`,
            ),
        );
        const calls = fs
            .readFileSync(path.join(root, "calls.jsonl"), "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        const retryCalls = calls.filter(
            ({ args }) =>
                !args.includes("test:local:packages") &&
                !args.includes("test:local:scripts"),
        );
        assert.deepEqual(calls[0].args, ["run", "test:local:packages"]);
        assert.deepEqual(calls.at(-1).args, ["run", "test:local:scripts"]);
        assert.equal(
            calls.filter(({ args }) => args.includes("test:local:scripts"))
                .length,
            1,
        );
        assert.equal(
            retryCalls.length,
            scenario.initial && !scenario.unreported
                ? scenario.mixedRecovery
                    ? 4
                    : scenario.secondPackage || scenario.newFile
                      ? 2
                      : scenario.unreportedRetry
                        ? 1
                        : scenario.retry
                          ? 2
                          : 1
                : 0,
        );
        assert.equal(
            new Set(retryCalls.map((call) => call.failures)).size,
            retryCalls.length,
        );
        for (const call of retryCalls) {
            assert.equal(call.noCache, "true");
            assert.ok(call.cwd.startsWith(path.join(root, "packages")));
            if (scenario.fallback) {
                assert.deepEqual(call.args, ["run", "test:local"]);
                assert.match(
                    result.stderr,
                    /Full-package retry.*(?:not a recognized single jest-esm invocation|not a regular file contained)/,
                );
            } else {
                assert.deepEqual(call.args.slice(0, 6), [
                    "run",
                    "jest-esm",
                    "--runInBand",
                    "--no-cache",
                    "--passWithNoTests=false",
                    "--runTestsByPath",
                ]);
                assert.ok(
                    call.args.slice(6).every((file) => path.isAbsolute(file)),
                );
                assert.ok(
                    call.args.includes(
                        path.join(call.cwd, "test", "x file.spec.js"),
                    ),
                );
            }
        }
        if (scenario.newFile) {
            assert.deepEqual(retryCalls[1].args.slice(6), [
                path.join(
                    root,
                    "packages",
                    "example",
                    "test",
                    "x file.spec.js",
                ),
                path.join(
                    root,
                    "packages",
                    "example",
                    "test",
                    "new file.spec.js",
                ),
            ]);
        }
        if (scenario.unreportedRetry) {
            assert.match(result.stderr, /Untrusted retry/);
            assert.doesNotMatch(result.stderr, /FLAKY TESTS/);
        }
    });
}
