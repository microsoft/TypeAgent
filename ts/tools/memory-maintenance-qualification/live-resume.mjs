// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    withLiveRunLock,
    completedLiveOperations,
    validateLiveResumeSources,
    reconcileLiveSource,
} from "../../packages/benchmarks/src/memoryBench/shared/resume.mjs";
export {
    withLiveRunLock,
    completedLiveOperations,
    validateLiveResumeSources,
    reconcileLiveSource,
};

import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { alive } from "./watchdog.mjs";
import { writeJson } from "./harness.mjs";

export async function prepareLiveResume(spec) {
    assert.equal(
        spec.sourceScope,
        "baseline19",
        "Only baseline19 live continuation is supported",
    );
    const directory = await realpath(spec.runDirectory);
    const owner = JSON.parse(
        await readFile(path.join(directory, "ownership.json"), "utf8"),
    );
    const termination = JSON.parse(
        await readFile(path.join(directory, "termination.json"), "utf8"),
    );
    const previousSpec = JSON.parse(
        await readFile(
            path.join(directory, `spec-${termination.startedEpochMs}.json`),
            "utf8",
        ),
    );
    const previous = await readLiveReceipt(directory);
    assert.equal(owner.receiptId, termination.receiptId);
    assert.equal(owner.receiptId, previous.receiptId);
    assert.equal(owner.receiptId, previousSpec.receiptId);
    assert.equal(await realpath(owner.runDirectory), directory);
    assert.equal(
        termination.workerExited,
        true,
        "Previous worker has not exited",
    );
    assert.equal(
        alive(termination.workerPid),
        false,
        "Previous worker PID is still present",
    );
    assert.equal(
        alive(termination.watchdogPid),
        false,
        "Previous watchdog PID is still present",
    );
    assert.ok(previous.corpusId, "Previous run never created a corpus");
    assert.equal(
        await realpath(previous.store),
        await realpath(path.join(directory, "isolated-store")),
        "Retained store changed",
    );
    assert.ok(
        previous.outcome === "PARTIAL_BOUNDED_WORK" ||
            termination.outcome === "BOUNDED_WORK_INCOMPLETE",
        "Only interrupted bounded work may resume automatically",
    );
    for (const key of ["productRoot", "fixtureRoot"])
        assert.equal(
            await realpath(previousSpec[key]),
            await realpath(spec[key]),
            `${key} changed`,
        );
    assert.equal(previousSpec.sourceScope, spec.sourceScope);
    assert.deepEqual(
        previousSpec.expectedCheckpoint,
        spec.expectedCheckpoint,
        "Compiled checkpoint changed",
    );
    assert.deepEqual(
        previous.dependencyCheckpoint,
        spec.dependencyCheckpoint,
        "Dependency checkpoint changed",
    );
    const digest = createHash("sha256")
        .update(JSON.stringify(spec.expectedCheckpoint.hashes))
        .digest("hex");
    assert.equal(
        previous.checkpoint.digest,
        digest,
        "Previous compiled checkpoint differs",
    );
    const archive = await mkdtemp(
        path.join(directory, "attempt-before-resume-"),
    );
    for (const name of [
        "live-preflight.json",
        "termination.json",
        "admitted.json",
        "baseline19-synopsis-input.json",
        "baseline19-synopsis-output.json",
        "independent-evaluator-packet.json",
        "baseline19-terminal-jobs.json",
    ]) {
        try {
            await copyFile(
                path.join(directory, name),
                path.join(archive, name),
            );
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            assert.ok(
                !["live-preflight.json", "termination.json"].includes(name),
            );
        }
    }
    await writeJson(path.join(archive, "resume-authorization.json"), {
        authorizedEpochMs: Date.now(),
        previousWorkerPid: termination.workerPid,
        previousWatchdogPid: termination.watchdogPid,
        workAllowanceMs: spec.workAllowanceMs,
    });
    return {
        receiptId: owner.receiptId,
        previousReceiptPath: path.join(archive, "live-preflight.json"),
    };
}

export async function readLiveReceipt(directory) {
    return JSON.parse(
        await readFile(path.join(directory, "live-preflight.json"), "utf8"),
    );
}
