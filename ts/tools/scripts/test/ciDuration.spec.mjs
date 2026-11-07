// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    ciRunTiming,
    ciTimingSummary,
    durationDistribution,
} from "../lib/ciDuration.mjs";

const time = (minutes) =>
    new Date(Date.UTC(2026, 10, 5, 0, minutes)).toISOString();
const run = {
    id: 1,
    head_sha: "a".repeat(40),
    created_at: time(0),
    run_started_at: time(30),
    run_attempt: 2,
    status: "completed",
    conclusion: "success",
};
const job = (attempt, start, end) => ({
    name: `job-${attempt}`,
    run_attempt: attempt,
    status: "completed",
    conclusion: "success",
    started_at: time(start),
    completed_at: time(end),
    steps: [
        {
            name: "Test",
            status: "completed",
            conclusion: "success",
            started_at: time(start),
            completed_at: time(end),
        },
    ],
});
const check = (name, start, end) => ({
    name,
    status: "completed",
    conclusion: "success",
    created_at: time(start),
    started_at: time(start),
    completed_at: time(end),
});

test("duration distributions use an even-sample median and nearest-rank p95", () => {
    assert.deepEqual(durationDistribution([4, 1, 3, 2]), {
        count: 4,
        p50: 2.5,
        p95: 4,
    });
    assert.deepEqual(durationDistribution([]), {
        count: 0,
        p50: null,
        p95: null,
    });
    assert.throws(() => durationDistribution([NaN]));
    assert.throws(() => durationDistribution([-1]));
});

test("attempt latency, elapsed retry time, runner cost and all-check latency stay separate", () => {
    const report = ciRunTiming(
        run,
        [job(1, 1, 20), job(2, 31, 40)],
        [check("build", 1, 40), check("smoke", 0, 60)],
        ["build", "smoke"],
    );
    assert.equal(report.attemptWallSeconds, 600);
    assert.equal(report.elapsedSinceFirstAttemptSeconds, 2400);
    assert.equal(report.runnerSecondsAcrossAttempts, 28 * 60);
    assert.equal(report.allRequiredChecksSeconds, 3600);
    assert.equal(report.requiredChecksPassed, true);
    assert.equal(report.jobs[1].steps[0].seconds, 540);
});

test("missing and running checks cannot produce a complete or successful gate", () => {
    const running = {
        ...check("build", 1, 40),
        status: "in_progress",
        conclusion: null,
        completed_at: null,
    };
    const report = ciRunTiming(run, [], [running], ["build", "smoke"]);
    assert.equal(report.allRequiredChecksSeconds, null);
    assert.equal(report.requiredChecksPassed, false);
    assert.equal(report.requiredChecks[1].status, "missing");
    assert.equal(report.attemptWallSeconds, null);
    assert.throws(() => ciRunTiming(run, [], [], []), /No required checks/);
});

test("the newest retry result supersedes earlier check results", () => {
    const report = ciRunTiming(
        run,
        [],
        [
            check("build", 1, 20),
            { ...check("build", 30, 40), conclusion: "failure" },
        ],
        ["build"],
    );
    assert.equal(report.requiredChecksPassed, false);
    assert.equal(report.requiredChecks[0].conclusion, "failure");
});

test("a newly queued check without timestamps supersedes an older successful check", () => {
    const report = ciRunTiming(
        run,
        [],
        [
            { ...check("build", 1, 20), id: 1, kind: "check" },
            {
                name: "build",
                id: 2,
                kind: "check",
                status: "queued",
                started_at: null,
                completed_at: null,
                conclusion: null,
            },
        ],
        ["build"],
    );
    assert.equal(report.allRequiredChecksSeconds, null);
    assert.equal(report.requiredChecksPassed, false);
    assert.equal(report.requiredChecks[0].status, "queued");
});

test("failed, cancelled and unfinished runs remain visible, never counted as successes", () => {
    const reports = ["success", "failure", "cancelled", null].map(
        (conclusion) => ({
            conclusion,
            status: conclusion ? "completed" : "in_progress",
            requiredChecksPassed: conclusion === "success",
            attemptWallSeconds: conclusion ? 600 : null,
            allRequiredChecksSeconds: conclusion ? 900 : null,
        }),
    );
    const summary = ciTimingSummary(reports);
    assert.deepEqual(summary.outcomes, {
        success: 1,
        failure: 1,
        cancelled: 1,
        in_progress: 1,
    });
    assert.equal(summary.successfulAttemptWallSeconds.count, 1);
    assert.equal(summary.successfulRequiredChecksSeconds.p95, 900);
});

test("invalid or reversed timestamps are explicit errors", () => {
    assert.throws(
        () => ciRunTiming(run, [job(2, 40, 31)], [], ["build"]),
        /reversed/,
    );
    assert.throws(
        () => ciRunTiming({ ...run, created_at: "invalid" }, [], [], ["build"]),
        /Invalid CI timestamp/,
    );
});
