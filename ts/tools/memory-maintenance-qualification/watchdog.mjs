// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, realpath, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { finished } from "node:stream/promises";
import {
    checkpointExpectationHash,
    validateSpec,
    writeJson,
} from "./harness.mjs";

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
    assert.ok(
        Number.isSafeInteger(ack.admittedEpochMs) &&
            Number.isSafeInteger(ack.workDeadlineEpochMs),
    );
    assert.ok(ack.admittedEpochMs <= observedEpochMs + 1000);
    assert.ok(ack.workDeadlineEpochMs > observedEpochMs);
    assert.equal(
        ack.workDeadlineEpochMs - ack.admittedEpochMs,
        spec.workAllowanceMs,
    );
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
        const deadline =
            admission?.workDeadlineEpochMs ??
            termination.startupDeadlineEpochMs;
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

export async function supervise(
    spec,
    worker = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "harness.mjs",
    ),
    specValidator = validateSpec,
) {
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

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    const { values } = parseArgs({
        options: {
            product: { type: "string" },
            fixtures: { type: "string" },
            output: { type: "string" },
            resume: { type: "string" },
            startup: { type: "string", default: "120000" },
            work: { type: "string", default: "1200000" },
            help: { type: "boolean" },
            "crash-stage": { type: "string" },
            p6: { type: "boolean" },
            performance: { type: "boolean" },
            qualification: { type: "boolean" },
            checkpoint: { type: "string" },
            "no-native-profile": { type: "boolean" },
            "stop-initial-failure": { type: "boolean" },
        },
    });
    if (values.help) {
        process.stdout.write(
            "OFFLINE only: --product <ts root> --fixtures <read-only memoryDemo> [--output <existing artifacts parent>] [--startup <ms>] [--work <ms>] [--p6] [--crash-stage t1]. Performance requires --performance --checkpoint <explicit name/hashes JSON>; optional --no-native-profile --stop-initial-failure. Full stages/mechanisms: --qualification --checkpoint <same explicit JSON> --no-native-profile, first unexpected terminal failure stops with normal cleanup. P6 crash is post-canonical/pre-redirect/index/ack. Resume: --resume <owned run directory> with unchanged --p6/--qualification/checkpoint. No model-role flags or implicit user stores.\n",
        );
    } else {
        assert.ok(
            values.product && values.fixtures,
            "--product and --fixtures required",
        );
        let runDirectory;
        let receiptId;
        if (values.resume) {
            runDirectory = await realpath(values.resume);
            const owner = JSON.parse(
                await readFile(
                    path.join(runDirectory, "ownership.json"),
                    "utf8",
                ),
            );
            receiptId = owner.receiptId;
        } else {
            runDirectory = await mkdtemp(
                path.join(
                    await realpath(values.output ?? os.tmpdir()),
                    "memory-maintenance-qualification-",
                ),
            );
            receiptId = randomUUID();
            await writeJson(path.join(runDirectory, "ownership.json"), {
                receiptId,
                runDirectory,
            });
        }
        const spec = {
            receiptId,
            mode: "offline",
            runDirectory,
            resume: !!values.resume,
            p6: !!values.p6 || !!values.performance || !!values.qualification,
            performance: !!values.performance,
            qualification: !!values.qualification,
            nativeProfile: !values["no-native-profile"],
            stopInitialFailure: !!values["stop-initial-failure"],
            ...(values.checkpoint
                ? {
                      expectedCheckpoint: JSON.parse(
                          await readFile(
                              await realpath(values.checkpoint),
                              "utf8",
                          ),
                      ),
                  }
                : {}),
            productRoot: await realpath(values.product),
            fixtureRoot: await realpath(values.fixtures),
            startupAllowanceMs: Number(values.startup),
            workAllowanceMs: Number(values.work),
            ...(values["crash-stage"]
                ? { crashStage: values["crash-stage"] }
                : {}),
        };
        const receipt = await supervise(spec);
        process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
        if (receipt.outcome !== "WORKER_COMPLETED") process.exitCode = 1;
    }
}
