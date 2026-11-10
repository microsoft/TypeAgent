// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    createManifest,
    verifyManifest,
    stageArtifact,
    verifyCheckout,
} from "./ciFanout.mjs";
import {
    balanceTests,
    partitionPackages,
    qualifyPartitions,
    runPartitionAttempts,
    timingsFromLog,
    validatePartitions,
} from "./lib/ciTestPartitions.mjs";
import { MAX_TEST_RETRIES } from "./lib/testRetry.mjs";
import { spawnPnpm } from "./runLocalTestPackages.mjs";
import { createRemainderPlan, readWorkspace } from "./ciWorkspaceLanes.mjs";
import { runtimeClosure } from "./lib/ciWorkspaceLanes.mjs";

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
);
const portable = (file) => path.relative(root, file).split(path.sep).join("/");
const profilePath = path.join(root, "tools/scripts/ciTestDurations.json");

function packageArgs(target, args) {
    const { directory, script, selection } = partitionPackages[target];
    const scripts = JSON.parse(
        fs.readFileSync(path.join(root, directory, "package.json"), "utf8"),
    ).scripts;
    assert.equal(
        scripts["test:local"],
        script,
        "Partitioned package script changed; requalify selection",
    );
    assert.equal(
        scripts["jest-esm"],
        "node --no-warnings --experimental-vm-modules ./node_modules/jest/bin/jest.js",
    );
    for (const hook of [
        "pretest:local",
        "posttest:local",
        "prejest-esm",
        "postjest-esm",
    ]) {
        assert.equal(
            scripts[hook],
            undefined,
            "Partitioning cannot bypass lifecycle hooks",
        );
    }
    return [
        "--no-warnings",
        "--experimental-vm-modules",
        path.join(root, directory, "node_modules/jest/bin/jest.js"),
        ...selection,
        "--runInBand",
        ...args,
    ];
}

function discover(target) {
    const tests = JSON.parse(
        execFileSync(
            process.execPath,
            packageArgs(target, ["--listTests", "--json"]),
            {
                cwd: path.join(root, partitionPackages[target].directory),
                encoding: "utf8",
                maxBuffer: 16 * 1024 * 1024,
                stdio: ["ignore", "pipe", "inherit"],
            },
        ),
    )
        .map(portable)
        .sort();
    assert.ok(
        tests.every(
            (test) =>
                test.startsWith(
                    `${partitionPackages[target].directory}/dist/test/`,
                ) && test.endsWith(".spec.js"),
        ),
    );
    return tests;
}

function prepare(sha) {
    const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    const plans =
        process.platform === "darwin"
            ? []
            : Object.keys(partitionPackages).map((target) => {
                  const plan = {
                      target,
                      ...balanceTests(discover(target), profile.timings),
                  };
                  console.log(
                      `${target}: ${plan.tests.length} files; ${plan.unprofiled.length} unprofiled files use an explicit ${plan.fallbackMs}ms median estimate.`,
                  );
                  console.log(
                      JSON.stringify(
                          plan.groups.map(({ files, estimatedMs }) => ({
                              files: files.length,
                              estimatedMs,
                          })),
                      ),
                  );
                  return plan;
              });
    const manifest = createManifest(
        root,
        sha,
        plans.flatMap((plan) => plan.tests),
        "workspace",
    );
    manifest.plans = plans;
    manifest.profileSource = profile.source;
    const packages = readWorkspace(root);
    manifest.remainder = createRemainderPlan(packages);
    stageArtifact(
        root,
        manifest,
        path.join(process.env.RUNNER_TEMP, "fanout-workspace-build"),
    );
    console.log(
        `Workspace payload: ${manifest.files.length} files, ${manifest.files.reduce((sum, file) => sum + file.size, 0)} bytes.`,
    );
    if (process.env.TYPEAGENT_COMPACT_ARTIFACT === "true" && plans.length > 0) {
        const compact = createManifest(
            root,
            sha,
            manifest.tests,
            "packages",
            runtimeClosure(
                packages,
                Object.values(partitionPackages).map(({ name }) => name),
            ),
        );
        compact.plans = plans;
        compact.profileSource = profile.source;
        stageArtifact(
            root,
            compact,
            path.join(process.env.RUNNER_TEMP, "fanout-package-build"),
        );
        console.log(
            `Package payload (maps retained): ${compact.files.length} files, ${compact.files.reduce((sum, file) => sum + file.size, 0)} bytes.`,
        );
    }
    if (process.env.TYPEAGENT_COMPACT_ARTIFACT === "true") {
        for (const [index, group] of manifest.remainder.groups.entries()) {
            const compact = createManifest(
                root,
                sha,
                [],
                "remainder",
                runtimeClosure(packages, group.files),
            );
            compact.remainder = manifest.remainder;
            compact.remainderGroup = String(index + 1);
            compact.workspaceHash = createHash("sha256")
                .update(
                    fs.readFileSync(
                        path.join(
                            process.env.RUNNER_TEMP,
                            "fanout-workspace-build",
                            "ci-fanout-manifest.json",
                        ),
                    ),
                )
                .digest("hex");
            stageArtifact(
                root,
                compact,
                path.join(
                    process.env.RUNNER_TEMP,
                    `fanout-remainder-build-${index + 1}`,
                ),
            );
            console.log(
                `Remainder ${index + 1} payload (maps retained): ${compact.files.length} files, ${compact.files.reduce((sum, file) => sum + file.size, 0)} bytes.`,
            );
        }
    }
}

function restored(sha) {
    const bytes = fs.readFileSync(path.join(root, "ci-fanout-manifest.json"));
    const manifest = JSON.parse(bytes);
    verifyManifest(
        root,
        sha,
        manifest,
        process.env.TYPEAGENT_PARTITION_ARTIFACT_SCOPE ?? "workspace",
    );
    if (manifest.scope === "packages")
        assert.deepEqual(
            manifest.directories,
            runtimeClosure(
                readWorkspace(root),
                Object.values(partitionPackages).map(({ name }) => name),
            ),
            "Runtime dependency closure changed",
        );
    assert.deepEqual(
        manifest.plans.map((plan) => plan.target),
        process.platform === "darwin" ? [] : Object.keys(partitionPackages),
    );
    for (const plan of manifest.plans)
        validatePartitions(plan.tests, plan.groups);
    assert.deepEqual(
        manifest.plans.flatMap((plan) => plan.tests).sort(),
        [...manifest.tests].sort(),
    );
    return { manifest, hash: createHash("sha256").update(bytes).digest("hex") };
}

function attempt(target, files, output, retry) {
    packageArgs(target, []);
    const args = [
        "run",
        "test:local",
        "--runInBand",
        "--json",
        `--outputFile=${output}`,
        "--runTestsByPath",
        ...files.map((file) => path.join(root, file)),
        ...(retry ? ["--no-cache"] : []),
    ];
    const result = spawnPnpm(args, {
        cwd: path.join(root, partitionPackages[target].directory),
        stdio: "inherit",
    });
    if (result.error) throw result.error;
    assert.equal(result.signal, null, "Package partition interrupted");
    const json = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.deepEqual(
        json.testResults.map((file) => portable(file.name)).sort(),
        [...files].sort(),
        "Jest did not execute exactly the selected partition",
    );
    const failed = json.testResults
        .filter((file) => file.status === "failed")
        .map((file) => portable(file.name));
    if (result.status !== 0 || !json.success)
        assert.ok(failed.length > 0, "Unattributed Jest process failure");
    else assert.equal(failed.length, 0);
    return { json, failed, success: result.status === 0 && json.success };
}

function runTarget(plan, group, hash, sha, directory) {
    assert.deepEqual(
        discover(plan.target),
        plan.tests,
        "Restored test selection differs from the planned inventory",
    );
    const files = plan.groups[Number(group) - 1].files;
    const stem = path.join(
        directory,
        `${process.platform}-${process.versions.node}-${plan.target}-${group}`,
    );
    const started = Date.now();
    const { results, success, firstPassSucceeded, attempts } =
        runPartitionAttempts(files, (remaining, retry) => {
            const result = attempt(
                plan.target,
                remaining,
                `${stem}.attempt-${retry}.jest.json`,
                retry > 0,
            );
            if (!result.success)
                console.error(
                    `Partition ${plan.target}/${group}: attempt ${retry + 1} failed in ${result.failed.length} files; ${MAX_TEST_RETRIES - retry} retries remain.`,
                );
            return result;
        });
    const report = {
        sha,
        platform: process.platform,
        node: process.version,
        target: plan.target,
        group,
        manifestHash: hash,
        expectedTests: plan.tests,
        selectedTests: files,
        files: results.map((file) => portable(file.name)),
        success,
        firstPassSucceeded,
        attempts,
        elapsedMs: Date.now() - started,
        timings: Object.fromEntries(
            results.map((file) => {
                const ms = file.endTime - file.startTime;
                assert.ok(
                    Number.isFinite(ms) && ms >= 0,
                    "Missing per-file Jest timing",
                );
                return [portable(file.name), Math.max(1, ms)];
            }),
        ),
        outcomes: results.flatMap((file) =>
            file.assertionResults.map((test) =>
                JSON.stringify([
                    portable(file.name),
                    test.fullName,
                    test.status,
                ]),
            ),
        ),
    };
    fs.writeFileSync(`${stem}.partition.json`, JSON.stringify(report, null, 2));
    assert.ok(
        success,
        `Package partition ${plan.target}/${group} failed after retries`,
    );
    if (!firstPassSucceeded)
        console.log(
            `::warning::${plan.target}/${group} passed only after a retry; see retained attempt reports.`,
        );
}

function profileLogs(run, files) {
    assert.match(run, /^\d+$/, "Expected a source workflow run ID");
    assert.ok(files.length > 0, "Provide hosted log files");
    const timings = {};
    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        const report = file.endsWith(".json") ? JSON.parse(text) : undefined;
        if (report)
            assert.equal(
                report.firstPassSucceeded,
                true,
                "Profile first-pass and retry timings separately",
            );
        const observed = report ? report.timings : timingsFromLog(text);
        assert.ok(
            observed && Object.keys(observed).length > 0,
            "Missing per-file timings",
        );
        for (const [test, ms] of Object.entries(observed)) {
            assert.ok(Number.isFinite(ms) && ms > 0, "Invalid profile timing");
            timings[test] = Math.max(timings[test] ?? 0, ms);
        }
    }
    fs.writeFileSync(
        profilePath,
        JSON.stringify(
            {
                source: `https://github.com/microsoft/TypeAgent/actions/runs/${run}`,
                method: "Maximum observed per-file Linux/Windows Jest time from logs/partition reports; missing files use the package median and are reported explicitly.",
                timings: Object.fromEntries(
                    Object.entries(timings).sort(([a], [b]) =>
                        a.localeCompare(b),
                    ),
                ),
            },
            null,
            2,
        ) + "\n",
    );
    console.log(
        `Profiled ${Object.keys(timings).length} dispatcher/provider files.`,
    );
}

function main() {
    const [command, group, ...files] = process.argv.slice(2);
    if (command === "profile") {
        profileLogs(group, files);
        return;
    }
    const sha = process.env.GITHUB_SHA;
    verifyCheckout(root, sha);
    assert.ok(process.env.RUNNER_TEMP, "RUNNER_TEMP is required");
    const directory = path.join(process.env.RUNNER_TEMP, "fanout-partitions");
    switch (command) {
        case "prepare":
            prepare(sha);
            break;
        case "verify":
            restored(sha);
            break;
        case "test": {
            assert.ok(
                ["1", "2", "3", "4"].includes(group),
                "Unknown partition group",
            );
            const { manifest, hash } = restored(sha);
            assert.notEqual(
                process.platform,
                "darwin",
                "Full package partitions must not run on macOS",
            );
            fs.mkdirSync(directory, { recursive: true });
            for (const plan of manifest.plans) {
                runTarget(plan, group, hash, sha, directory);
            }
            break;
        }
        case "aggregate": {
            const reports = fs
                .readdirSync(directory)
                .filter((file) => file.endsWith(".partition.json"))
                .map((file) =>
                    JSON.parse(
                        fs.readFileSync(path.join(directory, file), "utf8"),
                    ),
                );
            const summary = qualifyPartitions(reports, sha);
            console.log(JSON.stringify(summary, null, 2));
            if (process.env.GITHUB_STEP_SUMMARY)
                fs.appendFileSync(
                    process.env.GITHUB_STEP_SUMMARY,
                    `## Dispatcher/provider partition qualification\n\n${summary
                        .map(
                            (row) =>
                                `- ${row.platform} ${row.node} ${row.target}: ${row.files} files, slowest group ${(row.slowestGroupMs / 1000).toFixed(1)}s, ${row.firstPassFailures} groups needed retries.`,
                        )
                        .join("\n")}\n`,
                );
            break;
        }
        default:
            throw new Error(
                "Expected profile <run> <logs...>, prepare, verify, test <1|2|3|4>, or aggregate",
            );
    }
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    main();
