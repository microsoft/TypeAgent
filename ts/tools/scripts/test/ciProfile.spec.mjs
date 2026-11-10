// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
    azureTimelineTiming,
    ciStepStage,
    profileLog,
    profileMarker,
    stageMeasurement,
} from "../lib/ciProfile.mjs";

const sha = "a".repeat(40);
const script = new URL("../ciProfile.mjs", import.meta.url);
const env = { ...process.env, GITHUB_SHA: sha, TYPEAGENT_INSTALL_ATTEMPT: "" };

function command(args, options = {}) {
    return spawnSync(process.execPath, [fileURLToPath(script), ...args], {
        encoding: "utf8",
        env,
        ...options,
    });
}

test("profile metadata whitelists environment fields and distinguishes native restore states", () => {
    const source = { GITHUB_SHA: sha, PRIVATE_TOKEN: "do-not-export" };
    const observation = stageMeasurement(
        "artifact-verification",
        1.5,
        "failure",
        source,
    );
    assert.equal(observation.sha, sha);
    assert.equal(observation.nativeCacheState, "unknown");
    assert.equal(observation.installAttempt, null);
    assert.equal(observation.forcedReimport, null);
    assert.equal(observation.node, process.version);
    assert.equal(observation.abi, process.versions.modules);
    assert.doesNotMatch(
        JSON.stringify(observation),
        /PRIVATE_TOKEN|do-not-export/,
    );
    for (const [enabled, hit, expected] of [
        ["false", "true", "disabled"],
        ["true", undefined, "unknown"],
        ["true", "true", "exact-hit"],
        ["true", "false", "miss-or-partial"],
    ]) {
        assert.equal(
            stageMeasurement("install", 0, "success", {
                ...source,
                TYPEAGENT_NATIVE_CACHE: enabled,
                TYPEAGENT_NATIVE_CACHE_HIT: hit,
            }).nativeCacheState,
            expected,
        );
    }
    const retry = stageMeasurement("install", 0, "success", {
        BUILD_SOURCEVERSION: sha,
        TYPEAGENT_INSTALL_ATTEMPT: "2",
    });
    assert.equal(retry.installAttempt, 2);
    assert.equal(retry.forcedReimport, true);
});

test("invalid stage observations fail explicitly instead of producing plausible measurements", () => {
    assert.throws(
        () => stageMeasurement("build", 1, "success", {}),
        /exact source SHA/,
    );
    assert.throws(() =>
        stageMeasurement("bad stage", 1, "success", { GITHUB_SHA: sha }),
    );
    assert.throws(() =>
        stageMeasurement("build", -1, "success", { GITHUB_SHA: sha }),
    );
    assert.throws(() =>
        stageMeasurement("build", Infinity, "success", { GITHUB_SHA: sha }),
    );
    assert.throws(() =>
        stageMeasurement("build", 1, "skipped", { GITHUB_SHA: sha }),
    );
    assert.throws(() =>
        stageMeasurement("build", 1, "success", {
            GITHUB_SHA: sha,
            TYPEAGENT_INSTALL_ATTEMPT: "0",
        }),
    );
});

test("log parsing retains job identity, failed observations and overlapping fluid tasks", () => {
    const observation = stageMeasurement("build", 125, "failure", {
        GITHUB_SHA: sha,
    });
    const result = profileLog(
        [
            `Windows Node 24\tBuild\t2026-11-09T00:00:00Z ${profileMarker}${JSON.stringify(observation)}`,
            "Windows Node 24\tBuild\t[1/2] v agent-cli: tsc -b - 3.125s (non-incremental)",
            "Windows Node 24\tBuild\t[2/2] v agent-shell: tsc -b - 2.0s",
        ].join("\n"),
    );
    assert.equal(result.observations[0].logJob, "Windows Node 24");
    assert.equal(result.observations[0].outcome, "failure");
    assert.equal(result.buildTasks.length, 2);
    assert.equal(result.buildTasks[0].seconds, 3.125);
    assert.equal(result.buildTasks[0].nonIncremental, true);
    assert.equal(result.buildTasks[1].nonIncremental, false);
    assert.equal(result.criticalPathSeconds, undefined);
    assert.throws(() => profileLog(`${profileMarker}{broken`));
    assert.throws(() =>
        profileLog(
            `${profileMarker}${JSON.stringify({ ...observation, schemaVersion: 2 })}`,
        ),
    );
    assert.throws(() =>
        profileLog(
            `${profileMarker}${JSON.stringify({ ...observation, sha: "short" })}`,
        ),
    );
});

const build = {
    id: 1,
    sourceVersion: sha,
    sourceBranch: "refs/heads/candidate",
    status: "completed",
    result: "failed",
    startTime: "2026-11-09T00:00:00Z",
    finishTime: "2026-11-09T00:01:00Z",
};
const task = {
    id: "task",
    type: "Task",
    parentId: "job",
    attempt: 2,
    name: "Build",
    state: "completed",
    result: "failed",
    startTime: build.startTime,
    finishTime: build.finishTime,
};

test("Azure wall time is independent of parallel task sums and retains failed attempts", () => {
    const result = azureTimelineTiming(build, {
        records: [
            { id: "job", type: "Job", name: "Linux smoke" },
            task,
            { ...task, id: "parallel", parentId: "windows" },
            { id: "windows", type: "Job", name: "Windows smoke" },
        ],
    });
    assert.equal(result.wallSeconds, 60);
    assert.deepEqual(
        result.tasks.map((item) => item.seconds),
        [60, 60],
    );
    assert.deepEqual(
        result.tasks.map((item) => item.job),
        ["Linux smoke", "Windows smoke"],
    );
    assert.equal(result.tasks[0].stage, "build");
    assert.equal(result.tasks[0].attempt, 2);
    assert.equal(result.tasks[0].result, "failed");
});

test("Azure incomplete and skipped work never receives a fabricated duration", () => {
    for (const record of [
        { ...task, state: "inProgress" },
        { ...task, result: "skipped" },
        { ...task, finishTime: null },
    ]) {
        assert.equal(
            azureTimelineTiming(
                { ...build, status: "inProgress" },
                { records: [record] },
            ).tasks[0].seconds,
            null,
        );
    }
    assert.equal(
        azureTimelineTiming({ ...build, status: "inProgress" }, { records: [] })
            .wallSeconds,
        null,
    );
    assert.equal(
        azureTimelineTiming(build, {
            records: [{ ...task, result: "canceled" }],
        }).tasks[0].seconds,
        60,
    );
});

test("malformed Azure timelines and timestamps fail explicitly", () => {
    assert.throws(
        () => azureTimelineTiming(build, { records: [task, task] }),
        /Duplicate/,
    );
    assert.throws(
        () => azureTimelineTiming(build, { records: [{ ...task, id: "" }] }),
        /record ID/,
    );
    assert.throws(() =>
        azureTimelineTiming(
            { ...build, sourceVersion: "short" },
            { records: [] },
        ),
    );
    assert.throws(
        () =>
            azureTimelineTiming(
                {
                    ...build,
                    finishTime: build.startTime,
                    startTime: build.finishTime,
                },
                { records: [] },
            ),
        /Reversed/,
    );
    assert.throws(
        () =>
            azureTimelineTiming(build, {
                records: [{ ...task, startTime: "invalid" }],
            }),
        /Invalid/,
    );
});

test("stage classification keeps authentication, tests, transfers and teardown separate", () => {
    for (const [name, expected] of [
        ["Azure login + Get Keys", "authentication"],
        ["Shell Tests - full (Windows)", "shell-test"],
        ["Test CLI - smoke", "cli-smoke"],
        ["Post Run ./.github/actions/fanout-setup", "post-job-cache"],
        ["Post-job: Checkout TypeAgent Repository", "post-job"],
        ["Install dependencies", "dependency-install"],
        ["Install Playwright Browsers (Linux)", "browser-setup"],
        ["Run actions/upload-artifact@v4", "artifact-upload"],
        ["Run actions/download-artifact@v4", "artifact-download"],
        ["Clean up Keys", "cleanup"],
        ["Build workspace", "build"],
        ["Unknown observation", "other"],
    ]) {
        assert.equal(ciStepStage(name), expected, name);
    }
});

test("record CLI retains failure exit codes and rejects malformed inputs", () => {
    const result = command(["record", "build", "12.5", "17"]);
    assert.equal(result.status, 0, result.stderr);
    const observation = profileLog(result.stdout).observations[0];
    assert.equal(observation.outcome, "failure");
    assert.equal(observation.exitCode, 17);
    for (const args of [
        ["record", "build", "-1", "0"],
        ["record", "build", "NaN", "0"],
        ["record", "build", "1", "1e9"],
        ["record", "build", "1", "999999999999999999999"],
        ["report"],
        ["report", "--azure-build", "missing.json"],
    ]) {
        const invalid = command(args);
        assert.notEqual(invalid.status, 0);
        assert.equal(invalid.stdout, "");
        assert.ok(invalid.stderr.length > 0);
    }
});

test("offline report combines real input shapes without claiming a speedup or DAG critical path", () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "typeagent-ci-profile-"),
    );
    try {
        const log = path.join(directory, "run.log");
        const details = path.join(directory, "build.json");
        const timeline = path.join(directory, "timeline.json");
        fs.writeFileSync(
            log,
            `${profileMarker}${JSON.stringify(stageMeasurement("build", 12, "success", { GITHUB_SHA: sha }))}\n`,
        );
        fs.writeFileSync(details, JSON.stringify(build));
        fs.writeFileSync(timeline, JSON.stringify({ records: [task] }));
        const result = command([
            "report",
            "--log",
            log,
            "--azure-build",
            details,
            "--azure-timeline",
            timeline,
        ]);
        assert.equal(result.status, 0, result.stderr);
        const report = JSON.parse(result.stdout);
        assert.equal(report.azure.wallSeconds, 60);
        assert.equal(report.profile.observations.length, 1);
        assert.match(
            report.limitations.join(" "),
            /not a dependency-graph critical path/,
        );
        assert.match(
            report.limitations.join(" "),
            /not a statistically established speedup/,
        );
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("fan-out omits timing instrumentation and preserves retry and native-cache policies", () => {
    for (const name of ["ci-fanout-target", "ci-fanout-experiment"]) {
        const workflow = yaml.load(
            fs.readFileSync(
                new URL(
                    `../../../../.github/workflows/${name}.yml`,
                    import.meta.url,
                ),
                "utf8",
            ),
        );
        assert.doesNotMatch(
            JSON.stringify(workflow),
            /TYPEAGENT_CI_PROFILE|TYPEAGENT_NATIVE_CACHE|--timer|--logtime/,
        );
        assert.equal(
            workflow.on.workflow_call.inputs.native_cache.default,
            false,
        );
    }
    const action = yaml.load(
        fs.readFileSync(
            new URL(
                "../../../../.github/actions/fanout-setup/action.yml",
                import.meta.url,
            ),
            "utf8",
        ),
    );
    const install = action.runs.steps.find(
        (step) =>
            step.name ===
            "Install native dependencies with bounded visible retries",
    );
    assert.match(install.run, /\$attempt -le 3/);
    assert.match(install.run, /--force.*--no-side-effects-cache/);
    assert.doesNotMatch(
        JSON.stringify(action),
        /ciProfile\.mjs|Stopwatch|TYPEAGENT_CI_PROFILE|TYPEAGENT_INSTALL_ATTEMPT|TYPEAGENT_NATIVE_CACHE_HIT/,
    );
    assert.match(install.run, /if \(\$status -eq 0\) \{ exit 0 \}/);
    assert.match(install.run, /throw .*exhausted 3 attempts/);
});
