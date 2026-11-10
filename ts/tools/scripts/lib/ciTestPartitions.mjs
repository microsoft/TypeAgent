// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { MAX_TEST_RETRIES } from "./testRetry.mjs";
import { fanoutNodes } from "./ciFanoutTargets.mjs";

export const partitionPackages = {
    dispatcher: {
        directory: "packages/dispatcher/dispatcher",
        name: "agent-dispatcher",
        selection: ["--testPathPattern=.*[.]spec[.]js"],
        script: 'pnpm run jest-esm --testPathPattern=".*[.]spec[.]js"',
    },
    provider: {
        directory: "packages/defaultAgentProvider",
        name: "default-agent-provider",
        selection: [
            "--testPathPattern=.*[.]spec[.]js",
            "--testPathIgnorePatterns=grammarNfaIntegration[.]spec[.]js",
        ],
        script: 'pnpm run jest-esm --testPathPattern=".*[.]spec[.]js" --testPathIgnorePatterns="grammarNfaIntegration[.]spec[.]js"',
    },
};

export function validatePartitions(tests, groups) {
    assert.ok(tests.length > 0, "Empty partition inventory");
    assert.equal(new Set(tests).size, tests.length, "Duplicate inventory");
    assert.equal(groups.length, 4, "Expected four duration-balanced groups");
    assert.ok(
        groups.every((group) => group.files.length > 0),
        "Empty group",
    );
    assert.deepEqual(
        groups.flatMap((group) => group.files).sort(),
        [...tests].sort(),
        "Partition inventory is missing or duplicates tests",
    );
}

export function balanceTests(tests, timings) {
    const observed = tests
        .map((file) => timings[file])
        .filter((value) => value !== undefined);
    assert.ok(
        observed.every((value) => Number.isFinite(value) && value > 0),
        "Invalid timing",
    );
    const sorted = [...observed].sort((a, b) => a - b);
    const fallbackMs = sorted.length
        ? sorted[Math.floor(sorted.length / 2)]
        : 1000;
    const weight = (file) => timings[file] ?? fallbackMs;
    const groups = Array.from({ length: 4 }, () => ({
        files: [],
        estimatedMs: 0,
    }));
    for (const file of [...tests].sort(
        (a, b) => weight(b) - weight(a) || a.localeCompare(b),
    )) {
        const group = groups.reduce((best, candidate) =>
            candidate.estimatedMs < best.estimatedMs ? candidate : best,
        );
        group.files.push(file);
        group.estimatedMs += weight(file);
    }
    validatePartitions(tests, groups);
    return {
        tests: [...tests].sort(),
        groups,
        fallbackMs,
        unprofiled: tests.filter((file) => timings[file] === undefined).sort(),
    };
}

export function timingsFromLog(text) {
    const timings = {};
    for (const line of text.replace(/\x1b\[[0-9;]*m/g, "").split("\n")) {
        for (const target of Object.values(partitionPackages)) {
            const prefix = `${target.directory} test:local: `;
            const index = line.indexOf(prefix);
            if (index < 0) continue;
            const match =
                /^(?:PASS|FAIL) (dist\/test\/[\w./-]+\.spec\.js) \(([\d.]+) s\)/.exec(
                    line.slice(index + prefix.length),
                );
            if (!match) continue;
            const file = `${target.directory}/${match[1]}`;
            const ms = Number(match[2]) * 1000;
            assert.ok(Number.isFinite(ms) && ms > 0, "Invalid hosted timing");
            timings[file] = Math.max(timings[file] ?? 0, ms);
        }
    }
    assert.ok(
        Object.keys(timings).length > 0,
        "No dispatcher/provider timings found",
    );
    return timings;
}

export function runPartitionAttempts(files, run) {
    const final = new Map();
    let remaining = files;
    let firstPassSucceeded = false;
    for (let attempt = 0; attempt <= MAX_TEST_RETRIES; attempt++) {
        const result = run(remaining, attempt);
        for (const file of result.json.testResults) final.set(file.name, file);
        if (attempt === 0) firstPassSucceeded = result.success;
        if (result.success)
            return {
                results: [...final.values()],
                success: true,
                firstPassSucceeded,
                attempts: attempt + 1,
            };
        assert.ok(
            result.failed.length > 0,
            "Failed attempt must identify failed files",
        );
        remaining = result.failed;
    }
    return {
        results: [...final.values()],
        success: false,
        firstPassSucceeded,
        attempts: MAX_TEST_RETRIES + 1,
    };
}

export function qualifyPartitions(reports, sha) {
    const nodes = fanoutNodes();
    assert.equal(
        reports.length,
        2 * 2 * nodes.length * 4,
        "Expected two packages, two OSes, selected Nodes and four groups",
    );
    const summary = [];
    for (const platform of ["linux", "win32"]) {
        for (const node of nodes) {
            for (const target of Object.keys(partitionPackages)) {
                const rows = reports.filter(
                    (row) =>
                        row.platform === platform &&
                        row.node === node &&
                        row.target === target,
                );
                assert.deepEqual(rows.map((row) => row.group).sort(), [
                    "1",
                    "2",
                    "3",
                    "4",
                ]);
                for (const row of rows) {
                    assert.equal(row.sha, sha, "Partition SHA mismatch");
                    assert.equal(row.success, true, "Failed package partition");
                    assert.equal(
                        row.manifestHash,
                        rows[0].manifestHash,
                        "Mixed workspace artifacts",
                    );
                    assert.deepEqual(row.expectedTests, rows[0].expectedTests);
                    assert.deepEqual(
                        [...row.files].sort(),
                        [...row.selectedTests].sort(),
                    );
                    assert.ok(
                        row.outcomes.length > 0,
                        "No partition assertions",
                    );
                    assert.ok(
                        Number.isFinite(row.elapsedMs) && row.elapsedMs > 0,
                    );
                }
                validatePartitions(
                    rows[0].expectedTests,
                    rows.map((row) => ({ files: row.files })),
                );
                summary.push({
                    platform,
                    node,
                    target,
                    files: rows[0].expectedTests.length,
                    slowestGroupMs: Math.max(
                        ...rows.map((row) => row.elapsedMs),
                    ),
                    firstPassFailures: rows.filter(
                        (row) => !row.firstPassSucceeded,
                    ).length,
                });
            }
        }
    }
    return summary;
}
