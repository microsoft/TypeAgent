// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, statfs } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { writeJson } from "../shared/checkpoint.mjs";
import { withLiveRunLock } from "../shared/resume.mjs";
import { alive } from "../shared/supervisor.mjs";
import { digest } from "./runner.mjs";

const minimumInvocationMs = 8 * 60000;

export function createCampaignStateWriter(file, state) {
    let pending = Promise.resolve();
    return () => {
        const snapshot = structuredClone(state);
        pending = pending.then(() => writeJson(file, snapshot));
        return pending;
    };
}

export function campaignDecision(
    benchmark,
    remainingMs,
    freeBytes,
    minimumFreeBytes,
) {
    if (benchmark?.outcome === "FULL_500_COMPLETED_CONFIGURED_JUDGE_PROTOCOL")
        return "COMPLETE";
    if (
        benchmark &&
        !["PARTIAL_BOUNDED_WORK", "PARTIAL_QUESTION_LIMIT"].includes(
            benchmark.outcome,
        )
    )
        return "STOP_FAILURE";
    if (benchmark && benchmark.attempts.at(-1)?.supportedClose !== "COMPLETE")
        return "STOP_UNCLEAN_CLOSE";
    if (remainingMs < minimumInvocationMs) return "PARTIAL_ALLOWANCE";
    if (freeBytes < minimumFreeBytes) return "PARTIAL_DISK_RESERVE";
    return "CONTINUE";
}

export function invocationArguments(args, runDirectory, remainingMs) {
    assert.ok(
        args.includes("--authorized-live-benchmark"),
        "Explicit live authorization required",
    );
    assert.ok(
        !args.some((arg) => /^--(?:spec|work-minutes|resume)(?:=|$)/.test(arg)),
        "Controller owns work-minutes and resume; direct worker specs are forbidden",
    );
    const workMinutes = Math.min(30, Math.floor(remainingMs / 60000) - 7);
    assert.ok(
        workMinutes >= 1,
        "Insufficient remaining allowance for work and cleanup",
    );
    return [
        ...args,
        "--work-minutes",
        String(workMinutes),
        ...(runDirectory ? ["--resume", runDirectory] : []),
    ];
}

async function invoke(args, state, persist) {
    const child = spawn(
        process.execPath,
        [path.join(import.meta.dirname, "live.mjs"), ...args],
        {
            cwd: process.cwd(),
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
        },
    );
    state.activeInvocation = {
        pid: child.pid,
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        ordinal: state.invocations.length,
    };
    let output = "";
    let lineBuffer = "";
    let progressWrites = Promise.resolve();
    child.stdout.on("data", (chunk) => {
        output = (output + chunk).slice(-65536);
        lineBuffer += chunk;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop();
        for (const line of lines) {
            if (!line.startsWith('{"kind":"run-directory",')) continue;
            const announced = JSON.parse(line);
            assert.ok(path.isAbsolute(announced.runDirectory));
            if (state.runDirectory)
                assert.equal(announced.runDirectory, state.runDirectory);
            state.runDirectory = announced.runDirectory;
            progressWrites = progressWrites.then(persist);
        }
        process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    const heartbeat = setInterval(() => {
        state.activeInvocation.lastHeartbeatAt = Date.now();
        progressWrites = progressWrites.then(persist);
        process.stdout.write(
            JSON.stringify({
                campaign: "RUNNING",
                supervisorPid: child.pid,
                invocation: state.activeInvocation.ordinal,
                lastHeartbeatAt: state.activeInvocation.lastHeartbeatAt,
                remainingMs: Math.max(0, state.deadlineEpochMs - Date.now()),
            }) + "\n",
        );
    }, 30000);
    heartbeat.unref();
    let exit;
    const completed = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
    });
    try {
        await persist();
        exit = await completed;
        await progressWrites;
    } finally {
        clearInterval(heartbeat);
    }
    const result = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.ok(
        path.isAbsolute(result.runDirectory),
        "Supervisor omitted run directory",
    );
    state.runDirectory = result.runDirectory;
    const termination = JSON.parse(
        await readFile(
            path.join(state.runDirectory, "termination.json"),
            "utf8",
        ),
    );
    assert.equal(termination.workerExited, true);
    assert.equal(alive(termination.workerPid), false);
    assert.equal(alive(termination.watchdogPid), false);
    const benchmark = JSON.parse(
        await readFile(
            path.join(state.runDirectory, "benchmark-state.json"),
            "utf8",
        ),
    );
    const progress = Object.values(benchmark.cases).reduce(
        (total, entry) =>
            total +
            entry.operations.length +
            (entry.status === "complete" ? 1 : 0),
        0,
    );
    state.invocations.push({
        ...state.activeInvocation,
        finishedAt: Date.now(),
        exit,
        outcome: benchmark.outcome,
        progress,
        termination,
    });
    delete state.activeInvocation;
    state.progress = progress;
    await persist();
    return benchmark;
}

export async function main(args = process.argv.slice(2)) {
    const separator = args.indexOf("--");
    assert.ok(
        separator >= 0,
        "Pass normal authorized runner arguments after --",
    );
    const { values } = parseArgs({
        args: args.slice(0, separator),
        options: {
            output: { type: "string" },
            "allowance-minutes": { type: "string" },
            "minimum-free-gib": { type: "string", default: "2" },
            "resume-controller": { type: "boolean" },
        },
    });
    const allowanceMs = Number(values["allowance-minutes"]) * 60000;
    assert.ok(
        Number.isSafeInteger(allowanceMs) && allowanceMs >= minimumInvocationMs,
        "An explicit overall allowance of at least eight minutes is required",
    );
    const minimumFreeBytes = Number(values["minimum-free-gib"]) * 1024 ** 3;
    assert.ok(
        Number.isSafeInteger(minimumFreeBytes) && minimumFreeBytes > 0,
        "Disk reserve must be positive",
    );
    assert.ok(
        values.output && path.isAbsolute(values.output),
        "Absolute controller output required",
    );
    const runnerArgs = args.slice(separator + 1);
    invocationArguments(runnerArgs, undefined, allowanceMs);
    const identity = digest(
        JSON.stringify({
            runnerArgs,
            allowanceMs,
            minimumFreeBytes,
            controller: digest(await readFile(new URL(import.meta.url))),
        }),
    );
    if (!values["resume-controller"]) await mkdir(values.output);
    const statePath = path.join(values.output, "campaign.json");
    await withLiveRunLock(values.output, async () => {
        const state = values["resume-controller"]
            ? JSON.parse(await readFile(statePath, "utf8"))
            : {
                  schemaVersion: 1,
                  identity,
                  startedAt: Date.now(),
                  deadlineEpochMs: Date.now() + allowanceMs,
                  invocations: [],
                  progress: 0,
              };
        assert.equal(
            state.identity,
            identity,
            "Controller identity or authorization allowance changed",
        );
        if (state.activeInvocation) {
            assert.equal(
                alive(state.activeInvocation.pid),
                false,
                "Owned supervisor is still present; do not start another",
            );
            assert.ok(
                state.runDirectory,
                "Controller interrupted before owned run identity was persisted; explicit recovery required",
            );
            const termination = JSON.parse(
                await readFile(
                    path.join(state.runDirectory, "termination.json"),
                    "utf8",
                ),
            );
            assert.equal(
                termination.workerExited,
                true,
                "Interrupted controller has no clean worker-exit receipt",
            );
            assert.equal(alive(termination.workerPid), false);
            assert.equal(alive(termination.watchdogPid), false);
            state.invocations.push({
                ...state.activeInvocation,
                recoveredAt: Date.now(),
                termination,
            });
            delete state.activeInvocation;
        }
        const persist = createCampaignStateWriter(statePath, state);
        await persist();
        let benchmark = state.runDirectory
            ? JSON.parse(
                  await readFile(
                      path.join(state.runDirectory, "benchmark-state.json"),
                      "utf8",
                  ),
              )
            : undefined;
        for (;;) {
            const disk = await statfs(values.output);
            state.outcome = campaignDecision(
                benchmark,
                state.deadlineEpochMs - Date.now(),
                disk.bavail * disk.bsize,
                minimumFreeBytes,
            );
            await persist();
            if (state.outcome !== "CONTINUE") break;
            const previousProgress = state.progress;
            benchmark = await invoke(
                invocationArguments(
                    runnerArgs,
                    state.runDirectory,
                    state.deadlineEpochMs - Date.now(),
                ),
                state,
                persist,
            );
            if (
                state.progress === previousProgress &&
                benchmark.outcome === "PARTIAL_BOUNDED_WORK"
            ) {
                state.outcome = "STOP_NO_COMMITTED_PROGRESS";
                await persist();
                break;
            }
        }
        process.stdout.write(
            JSON.stringify({
                controllerDirectory: values.output,
                runDirectory: state.runDirectory,
                outcome: state.outcome,
                invocations: state.invocations.length,
            }) + "\n",
        );
        process.exitCode = state.outcome.startsWith("STOP_") ? 1 : 0;
    });
}

if (
    process.argv[1] &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
