// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import path from "node:path";
import test from "node:test";

const cli = path.resolve("dist/src/cli.js");

function runCli(...args: string[]): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [cli, ...args], {
        cwd: process.cwd(),
        encoding: "utf8",
    });
}

test("documents one-model and one-variant run selection", () => {
    const result = runCli("help");

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--model <model>/);
    assert.match(result.stdout, /--variant <name>/);
    assert.match(result.stdout, /--language <name>/);
    assert.match(result.stdout, /report-three-arm/);
    assert.match(result.stdout, /--task-offset <n>/);
    assert.match(result.stdout, /--task-seed <seed>/);
    assert.match(result.stdout, /--task-ids-file <file>/);
    assert.match(result.stdout, /--force-rerun/);
    assert.match(result.stdout, /cleanup-images/);
    assert.match(result.stdout, /--apply/);
});

test("rejects unsupported one-row model and variant selections", () => {
    const badModel = runCli(
        "run",
        "--limit",
        "1",
        "--model",
        "not-a-model",
        "--variant",
        "typeagent",
    );
    assert.equal(badModel.status, 1);
    assert.match(badModel.stderr, /Unsupported benchmark model/);

    const badVariant = runCli(
        "run",
        "--limit",
        "1",
        "--model",
        "azure/gpt-5.6-sol",
        "--variant",
        "not-a-variant",
    );
    assert.equal(badVariant.status, 1);
    assert.match(badVariant.stderr, /Unsupported benchmark variant/);
});

test("accepts the legacy TypeAgent variant as a CLI input alias", () => {
    const result = runCli(
        "run",
        "--limit",
        "1",
        "--model",
        "azure/gpt-5.6-sol",
        "--variant",
        "typeagent-mcp",
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing --mcp-command/);
    assert.doesNotMatch(result.stderr, /Unsupported benchmark variant/);
});

test("rejects legacy and canonical TypeAgent aliases as duplicates", () => {
    const result = runCli(
        "run",
        "--limit",
        "1",
        "--model",
        "azure/gpt-5.6-sol",
        "--variant",
        "typeagent-mcp",
        "--variant",
        "typeagent",
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /--variant values must be unique/);
});

test("rejects a negative task offset before starting the harness", () => {
    const result = runCli("run", "--task-offset", "-1");

    assert.equal(result.status, 1);
    assert.match(result.stderr, /--task-offset must be a non-negative integer/);
});

test("rejects combining deterministic offset and seeded random selection", () => {
    const result = runCli(
        "run",
        "--task-offset",
        "10",
        "--task-seed",
        "generalization",
    );

    assert.equal(result.status, 1);
    assert.match(
        result.stderr,
        /one of --task-seed, --task-offset, or --task-ids-file/,
    );
});
