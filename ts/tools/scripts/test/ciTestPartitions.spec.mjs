// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    balanceTests,
    partitionPackages,
    qualifyPartitions,
    runPartitionAttempts,
    timingsFromLog,
    validatePartitions,
} from "../lib/ciTestPartitions.mjs";

test("duration balancing is deterministic, longest-first and covers every file exactly once", () => {
    const timings = { a: 10, b: 9, c: 8, d: 7, e: 6, f: 5, g: 4, h: 3 };
    const files = Object.keys(timings);
    const plan = balanceTests(files, timings);
    assert.deepEqual(balanceTests([...files].reverse(), timings), plan);
    assert.deepEqual(
        plan.groups.map((group) => group.estimatedMs),
        [13, 13, 13, 13],
    );
    validatePartitions(files, plan.groups);
    assert.deepEqual(plan.unprofiled, []);
});

test("missing profile entries are explicit and use the measured package median", () => {
    const plan = balanceTests(["a", "b", "c", "d"], { a: 10, b: 20 });
    assert.equal(plan.fallbackMs, 20);
    assert.deepEqual(plan.unprofiled, ["c", "d"]);
    assert.equal(balanceTests(["a", "b", "c", "d"], {}).fallbackMs, 1000);
    for (const invalid of [-1, 0, NaN, Infinity]) {
        assert.throws(
            () => balanceTests(["a", "b", "c", "d"], { a: invalid }),
            /Invalid timing/,
        );
    }
});

test("empty, duplicate and incomplete partitions fail closed", () => {
    assert.throws(() => balanceTests([], {}));
    assert.throws(() => balanceTests(["a", "a", "b", "c"], {}));
    assert.throws(() => balanceTests(["a"], {}));
    assert.throws(() =>
        validatePartitions(
            ["a", "b", "c", "d"],
            [
                { files: ["a"] },
                { files: ["b"] },
                { files: ["c"] },
                { files: ["c"] },
            ],
        ),
    );
});

test("hosted profiling strips ANSI, accepts both target packages and retains worst observations", () => {
    const lines = [
        "2026-11-05T00:00:00Z packages/dispatcher/dispatcher test:local: \x1b[32mPASS\x1b[0m dist/test/a.spec.js (4.5 s)",
        "2026-11-05T00:00:01Z packages/dispatcher/dispatcher test:local: FAIL dist/test/a.spec.js (3 s)",
        "2026-11-05T00:00:02Z packages/defaultAgentProvider test:local: PASS dist/test/b.spec.js (2 s)",
        "packages/other test:local: PASS dist/test/ignored.spec.js (99 s)",
    ];
    assert.deepEqual(timingsFromLog(lines.join("\n")), {
        "packages/dispatcher/dispatcher/dist/test/a.spec.js": 4500,
        "packages/defaultAgentProvider/dist/test/b.spec.js": 2000,
    });
    assert.throws(() => timingsFromLog("no timing records"), /No dispatcher/);
});

test("partition retries retain initial successes and retry only failed files in fresh attempts", () => {
    const calls = [];
    const result = runPartitionAttempts(["a", "b"], (files, retry) => {
        calls.push({ files, retry });
        return retry === 0
            ? {
                  json: {
                      testResults: [
                          { name: "a", status: "passed" },
                          { name: "b", status: "failed" },
                      ],
                  },
                  success: false,
                  failed: ["b"],
              }
            : {
                  json: { testResults: [{ name: "b", status: "passed" }] },
                  success: true,
                  failed: [],
              };
    });
    assert.deepEqual(calls, [
        { files: ["a", "b"], retry: 0 },
        { files: ["b"], retry: 1 },
    ]);
    assert.equal(result.firstPassSucceeded, false);
    assert.equal(result.success, true);
    assert.equal(result.attempts, 2);
    assert.ok(result.results.every((file) => file.status === "passed"));
});

test("persistent partition failures exhaust the existing two-retry budget", () => {
    const result = runPartitionAttempts(["a"], () => ({
        json: { testResults: [{ name: "a", status: "failed" }] },
        failed: ["a"],
        success: false,
    }));
    assert.equal(result.attempts, 3);
    assert.equal(result.success, false);
    assert.throws(
        () =>
            runPartitionAttempts(["a"], () => ({
                json: { testResults: [] },
                failed: [],
                success: false,
            })),
        /identify failed files/,
    );
    assert.throws(
        () =>
            runPartitionAttempts(["a"], () => {
                throw new Error("spawn failed");
            }),
        /spawn failed/,
    );
});

function reports() {
    return ["linux", "win32"].flatMap((platform) =>
        ["v24.22.1", "v26.12.1"].flatMap((node) =>
            Object.keys(partitionPackages).flatMap((target) =>
                ["1", "2", "3", "4"].map((group) => ({
                    platform,
                    node,
                    target,
                    group,
                    sha: "a".repeat(40),
                    manifestHash: `${platform}-${node}`,
                    expectedTests: ["1", "2", "3", "4"],
                    selectedTests: [group],
                    files: [group],
                    outcomes: [`${group}-assertion`],
                    success: true,
                    firstPassSucceeded: true,
                    elapsedMs: 100,
                })),
            ),
        ),
    );
}

test("aggregation requires all 32 exact package partitions and reports first-pass failures", () => {
    const rows = reports();
    assert.equal(rows.length, 32);
    rows[0].firstPassSucceeded = false;
    const summary = qualifyPartitions(rows, "a".repeat(40));
    assert.equal(summary.length, 8);
    assert.equal(summary[0].firstPassFailures, 1);
});

test("legacy Node-selection alias requires the same 32 reports and rejects retired targets", () => {
    const sha = "a".repeat(40);
    const rows = reports();
    assert.equal(rows.length, 32);
    assert.equal(qualifyPartitions(rows, sha, "24-and-26").length, 8);
    assert.deepEqual(
        qualifyPartitions(rows, sha),
        qualifyPartitions(rows, sha, "24-and-26"),
    );
    assert.throws(() => qualifyPartitions(rows.slice(1), sha, "24-and-26"));
    const wrongNode = structuredClone(rows);
    wrongNode[0].node = "v22.23.4";
    assert.throws(() => qualifyPartitions(wrongNode, sha, "24-and-26"));
    assert.throws(() => qualifyPartitions([...rows, wrongNode[0]], sha));
});

for (const [name, change] of [
    ["missing report", (rows) => rows.pop()],
    [
        "failed report",
        (rows) => {
            rows[0].success = false;
        },
    ],
    [
        "wrong SHA",
        (rows) => {
            rows[0].sha = "b".repeat(40);
        },
    ],
    [
        "mixed artifact",
        (rows) => {
            rows[0].manifestHash = "different";
        },
    ],
    [
        "missing test",
        (rows) => {
            rows[0].files = [];
        },
    ],
    [
        "extra test",
        (rows) => {
            rows[0].files.push("extra");
        },
    ],
    [
        "duplicate group",
        (rows) => {
            rows[0].group = "2";
        },
    ],
    [
        "wrong OS",
        (rows) => {
            rows[0].platform = "darwin";
        },
    ],
    [
        "no assertions",
        (rows) => {
            rows[0].outcomes = [];
        },
    ],
]) {
    test(`package qualification rejects ${name}`, () => {
        const rows = reports();
        change(rows);
        assert.throws(() => qualifyPartitions(rows, "a".repeat(40)));
    });
}
