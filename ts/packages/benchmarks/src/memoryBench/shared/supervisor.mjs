// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, realpath, rename } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { checkpointExpectationHash, writeJson } from "./checkpoint.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function alive(pid) {
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error.code === "ESRCH") return false;
        throw error;
    }
}

export function validateAdmission(ack, spec, workerPid, observedEpochMs) {
    assert.equal(ack.receiptId, spec.receiptId);
    assert.equal(
        ack.workerPid,
        workerPid,
        "Admission must name exact owned spawned PID",
    );
    assert.ok(Number.isSafeInteger(ack.admittedEpochMs));
    assert.ok(ack.admittedEpochMs <= observedEpochMs + 1000);
    if (spec.workAllowanceMs === null) {
        assert.equal(ack.workDeadlineEpochMs, null);
    } else {
        assert.ok(Number.isSafeInteger(ack.workDeadlineEpochMs));
        assert.ok(ack.workDeadlineEpochMs > observedEpochMs);
        assert.equal(
            ack.workDeadlineEpochMs - ack.admittedEpochMs,
            spec.workAllowanceMs,
        );
    }
    assert.ok(ack.admittedEpochMs >= spec.spawnedEpochMs);
    if (spec.performance || spec.qualification || spec.expectedCheckpoint) {
        assert.equal(
            ack.checkpointExpectationHash,
            checkpointExpectationHash(spec.expectedCheckpoint),
        );
        assert.match(ack.compiledHashesHash ?? "", /^[a-f0-9]{64}$/);
    }
}

export function workerArguments(spec, worker, specPath) {
    return [
        ...(spec.performance && spec.nativeProfile !== false
            ? [
                  "--cpu-prof",
                  "--cpu-prof-interval=10000",
                  `--cpu-prof-dir=${spec.runDirectory}`,
                  "--cpu-prof-name=native.cpu.cpuprofile",
              ]
            : []),
        worker,
        "--spec",
        specPath,
    ];
}

async function prepareRunDirectory(spec) {
    const runDirectory = await realpath(spec.runDirectory);
    const owner = JSON.parse(
        await readFile(path.join(runDirectory, "ownership.json"), "utf8"),
    );
    assert.equal(owner.receiptId, spec.receiptId);
    assert.equal(await realpath(owner.runDirectory), runDirectory);
    const admissionPath = path.join(runDirectory, "admitted.json");
    if (spec.resume) {
        const previous = JSON.parse(
            await readFile(path.join(runDirectory, "termination.json"), "utf8"),
        );
        assert.equal(
            previous.workerExited,
            true,
            "Resume only after exact previous worker has exited",
        );
        assert.ok(
            !alive(previous.workerPid),
            "Previous PID still present; do not assume ownership",
        );
        try {
            await rename(
                admissionPath,
                path.join(runDirectory, `admitted-${Date.now()}.json`),
            );
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }
    return runDirectory;
}

function startWorker(spec, worker, specPath, runDirectory) {
    const child = spawn(
        process.execPath,
        workerArguments(spec, worker, specPath),
        {
            stdio: ["ignore", "pipe", "pipe"],
        },
    );
    const execution = { child };
    execution.exited = new Promise((resolve) => {
        child.once("error", (error) => {
            execution.spawnError = error;
            resolve();
        });
        child.once("exit", (code, signal) => {
            execution.exit = { code, signal };
            resolve();
        });
    });
    const stdout = createWriteStream(
        path.join(runDirectory, `stdout-${spec.spawnedEpochMs}.log`),
    );
    const stderr = createWriteStream(
        path.join(runDirectory, `stderr-${spec.spawnedEpochMs}.log`),
    );
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    return { execution, stdout, stderr };
}

async function readAdmission(
    spec,
    runDirectory,
    workerPid,
    observedEpochMs,
    termination,
) {
    let candidate;
    try {
        candidate = JSON.parse(
            await readFile(path.join(runDirectory, "admitted.json"), "utf8"),
        );
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    if (!candidate) return;
    validateAdmission(candidate, spec, workerPid, observedEpochMs);
    termination.phase = "admitted-work";
    termination.workDeadlineEpochMs = candidate.workDeadlineEpochMs;
    await writeJson(path.join(runDirectory, "admission-verified.json"), {
        ...candidate,
        observedEpochMs,
        watchdogPid: process.pid,
    });
    return candidate;
}

export function workerDeadline(spec, admission, startupDeadlineEpochMs) {
    const deadline = admission
        ? (admission.workDeadlineEpochMs ?? Infinity)
        : startupDeadlineEpochMs;
    const total =
        spec.totalAllowanceMs ??
        (spec.sourceScope === "baseline19" ? spec.workAllowanceMs : undefined);
    return total !== undefined
        ? Math.min(deadline, spec.spawnedEpochMs + total)
        : deadline;
}

async function waitForWorker(spec, runDirectory, execution, termination) {
    let admission;
    while (!execution.exit && !execution.spawnError) {
        const now = Date.now();
        if (!admission) {
            admission = await readAdmission(
                spec,
                runDirectory,
                execution.child.pid,
                now,
                termination,
            );
        }
        const deadline = workerDeadline(
            spec,
            admission,
            termination.startupDeadlineEpochMs,
        );
        if (now >= deadline) {
            termination.outcome = admission
                ? "BOUNDED_WORK_INCOMPLETE"
                : "STARTUP_TIMEOUT";
            termination.forced = true;
            execution.child.kill();
            await execution.exited;
            break;
        }
        await delay(50);
    }
}

function classifyExit(exit) {
    if (exit.code === 0) return "WORKER_COMPLETED";
    if (exit.code === 86) return "WORKER_INTERRUPTED";
    return "WORKER_FAILED";
}

async function finishTermination(spec, runDirectory, worker, termination) {
    const { execution, stdout, stderr } = worker;
    if (!execution.exit && !execution.spawnError) await execution.exited;
    termination.workerExited = !!execution.exit;
    termination.finishedEpochMs = Date.now();
    if (spec.performance && spec.nativeProfile !== false) {
        termination.nativeProfile = path.join(
            runDirectory,
            "native.cpu.cpuprofile",
        );
        termination.nativeProfileFlush = termination.forced
            ? "NOT_GUARANTEED_FORCED_EXIT"
            : "Normal Node exit; analyzer must verify artifact/schema";
    }
    if (spec.performance && spec.nativeProfile === false)
        termination.nativeProfile = "DISABLED_SPARSE_NATIVE_OFF";
    await Promise.all([finished(stdout), finished(stderr)]);
    await writeJson(path.join(runDirectory, "termination.json"), termination);
}

export async function supervise(spec, worker, specValidator) {
    specValidator(spec);
    const runDirectory = await prepareRunDirectory(spec);
    spec = { ...spec, spawnedEpochMs: Date.now() };
    const specPath = path.join(
        runDirectory,
        `spec-${spec.spawnedEpochMs}.json`,
    );
    await writeJson(specPath, spec);
    const ownedWorker = startWorker(spec, worker, specPath, runDirectory);
    const { execution } = ownedWorker;
    const termination = {
        receiptId: spec.receiptId,
        watchdogPid: process.pid,
        workerPid: execution.child.pid,
        runDirectory,
        startupDeadlineEpochMs: spec.spawnedEpochMs + spec.startupAllowanceMs,
        startedEpochMs: spec.spawnedEpochMs,
        phase: "startup",
        forced: false,
        scope: "External harness allowance, never corpus capacity or product scheduler limit",
    };
    try {
        await waitForWorker(spec, runDirectory, execution, termination);
        if (execution.spawnError) throw execution.spawnError;
        termination.exit = execution.exit;
        termination.outcome ??= classifyExit(execution.exit);
    } catch (error) {
        termination.outcome = "WATCHDOG_REJECTED";
        termination.error = { name: error.name, message: error.message };
        if (!execution.exit && execution.child.pid) {
            termination.forced = true;
            execution.child.kill();
            await execution.exited;
        }
    } finally {
        await finishTermination(spec, runDirectory, ownedWorker, termination);
    }
    return termination;
}
