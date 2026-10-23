// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const validator = path.join(directory, "..", "validateBundledArtifact.mjs");
const pipeline = path.resolve(
    directory,
    "..",
    "..",
    "..",
    "..",
    "pipelines",
    "azure-build-publish-all.yml",
);

test("bundled artifact budgets retain the inclusive file limit and subsequent validation", async (t) => {
    const pipelineSource = fs.readFileSync(pipeline, "utf8");
    const match = pipelineSource.match(
        /validateBundledArtifact\.mjs[^\r\n]*--max-files (\d+)/,
    );
    assert.ok(match, "CI must set an explicit bundled artifact budget");
    const pipelineBudget = Number(match[1]);
    assert.equal(pipelineBudget, 10000);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-budget-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.writeFileSync(
        path.join(root, "node_modules", ".typeagent-agents.json"),
        JSON.stringify({ agents: [] }),
    );
    fs.writeFileSync(path.join(root, "unexpected.js.map"), "{}");
    let files = 2;

    for (const count of [9999, 10000, 10001]) {
        while (files < count) {
            fs.writeFileSync(path.join(root, `file-${files}.json`), "{}");
            files++;
        }
        for (const [name, args] of [
            ["default", []],
            ["CI", ["--max-files", String(pipelineBudget)]],
        ]) {
            await t.test(`${name} budget with ${count} files`, () => {
                const result = spawnSync(
                    process.execPath,
                    [validator, "--dir", root, ...args],
                    { encoding: "utf8", timeout: 30000 },
                );
                assert.ifError(result.error);
                assert.equal(result.status, 1);
                if (count > pipelineBudget) {
                    assert.match(
                        result.stderr,
                        /Bundled artifact has 10001 files; maximum is 10000\./,
                    );
                } else {
                    assert.doesNotMatch(result.stderr, /maximum is/);
                    assert.match(
                        result.stderr,
                        /Bundled artifact contains development files:/,
                    );
                    assert.match(result.stderr, /unexpected\.js\.map/);
                }
            });
        }
    }

    await t.test("an explicit smaller budget is still enforced", () => {
        const result = spawnSync(
            process.execPath,
            [validator, "--dir", root, "--max-files", "8200"],
            { encoding: "utf8", timeout: 30000 },
        );
        assert.ifError(result.error);
        assert.equal(result.status, 1);
        assert.match(
            result.stderr,
            /Bundled artifact has 10001 files; maximum is 8200\./,
        );
    });
});
