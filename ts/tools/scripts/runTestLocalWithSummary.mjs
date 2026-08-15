// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Runs the local unit-test suite (`test:local`) with flaky-test mitigation:
//
//  1. Run the whole suite once, capturing individual failures via the reporter
//     that writes to TYPEAGENT_TEST_FAILURES_DIR.
//  2. If anything failed, rerun ONLY the packages that owned a failing test,
//     serially, into a fresh failures directory (option #2, "rerun-only-
//     failed").
//  3. Classify each round-1 failure as flaky (passed on retry) or confirmed
//     (failed again), print a summary, and emit GitHub annotations / a step
//     summary so flaky tests are tracked instead of silently masked (option
//     #3). The build fails unless the retry command completes successfully.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
    dedupeFailures,
    findPackageDir,
    classifyRetryResults,
    hasHardFailures,
    buildSummaryLines,
    buildGithubAnnotations,
    buildStepSummaryMarkdown,
    toFsPath,
} from "./lib/testRetry.mjs";

// build-ts runs this from the `ts` directory, which is the pnpm workspace root.
const workspaceRoot = process.cwd();
const isWindows = process.platform === "win32";
const inGithubActions = process.env.GITHUB_ACTIONS === "true";

const firstDirectory = makeFailuresDirectory("run1");
let secondDirectory;
try {
    const firstResult = runPnpm(["run", "test:local"], firstDirectory);

    // A spawn error or a killing signal is an infrastructure failure, not a
    // test failure we can retry; surface it exactly like before.
    if (firstResult.error !== undefined) {
        throw firstResult.error;
    }
    if (firstResult.signal !== null) {
        process.kill(process.pid, firstResult.signal);
    }

    const firstFailures = dedupeFailures(
        readFailures(firstDirectory),
        workspaceRoot,
    );

    if (firstFailures.length === 0) {
        if ((firstResult.status ?? 1) !== 0) {
            console.error(
                "\nFAILED TEST SUMMARY\nNo individual test failures were captured. See the test output above.",
            );
        }
        process.exitCode = firstResult.status ?? 0;
    } else {
        process.exitCode = handleFailures(firstFailures);
    }
} finally {
    fs.rmSync(firstDirectory, { recursive: true, force: true });
    if (secondDirectory !== undefined) {
        fs.rmSync(secondDirectory, { recursive: true, force: true });
    }
}

function handleFailures(firstFailures) {
    // Attach the owning package (for the retry) to each round-1 failure.
    const annotated = firstFailures.map((failure) => ({
        ...failure,
        package: resolvePackageName(failure.testFilePath),
    }));

    const packages = [
        ...new Set(
            annotated
                .map((failure) => failure.package)
                .filter((name) => name !== undefined),
        ),
    ];

    let second = [];
    let retryTrusted = true;
    let retryFailed = false;
    if (packages.length > 0) {
        const retriableCount = annotated.filter(
            (failure) => failure.package !== undefined,
        ).length;
        console.error(
            `\n${"=".repeat(80)}\nRETRYING ${retriableCount} failed test(s) across ${packages.length} package(s) to detect flakiness\n${"=".repeat(80)}`,
        );

        secondDirectory = makeFailuresDirectory("run2");
        const retryResult = runPnpm(
            [
                ...packages.flatMap((name) => ["--filter", name]),
                // Serial rerun of only the affected packages: isolates genuine
                // failures from parallelism/resource-contention flakiness.
                "--workspace-concurrency=1",
                "--no-sort",
                "--stream",
                "--no-bail",
                "run",
                "test:local",
            ],
            secondDirectory,
        );

        second = dedupeFailures(readFailures(secondDirectory), workspaceRoot);
        retryFailed =
            retryResult.error !== undefined ||
            retryResult.signal !== null ||
            (retryResult.status ?? 1) !== 0;

        // If the retry itself crashed without producing any results, we cannot
        // trust an empty second round as "everything recovered".
        const retryCrashed =
            retryResult.error !== undefined ||
            retryResult.signal !== null ||
            ((retryResult.status ?? 1) !== 0 && second.length === 0);
        retryTrusted = !retryCrashed;
    }

    const classification = classifyRetryResults({
        first: annotated,
        second,
        retryTrusted,
        retryFailed,
    });

    for (const line of buildSummaryLines(classification)) {
        console.error(line);
    }

    if (inGithubActions) {
        emitGithubReport(classification);
    }

    return hasHardFailures(classification) ? 1 : 0;
}

function makeFailuresDirectory(label) {
    return fs.mkdtempSync(
        path.join(os.tmpdir(), `typeagent-test-failures-${label}-`),
    );
}

function runPnpm(pnpmArguments, failuresDirectory) {
    const [command, commandArguments] = isWindows
        ? [
              process.env.ComSpec ?? "cmd.exe",
              ["/d", "/s", "/c", ["pnpm", ...pnpmArguments].join(" ")],
          ]
        : ["pnpm", pnpmArguments];

    return spawnSync(command, commandArguments, {
        env: {
            ...process.env,
            TYPEAGENT_TEST_FAILURES_DIR: failuresDirectory,
        },
        stdio: "inherit",
    });
}

function readFailures(directory) {
    return fs
        .readdirSync(directory)
        .filter((fileName) => fileName.endsWith(".json"))
        .flatMap((fileName) => readFailureArtifact(directory, fileName));
}

function readFailureArtifact(directory, fileName) {
    try {
        return JSON.parse(
            fs.readFileSync(path.join(directory, fileName), "utf8"),
        );
    } catch (error) {
        console.error(
            `Unable to read test failure artifact ${fileName}: ${error.message}`,
        );
        return [];
    }
}

function resolvePackageName(testFilePath) {
    const packageDir = findPackageDir(
        toAbsolutePath(testFilePath),
        workspaceRoot,
        (directory) => fs.existsSync(path.join(directory, "package.json")),
    );
    if (packageDir === undefined) {
        return undefined;
    }
    try {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
        );
        return typeof manifest.name === "string" && manifest.name.length > 0
            ? manifest.name
            : undefined;
    } catch {
        return undefined;
    }
}

function toAbsolutePath(testFilePath) {
    if (typeof testFilePath !== "string" || testFilePath.length === 0) {
        return workspaceRoot;
    }
    const resolved = toFsPath(testFilePath);
    return path.isAbsolute(resolved)
        ? resolved
        : path.resolve(workspaceRoot, resolved);
}

function emitGithubReport(classification) {
    for (const annotation of buildGithubAnnotations(classification)) {
        console.log(annotation);
    }
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    const markdown = buildStepSummaryMarkdown(classification);
    if (summaryFile !== undefined && markdown.length > 0) {
        try {
            fs.appendFileSync(summaryFile, `${markdown}\n`);
        } catch (error) {
            console.error(
                `Unable to write GitHub step summary: ${error.message}`,
            );
        }
    }
}
