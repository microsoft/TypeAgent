// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

for (const config of [
    "jest.config.js",
    "packages/agents/browser/jest.config.js",
    "packages/agents/browserExtension/jest.config.js",
    "packages/cli/jest.config.js",
    "packages/memory/service/jest.config.cjs",
    "examples/workflow/cli/jest.config.cjs",
]) {
    for (const enabled of ["true", "false"]) {
        test(`Jest CI, retry cache and reporter settings: ${config}, enabled=${enabled}`, () => {
            const configPath = fileURLToPath(
                new URL(`../../../${config}`, import.meta.url),
            );
            const env = {
                ...process.env,
                CI: enabled,
                TYPEAGENT_JEST_NO_CACHE: enabled,
            };
            delete env.TYPEAGENT_TEST_FAILURES_DIR;
            if (enabled === "true") {
                env.TYPEAGENT_TEST_FAILURES_DIR =
                    "unused-config-test-directory";
            }

            const result = spawnSync(
                process.execPath,
                [
                    "--input-type=module",
                    "-e",
                    "import { pathToFileURL } from 'node:url'; const config = await import(pathToFileURL(process.argv[1]).href); process.stdout.write(JSON.stringify(config.default));",
                    configPath,
                ],
                { env, encoding: "utf8" },
            );
            assert.ifError(result.error);
            assert.equal(result.status, 0, result.stderr);
            const actual = JSON.parse(result.stdout);
            assert.equal(
                actual.workerIdleMemoryLimit,
                config === "packages/memory/service/jest.config.cjs" &&
                    enabled === "true"
                    ? "1GB"
                    : undefined,
            );
            if (enabled === "true") {
                assert.equal(actual.maxWorkers, 1);
                assert.equal(actual.cache, false);
                assert.equal(actual.reporters[0], "default");
                assert.match(actual.reporters[1], /jestFailureReporter\.cjs$/);
            } else {
                assert.equal(Object.hasOwn(actual, "maxWorkers"), false);
                assert.equal(Object.hasOwn(actual, "cache"), false);
                assert.equal(Object.hasOwn(actual, "reporters"), false);
            }
        });
    }
}

test("workflow CLI failures reach the workspace Jest retry reporter", (t) => {
    const root = fileURLToPath(
        new URL("../../../examples/workflow/cli/", import.meta.url),
    );
    const directory = fs.mkdtempSync(
        path.join(root, "dist", "test", ".jest-reporting-"),
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, "probe.spec.js");
    const failuresDirectory = path.join(directory, "failures");
    fs.writeFileSync(
        file,
        "test('CLI reporter probe', () => { throw new Error('intentional reporter failure'); });",
    );
    const env = {
        ...process.env,
        CI: "true",
        TYPEAGENT_TEST_FAILURES_DIR: failuresDirectory,
    };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
        process.execPath,
        [
            "--no-warnings",
            "--experimental-vm-modules",
            path.join(root, "node_modules", "jest", "bin", "jest.js"),
            "--runInBand",
            "--runTestsByPath",
            file,
        ],
        { cwd: root, env, encoding: "utf8", timeout: 30000 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const failures = fs
        .readdirSync(failuresDirectory)
        .flatMap((name) =>
            JSON.parse(
                fs.readFileSync(path.join(failuresDirectory, name), "utf8"),
            ),
        );
    assert.equal(failures.length, 1);
    assert.equal(
        fs.realpathSync(failures[0].testFilePath),
        fs.realpathSync(file),
    );
    assert.equal(failures[0].fullName, "CLI reporter probe");
    assert.match(
        failures[0].failureMessages.join("\n"),
        /intentional reporter failure/,
    );
});
