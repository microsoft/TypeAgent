// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { ciStepStage } from "./ciProfile.mjs";

function instant(value) {
    const time = Date.parse(value);
    assert.ok(Number.isFinite(time), `Invalid CI timestamp: ${value}`);
    return time;
}

function seconds(start, end) {
    const duration = (instant(end) - instant(start)) / 1000;
    assert.ok(duration >= 0, "CI timestamps are reversed");
    return duration;
}

export function durationDistribution(values) {
    if (values.length === 0) return { count: 0, p50: null, p95: null };
    assert.ok(values.every((value) => Number.isFinite(value) && value >= 0));
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return {
        count: sorted.length,
        p50:
            sorted.length % 2
                ? sorted[middle]
                : (sorted[middle - 1] + sorted[middle]) / 2,
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    };
}

export function ciRunTiming(run, jobs, checks, requiredNames) {
    assert.ok(requiredNames.length > 0, "No required checks were identified");
    const required = [...new Set(requiredNames)].map((name) => {
        const check = checks
            .filter((check) => check.name === name)
            .sort((a, b) => {
                if (
                    a.kind === b.kind &&
                    Number.isSafeInteger(a.id) &&
                    Number.isSafeInteger(b.id)
                )
                    return b.id - a.id;
                const observed = (check) =>
                    check.created_at ?? check.started_at;
                return instant(observed(b)) - instant(observed(a));
            })[0];
        return {
            name,
            status: check?.status ?? "missing",
            conclusion: check?.conclusion ?? null,
            startedAt: check?.started_at ?? null,
            completedAt: check?.completed_at ?? null,
            url: check?.html_url ?? null,
        };
    });
    const completeJobs = jobs.filter(
        (job) =>
            job.status === "completed" &&
            job.conclusion !== "skipped" &&
            job.started_at &&
            job.completed_at,
    );
    const attemptJobs = completeJobs.filter(
        (job) => job.run_attempt === run.run_attempt,
    );
    const lastJob = attemptJobs.toSorted(
        (a, b) => instant(b.completed_at) - instant(a.completed_at),
    )[0];
    const requiredComplete = required.every(
        (check) => check.status === "completed" && check.completedAt,
    );
    const earliest = Math.min(
        instant(run.created_at),
        ...required
            .filter((check) => check.startedAt)
            .map((check) => instant(check.startedAt)),
    );
    const latest = requiredComplete
        ? Math.max(...required.map((check) => instant(check.completedAt)))
        : null;
    return {
        id: run.id,
        sha: run.head_sha,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        attempts: run.run_attempt,
        url: run.html_url,
        attemptWallSeconds:
            run.status === "completed" && lastJob
                ? seconds(run.run_started_at, lastJob.completed_at)
                : null,
        elapsedSinceFirstAttemptSeconds:
            run.status === "completed" && lastJob
                ? seconds(run.created_at, lastJob.completed_at)
                : null,
        runnerSecondsAcrossAttempts: completeJobs.reduce(
            (total, job) => total + seconds(job.started_at, job.completed_at),
            0,
        ),
        allRequiredChecksSeconds:
            latest === null ? null : (latest - earliest) / 1000,
        requiredChecksPassed:
            requiredComplete &&
            required.every((check) => check.conclusion === "success"),
        requiredChecks: required,
        jobs: jobs.map((job) => ({
            name: job.name,
            attempt: job.run_attempt,
            status: job.status,
            conclusion: job.conclusion,
            startedAt: job.started_at,
            completedAt: job.completed_at,
            steps: job.steps.map((step) => ({
                name: step.name,
                stage: ciStepStage(step.name),
                conclusion: step.conclusion,
                seconds:
                    step.status === "completed" &&
                    step.conclusion !== "skipped" &&
                    step.started_at &&
                    step.completed_at
                        ? seconds(step.started_at, step.completed_at)
                        : null,
            })),
        })),
    };
}

export function ciTimingSummary(runs) {
    const successful = runs.filter(
        (run) => run.status === "completed" && run.conclusion === "success",
    );
    const requiredPassed = runs.filter((run) => run.requiredChecksPassed);
    return {
        outcomes: runs.reduce((counts, run) => {
            const outcome = run.conclusion ?? run.status;
            counts[outcome] = (counts[outcome] ?? 0) + 1;
            return counts;
        }, {}),
        successfulAttemptWallSeconds: durationDistribution(
            successful
                .map((run) => run.attemptWallSeconds)
                .filter((value) => value !== null),
        ),
        successfulRequiredChecksSeconds: durationDistribution(
            requiredPassed
                .map((run) => run.allRequiredChecksSeconds)
                .filter((value) => value !== null),
        ),
    };
}
