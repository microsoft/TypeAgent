// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

for (const config of [
    "jest.config.js",
    "packages/agents/browser/jest.config.js",
    "packages/agents/browserExtension/jest.config.js",
    "packages/cli/jest.config.js",
    "packages/memory/service/jest.config.cjs",
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
