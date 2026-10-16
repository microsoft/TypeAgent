// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const configPath = fileURLToPath(
    new URL("../../../jest.config.js", import.meta.url),
);

for (const ci of ["true", "false"]) {
    test(`Jest limits workers only in CI: CI=${ci}`, () => {
        const result = spawnSync(
            process.execPath,
            [
                "-e",
                "process.stdout.write(JSON.stringify(require(process.argv[1])))",
                configPath,
            ],
            { env: { ...process.env, CI: ci }, encoding: "utf8" },
        );
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        const config = JSON.parse(result.stdout);
        if (ci === "true") assert.equal(config.maxWorkers, 1);
        else assert.equal(Object.hasOwn(config, "maxWorkers"), false);
    });
}
