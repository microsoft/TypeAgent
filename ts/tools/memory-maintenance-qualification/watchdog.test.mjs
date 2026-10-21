// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { alive, supervise, workerDeadline } from "./watchdog.mjs";

test("baseline19 watchdog includes startup and preflight in the exact thirty-five-minute cap", () => {
    const spec = {
        sourceScope: "baseline19",
        spawnedEpochMs: 1000,
        workAllowanceMs: 2100000,
    };
    const admission = { workDeadlineEpochMs: 2160000 };
    assert.equal(workerDeadline(spec, admission, 121000), 2101000);
    assert.equal(workerDeadline(spec, undefined, 121000), 121000);
    assert.equal(
        workerDeadline({ ...spec, sourceScope: undefined }, admission, 121000),
        2160000,
    );
});

async function createRun(t, mode, extra = {}) {
    const runDirectory = await mkdtemp(
        path.join(process.cwd(), "qualification-watchdog-refactor-"),
    );
    t.after(() => rm(runDirectory, { recursive: true, force: true }));
    const spec = {
        receiptId: "watchdog-refactor",
        runDirectory,
        startupAllowanceMs: 2000,
        workAllowanceMs: 150,
        ...extra,
    };
    await writeFile(
        path.join(runDirectory, "ownership.json"),
        JSON.stringify({ receiptId: spec.receiptId, runDirectory }),
    );
    const worker = path.join(runDirectory, "worker.mjs");
    await writeFile(
        worker,
        `
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const spec = JSON.parse(await readFile(process.argv[3], "utf8"));
const mode = ${JSON.stringify(mode)};
process.stdout.write("worker stdout\\n");
process.stderr.write("worker stderr\\n");
if (mode === "admitted") {
    const admittedEpochMs = Date.now();
    await writeFile(path.join(spec.runDirectory, "admitted.json"), JSON.stringify({
        receiptId: spec.receiptId,
        workerPid: process.pid,
        admittedEpochMs,
        workDeadlineEpochMs: admittedEpochMs + spec.workAllowanceMs,
    }));
    setInterval(() => {}, 1000);
} else if (mode === "malformed") {
    await writeFile(path.join(spec.runDirectory, "admitted.json"), "{");
    setInterval(() => {}, 1000);
} else {
    await new Promise(resolve => setTimeout(resolve, 100));
    process.exitCode = Number(mode);
}
`,
    );
    return {
        spec,
        run: (overrides = {}) =>
            supervise({ ...spec, ...overrides }, worker, () => {}),
    };
}

for (const [code, outcome] of [
    [0, "WORKER_COMPLETED"],
    [86, "WORKER_INTERRUPTED"],
    [7, "WORKER_FAILED"],
]) {
    test(`watchdog classifies actual normal exit ${code} and flushes owned logs`, async (t) => {
        const { spec, run } = await createRun(t, String(code), {
            performance: true,
            nativeProfile: false,
        });
        const receipt = await run();
        assert.equal(receipt.outcome, outcome);
        assert.deepEqual(receipt.exit, { code, signal: null });
        assert.equal(receipt.forced, false);
        assert.equal(receipt.workerExited, true);
        assert.equal(alive(receipt.workerPid), false);
        assert.equal(receipt.nativeProfile, "DISABLED_SPARSE_NATIVE_OFF");
        assert.deepEqual(
            JSON.parse(
                await readFile(
                    path.join(spec.runDirectory, "termination.json"),
                    "utf8",
                ),
            ),
            receipt,
        );
        assert.equal(
            await readFile(
                path.join(
                    spec.runDirectory,
                    `stdout-${receipt.startedEpochMs}.log`,
                ),
                "utf8",
            ),
            "worker stdout\n",
        );
        assert.equal(
            await readFile(
                path.join(
                    spec.runDirectory,
                    `stderr-${receipt.startedEpochMs}.log`,
                ),
                "utf8",
            ),
            "worker stderr\n",
        );
    });
}

test("watchdog waits past admission until bounded work exits and preserves the signal", async (t) => {
    const { spec, run } = await createRun(t, "admitted");
    const receipt = await run();
    assert.equal(receipt.outcome, "BOUNDED_WORK_INCOMPLETE");
    assert.equal(receipt.phase, "admitted-work");
    assert.equal(receipt.forced, true);
    assert.equal(receipt.workerExited, true);
    assert.equal(alive(receipt.workerPid), false);
    assert.ok(receipt.finishedEpochMs >= receipt.workDeadlineEpochMs);
    assert.notDeepEqual(receipt.exit, { code: 0, signal: null });
    const admission = JSON.parse(
        await readFile(
            path.join(spec.runDirectory, "admission-verified.json"),
            "utf8",
        ),
    );
    assert.equal(admission.workerPid, receipt.workerPid);
    assert.equal(admission.watchdogPid, process.pid);
});

test("watchdog rejects malformed admission only after its owned worker exits", async (t) => {
    const { run } = await createRun(t, "malformed");
    const receipt = await run();
    assert.equal(receipt.outcome, "WATCHDOG_REJECTED");
    assert.equal(receipt.error.name, "SyntaxError");
    assert.equal(receipt.forced, true);
    assert.equal(receipt.workerExited, true);
    assert.equal(alive(receipt.workerPid), false);
    assert.equal(Object.hasOwn(receipt, "exit"), false);
});

test("watchdog resume archives stale admission only after exact previous PID exits", async (t) => {
    const { spec, run } = await createRun(t, "0");
    const previous = await run();
    const staleAdmission = '{"stale":true}';
    await writeFile(
        path.join(spec.runDirectory, "admitted.json"),
        staleAdmission,
    );
    const receipt = await run({ resume: true });
    assert.equal(receipt.outcome, "WORKER_COMPLETED");
    assert.notEqual(receipt.workerPid, previous.workerPid);
    const files = await readdir(spec.runDirectory);
    const archive = files.find((name) => /^admitted-\d+\.json$/.test(name));
    assert.ok(archive);
    assert.equal(
        await readFile(path.join(spec.runDirectory, archive), "utf8"),
        staleAdmission,
    );
    assert.ok(!files.includes("admitted.json"));
});

test("watchdog rejects live or unconfirmed previous workers and ownership mismatch before spawning", async (t) => {
    const { spec, run } = await createRun(t, "0");
    const terminationPath = path.join(spec.runDirectory, "termination.json");
    await writeFile(
        terminationPath,
        JSON.stringify({ workerExited: false, workerPid: process.pid }),
    );
    await assert.rejects(
        run({ resume: true }),
        /exact previous worker has exited/,
    );
    await writeFile(
        terminationPath,
        JSON.stringify({ workerExited: true, workerPid: process.pid }),
    );
    await assert.rejects(run({ resume: true }), /Previous PID still present/);
    await assert.rejects(run({ receiptId: "not-owner" }));
    const files = await readdir(spec.runDirectory);
    assert.ok(!files.some((name) => name.startsWith("spec-")));
    assert.equal(alive(process.pid), true);
});
