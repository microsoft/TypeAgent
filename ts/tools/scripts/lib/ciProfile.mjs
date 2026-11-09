// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import path from "node:path";

export const profileMarker = "TYPEAGENT_CI_PROFILE ";

export function stageMeasurement(stage, elapsedMs, outcome, env = process.env) {
    assert.match(stage, /^[a-z][a-z0-9-]*$/);
    assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0);
    assert.ok(["success", "failure"].includes(outcome));
    const sha = env.GITHUB_SHA ?? env.BUILD_SOURCEVERSION;
    assert.match(
        sha ?? "",
        /^[a-f0-9]{40}$/,
        "Profiling requires an exact source SHA",
    );
    const nativeCache = env.TYPEAGENT_NATIVE_CACHE;
    const hit = env.TYPEAGENT_NATIVE_CACHE_HIT;
    const attempt = env.TYPEAGENT_INSTALL_ATTEMPT
        ? Number(env.TYPEAGENT_INSTALL_ATTEMPT)
        : null;
    assert.ok(
        attempt === null || (Number.isSafeInteger(attempt) && attempt > 0),
    );
    return {
        schemaVersion: 1,
        stage,
        elapsedMs,
        outcome,
        sha,
        job: env.GITHUB_JOB ?? env.SYSTEM_JOBNAME ?? null,
        entrypoint: process.argv[1] ? path.basename(process.argv[1]) : null,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        abi: process.versions.modules,
        image: env.ImageOS ?? env.IMAGEOS ?? null,
        imageVersion: env.ImageVersion ?? env.IMAGEVERSION ?? null,
        installAttempt: attempt,
        forcedReimport: attempt === null ? null : attempt > 1,
        nativeCacheState:
            nativeCache === "false"
                ? "disabled"
                : nativeCache !== "true" || !["true", "false"].includes(hit)
                  ? "unknown"
                  : hit === "true"
                    ? "exact-hit"
                    : "miss-or-partial",
    };
}

export function profileSyncStage(stage, operation) {
    if (process.env.TYPEAGENT_CI_PROFILE !== "true") return operation();
    const observation = stageMeasurement(stage, 0, "failure");
    const started = performance.now();
    try {
        const result = operation();
        observation.outcome = "success";
        return result;
    } finally {
        observation.elapsedMs = performance.now() - started;
        process.stdout.write(
            `${profileMarker}${JSON.stringify(observation)}\n`,
        );
    }
}

const stages = [
    [
        "post-job-cache",
        /^Post(?: |-job:).*(?:fanout-setup|cache|setup-node|pnpm)/i,
    ],
    ["post-job", /^Post(?: |-job:)/i],
    ["cleanup", /Clean up Keys/i],
    ["checkout", /checkout|Get sources/i],
    ["authentication", /authenticat|Azure login|Get Keys/i],
    ["cli-smoke", /Test CLI/i],
    ["shell-test", /Shell Tests/i],
    ["live-test", /Live Tests/i],
    ["artifact-upload", /upload-artifact/i],
    ["artifact-download", /download-artifact/i],
    ["artifact-preparation", /Fingerprint|Discover tests|Seal build/i],
    ["build-cache", /cached outputs|build cache identity|actions\/cache/i],
    ["dependency-install", /Install dependencies|Install native dependencies/i],
    ["browser-setup", /Install Playwright Browsers/i],
    ["build", /^Build(?: |$)/i],
    ["tool-setup", /setup-node|Setup Node|Install.*pnpm/i],
    ["native-setup", /libsecret|Linux prerequisites/i],
    ["setup", /fanout-setup/i],
    ["test", /test|qualify|coverage/i],
];

export function ciStepStage(name) {
    return stages.find(([, pattern]) => pattern.test(name))?.[0] ?? "other";
}

function elapsedSeconds(start, end) {
    const first = Date.parse(start);
    const last = Date.parse(end);
    assert.ok(
        Number.isFinite(first) && Number.isFinite(last),
        "Invalid stage timestamps",
    );
    assert.ok(last >= first, "Reversed stage timestamps");
    return (last - first) / 1000;
}

export function azureTimelineTiming(build, timeline) {
    assert.match(build.sourceVersion ?? "", /^[a-f0-9]{40}$/);
    assert.ok(Number.isSafeInteger(build.id) && build.id > 0);
    assert.ok(Array.isArray(timeline.records));
    const records = new Map(
        timeline.records.map((record) => {
            assert.ok(
                typeof record.id === "string" && record.id.length > 0,
                "Missing Azure record ID",
            );
            return [record.id, record];
        }),
    );
    assert.equal(
        records.size,
        timeline.records.length,
        "Duplicate Azure timeline records",
    );
    return {
        id: build.id,
        sha: build.sourceVersion,
        branch: build.sourceBranch,
        status: build.status,
        result: build.result ?? null,
        url: build._links?.web?.href ?? null,
        wallSeconds:
            build.status === "completed" && build.startTime && build.finishTime
                ? elapsedSeconds(build.startTime, build.finishTime)
                : null,
        tasks: timeline.records
            .filter((record) => record.type === "Task")
            .map((record) => ({
                id: record.id,
                job: records.get(record.parentId)?.name ?? null,
                attempt: record.attempt ?? null,
                name: record.name,
                stage: ciStepStage(record.name),
                state: record.state,
                result: record.result ?? null,
                seconds:
                    record.state === "completed" &&
                    record.result !== "skipped" &&
                    record.startTime &&
                    record.finishTime
                        ? elapsedSeconds(record.startTime, record.finishTime)
                        : null,
            })),
    };
}

export function profileLog(text) {
    const observations = [];
    const buildTasks = [];
    for (const line of text.split(/\r?\n/)) {
        const job = line.includes("\t") ? line.split("\t")[0] : null;
        const marker = line.indexOf(profileMarker);
        if (marker !== -1) {
            const value = JSON.parse(line.slice(marker + profileMarker.length));
            assert.equal(value.schemaVersion, 1, "Unknown profile schema");
            assert.match(value.sha ?? "", /^[a-f0-9]{40}$/);
            assert.match(value.stage ?? "", /^[a-z][a-z0-9-]*$/);
            assert.ok(Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0);
            assert.ok(["success", "failure"].includes(value.outcome));
            observations.push({ ...value, logJob: job });
        }
        const task = line.match(
            /\[\s*\d+\/\d+\]\s+(\S+)\s+([^:]+): (.+) - (\d+(?:\.\d+)?)s(?: \(non-incremental\))?/,
        );
        if (task) {
            buildTasks.push({
                job,
                resultMarker: task[1],
                package: task[2],
                command: task[3],
                seconds: Number(task[4]),
                nonIncremental: task[0].endsWith("(non-incremental)"),
            });
        }
    }
    return { observations, buildTasks };
}
