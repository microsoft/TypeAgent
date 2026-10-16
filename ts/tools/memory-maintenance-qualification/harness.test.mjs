// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
    classifyRequestError,
    observedFetch,
    transportFailedPass,
} from "./transport.mjs";
import {
    loadPlan,
    snapshotCompiledCheckpoint,
    validateSpec,
    writeJson,
} from "./harness.mjs";
import { measureProgress, reviewPacket } from "./evaluate.mjs";
import { configuredRoleOptions } from "./offline-models.mjs";
import { alive, supervise, validateAdmission } from "./watchdog.mjs";

const productRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
);
const fixtureRoot = path.join(
    productRoot,
    "packages",
    "memory",
    "service",
    "test",
    "fixtures",
    "memoryDemo",
);

async function runHarnessCli(args) {
    const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("./harness.mjs", import.meta.url)), ...args],
        { stdio: ["ignore", "pipe", "pipe"], timeout: 30000 },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
        stdout += data;
    });
    child.stderr.on("data", (data) => {
        stderr += data;
    });
    const code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
    });
    return { code, stdout, stderr };
}

test("offline worker CLI preserves newline output and captures final diagnostics before owned failure cleanup", async () => {
    const help = await runHarnessCli(["--help"]);
    assert.equal(help.code, 0, help.stderr);
    assert.equal(
        help.stdout,
        "Offline worker: node harness.mjs --spec <absolute owned spec.json>. Launch through watchdog.mjs.\n",
    );
    const root = await mkdtemp(
        path.join(productRoot, ".qualification-worker-cleanup-test-"),
    );
    try {
        const receiptId = "worker-cleanup-regression";
        await writeJson(path.join(root, "ownership.json"), {
            receiptId,
            runDirectory: root,
        });
        const specPath = path.join(root, "spec.json");
        await writeJson(specPath, {
            receiptId,
            mode: "offline",
            productRoot,
            fixtureRoot: path.join(root, "missing-fixtures"),
            runDirectory: root,
            startupAllowanceMs: 30000,
            workAllowanceMs: 30000,
            spawnedEpochMs: Date.now(),
            qualification: true,
            p6: true,
            expectedCheckpoint: {
                name: "offline-cli-cleanup-regression",
                hashes: await snapshotCompiledCheckpoint(productRoot),
            },
            nativeProfile: false,
        });
        const result = await runHarnessCli(["--spec", specPath]);
        assert.equal(result.code, 1, result.stderr);
        assert.ok(result.stdout.endsWith("\n"), result.stderr);
        const summary = JSON.parse(result.stdout);
        const receipt = JSON.parse(
            await readFile(path.join(root, "receipt.json"), "utf8"),
        );
        assert.equal(summary.receiptId, receiptId);
        assert.equal(summary.outcome, "FAILED");
        assert.equal(receipt.outcome, "FAILED");
        assert.equal(receipt.errors.length, 1);
        assert.match(receipt.errors[0].message, /ENOENT.*profile\.json/);
        assert.equal(receipt.operations.length, 0);
        assert.equal(receipt.counters.network, 0);
        assert.equal(receipt.close.completed, true);
        assert.equal(receipt.beforeClose.outcome, "FAILED");
        assert.equal(receipt.beforeClose.sourceCount, 0);
        assert.deepEqual(receipt.beforeClose.citationErrors, []);
        const snapshot = JSON.parse(
            await readFile(
                path.join(root, "initial-stop-snapshot.json"),
                "utf8",
            ),
        );
        assert.deepEqual(snapshot.sources, []);
        assert.ok(receipt.finishedEpochMs >= receipt.beforeClose.epochMs);
        assert.equal(receipt.snapshotQualification.violations.length, 0);
        assert.equal(receipt.checkpointGuard.afterVerified, true);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("ordered canonical content-only plan uses 33 operations and 25 sources, no alternative inputs", async () => {
    assert.ok(
        fixtureRoot.startsWith(`${productRoot}${path.sep}`),
        "Offline fixtures must be bundled in the product checkout",
    );
    const plan = await loadPlan(fixtureRoot);
    assert.deepEqual(
        plan
            .filter((entry) => entry.phase === "t1")
            .map((entry) => [
                entry.sourceKey,
                entry.replacesRevision,
                entry.revision,
            ]),
        [
            ["sb-pool-worksheet", 1, 2],
            ["sb-review-vocabulary", 1, 2],
            ["sb-overlap-handoff", 1, 2],
            ["sb-capacity-notebook", 1, 2],
            ["sb-followup-meeting", null, 1],
        ],
    );
    assert.ok(
        plan.every(
            (entry) =>
                entry.file.endsWith(".md") &&
                entry.file.includes(`${path.sep}content-only${path.sep}`),
        ),
    );
});

test("actual compiled settings take model as third argument and retain exact identity", async () => {
    const { createDocMemorySettings } = await import(
        pathToFileURL(
            path.join(
                productRoot,
                "packages",
                "memory",
                "conversation",
                "dist",
                "docMemory.js",
            ),
        ).href
    );
    const model = {
        complete: async () => {
            throw new Error("No inference");
        },
    };
    assert.equal(
        createDocMemorySettings(64, undefined, model).languageModel,
        model,
    );
});

test("timezone-neutral epoch admission rejects forged PID, timestamp, expired and over-cap allowances", () => {
    const epochs = [
        "2026-10-12T14:51:59.989-07:00",
        "2026-10-12T21:51:59.989Z",
        "2026-10-12T23:51:59.989+02:00",
    ].map(Date.parse);
    assert.ok(epochs.every((epoch) => epoch === epochs[0]));
    const now = Date.now();
    const spec = {
        mode: "offline",
        productRoot,
        fixtureRoot,
        runDirectory: os.tmpdir(),
        receiptId: "offline-test",
        spawnedEpochMs: now,
        startupAllowanceMs: 1000,
        workAllowanceMs: 5000,
    };
    validateSpec(spec);
    const ack = {
        receiptId: spec.receiptId,
        workerPid: 1234,
        admittedEpochMs: now,
        workDeadlineEpochMs: now + 5000,
    };
    validateAdmission(JSON.parse(JSON.stringify(ack)), spec, 1234, now);
    for (const mutation of [
        { workerPid: 1235 },
        { admittedEpochMs: new Date(now).toISOString() },
        { admittedEpochMs: now - 10000, workDeadlineEpochMs: now - 5000 },
        { workDeadlineEpochMs: now + 5001 },
    ])
        assert.throws(() =>
            validateAdmission({ ...ack, ...mutation }, spec, 1234, now),
        );
    assert.throws(() => validateSpec({ ...spec, workAllowanceMs: 5_400_001 }));
    assert.throws(() => validateSpec({ ...spec, mode: "configured" }));
});

test("structured fetch/error receipts, provider backoff and local failures never inspect source prose", async () => {
    const records = [];
    const response = await observedFetch(
        async () =>
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: "HTTP 429 TimeoutError ECONNRESET",
                            },
                        },
                    ],
                    usage: { total_tokens: 7 },
                }),
                {
                    status: 200,
                    headers: { "content-type": "application/json" },
                },
            ),
        "https://invalid.example",
        undefined,
        records,
    );
    assert.equal(response.status, 200);
    assert.equal(transportFailedPass(records), false);
    assert.equal(records[0].usage.total_tokens, 7);
    await observedFetch(
        async () =>
            new Response(JSON.stringify({ error: { code: "rate_limit" } }), {
                status: 429,
                headers: {
                    "content-type": "application/json",
                    "retry-after": "11",
                },
            }),
        "https://invalid.example",
        undefined,
        records,
    );
    assert.equal(records[1].retryAfter, "11");
    assert.equal(transportFailedPass(records), true);
    const disconnected = Object.assign(new TypeError("Failed fetch"), {
        cause: { code: "ECONNRESET" },
    });
    await assert.rejects(
        observedFetch(
            async () => {
                throw disconnected;
            },
            "https://invalid.example",
            undefined,
            records,
        ),
        TypeError,
    );
    assert.equal(records[2].error.class, "network-transport");
    assert.equal(
        classifyRequestError(new DOMException("timeout", "TimeoutError")).class,
        "local-timeout",
    );
    assert.equal(
        classifyRequestError(new DOMException("cancel", "AbortError")).class,
        "local-cancellation",
    );
    const application = [
        { status: 200, error: { class: "provider-response-error" } },
    ];
    assert.equal(transportFailedPass(application), true);
});

test("receipt progress distinguishes actual states, parked failures and undiscovered subjects", () => {
    const data = measureProgress(
        {
            cursor: 2,
            dirty: false,
            descriptors: [
                { viewId: "a", query: "lease" },
                { viewId: "b", query: "memory" },
            ],
        },
        [
            {
                results: [
                    { viewId: "a", state: "searchable" },
                    { viewId: "b", state: "blocked", reason: "scoped failure" },
                ],
            },
        ],
        [
            {
                viewId: "a",
                indexState: "ready",
                publishedRevisionId: "r1",
                indexedRevisionId: "r1",
            },
        ],
        [{ term: "lease" }, { term: "memory" }, { term: "Orders" }],
    );
    assert.deepEqual(data.discovered, ["a", "b"]);
    assert.deepEqual(data.applied, ["a"]);
    assert.deepEqual(data.ready, ["a"]);
    assert.equal(data.parked[0].viewId, "b");
    assert.deepEqual(data.undiscovered, ["Orders"]);
});

test("independent C1-C11 evaluator packet stays pending and actual CLI surfaces output-write errors", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "qualification-evaluator-test-"),
    );
    try {
        const receipt = {
            receiptId: "evaluator-cli-shape-test",
            outcome: "OFFLINE_PREPARATION_VERIFIED_P6_GATE_PENDING",
            checks: [
                {
                    name: "mechanical observation only",
                    cases: ["C1"],
                    status: "PASS_OFFLINE",
                },
            ],
            pending: ["P6"],
        };
        const packet = await reviewPacket(fixtureRoot, receipt);
        assert.deepEqual(
            packet.cases.map((entry) => entry.id),
            Array.from({ length: 11 }, (_unused, index) => `C${index + 1}`),
        );
        assert.ok(
            packet.cases.every((entry) =>
                entry.semanticVerdict.startsWith("PENDING"),
            ),
        );
        const receiptPath = path.join(root, "receipt.json");
        await writeJson(receiptPath, receipt);
        const child = spawn(
            process.execPath,
            [
                path.join(
                    path.dirname(fileURLToPath(import.meta.url)),
                    "evaluate.mjs",
                ),
                "--receipt",
                receiptPath,
                "--fixtures",
                fixtureRoot,
                "--output",
                path.join(root, "absent-parent", "output.json"),
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stderr = "";
        child.stderr.on("data", (data) => {
            stderr += data;
        });
        const code = await new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("close", resolve);
        });
        assert.notEqual(code, 0);
        assert.match(stderr, /ENOENT/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("configured loader denies before reading config or creating model without separate handoff", async () => {
    let loaded = 0;
    await assert.rejects(
        configuredRoleOptions(async () => {
            loaded++;
        }, {}),
        /separate verified coordinator handoff/,
    );
    assert.equal(loaded, 0);
});

test("external startup/admitted watchdog kills only exact owned process and preserves sentinel", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "qualification-watchdog-test-"),
    );
    const sentinel = spawn(
        process.execPath,
        ["-e", "setInterval(()=>{},1000)"],
        { stdio: "ignore" },
    );
    const sentinelExit = new Promise((resolve) =>
        sentinel.once("exit", resolve),
    );
    try {
        for (const mode of ["startup", "work", "wrong-pid"]) {
            const dir = await mkdtemp(path.join(root, `${mode}-`));
            const receiptId = `watchdog-${mode}`;
            await writeJson(path.join(dir, "ownership.json"), {
                receiptId,
                runDirectory: dir,
            });
            const worker = path.join(dir, "worker.mjs");
            await writeFile(
                worker,
                `
import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
const spec=JSON.parse(await readFile(process.argv[3],"utf8"));
if (${JSON.stringify(mode)} !== "startup") {
  const now=Date.now();
  await writeFile(path.join(spec.runDirectory,"admitted.json"),JSON.stringify({
    receiptId:spec.receiptId, workerPid:process.pid + (${JSON.stringify(mode)} === "wrong-pid" ? 1 : 0),
    admittedEpochMs:now,workDeadlineEpochMs:now+spec.workAllowanceMs
  }));
}
setInterval(()=>{},1000);
`,
            );
            const receipt = await supervise(
                {
                    receiptId,
                    mode: "offline",
                    runDirectory: dir,
                    productRoot,
                    fixtureRoot,
                    startupAllowanceMs: 1000,
                    workAllowanceMs: 300,
                },
                worker,
            );
            assert.equal(
                receipt.outcome,
                mode === "startup"
                    ? "STARTUP_TIMEOUT"
                    : mode === "work"
                      ? "BOUNDED_WORK_INCOMPLETE"
                      : "WATCHDOG_REJECTED",
            );
            assert.equal(receipt.workerExited, true);
            assert.equal(receipt.forced, true);
            assert.equal(alive(receipt.workerPid), false);
            assert.equal(alive(sentinel.pid), true);
            if (mode === "work") {
                const ack = JSON.parse(
                    await readFile(
                        path.join(dir, "admission-verified.json"),
                        "utf8",
                    ),
                );
                assert.equal(ack.workerPid, receipt.workerPid);
                assert.ok(receipt.finishedEpochMs >= ack.workDeadlineEpochMs);
            }
        }
    } finally {
        sentinel.kill();
        await sentinelExit;
        await rm(root, { recursive: true, force: true });
    }
});
