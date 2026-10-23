// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Runs the local unit-test suite (`test:local`) with flaky-test mitigation:
//
//  1. Run the whole suite once, capturing individual failures via the reporter
//     that writes to TYPEAGENT_TEST_FAILURES_DIR.
//  2. Retry failed files for recognized Jest scripts, otherwise whole packages,
//     up to twice serially, with caching disabled and fresh reporter directories.
//  3. Classify every observed failure as flaky (absent from the final attempt)
//     or build-blocking (present in the final attempt), then print a summary and
//     emit GitHub annotations / a step summary. The build fails unless a retry
//     command completes successfully.
//  4. Run root script tests independently, even if workspace tests still fail.

import fs from "node:fs";
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
    MAX_TEST_RETRIES,
    runLocalTestPhases,
    planPackageRetry,
    windowsPnpmCommand,
} from "./lib/testRetry.mjs";

// build-ts runs this from the `ts` directory, which is the pnpm workspace root.
const workspaceRoot = process.cwd();
const isWindows = process.platform === "win32";
const inGithubActions = process.env.GITHUB_ACTIONS === "true";

const firstDirectory = makeFailuresDirectory("run1");
const failureDirectories = [firstDirectory];
try {
    process.exitCode = runLocalTestPhases(
        () => {
            const status = runWorkspaceTests();
            reportPhase("Workspace tests (including retries)", status);
            return status;
        },
        () => {
            console.error("\nROOT SCRIPT TEST PHASE");
            const result = runPnpm(
                ["run", "test:local:scripts"],
                firstDirectory,
            );
            checkInfrastructureFailure(result);
            const status = result.status ?? 1;
            reportPhase("Root script tests", status);
            return status;
        },
    );
} finally {
    for (const directory of failureDirectories) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

function checkInfrastructureFailure(result) {
    if (result.error !== undefined || result.signal !== null) {
        console.error(
            `Test command infrastructure failure: ${result.error?.message ?? result.signal}`,
        );
        return true;
    }
    return false;
}

function reportPhase(name, status) {
    console.error(`\n${name}: exit ${status}`);
    if (inGithubActions) {
        if (status !== 0)
            console.log(`::error::${name} failed (exit ${status}).`);
        appendGithubSummary(
            `### ${name}\n\nResult: **${status === 0 ? "passed" : "failed"}** (exit ${status}).`,
        );
    }
}

function runWorkspaceTests() {
    console.error("\nWORKSPACE TEST PHASE");
    const firstResult = runPnpm(["run", "test:local:packages"], firstDirectory);
    if (checkInfrastructureFailure(firstResult)) return 1;

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
        return firstResult.status ?? 1;
    }
    return handleFailures(firstFailures);
}

function handleFailures(firstFailures) {
    const annotated = annotatePackages(firstFailures);

    const packages = [
        ...new Set(
            annotated
                .map((failure) => failure.package)
                .filter((name) => name !== undefined),
        ),
    ];

    let priorFailures = annotated;
    let finalFailures = [];
    let retryTrusted = true;
    let retryFailed = false;
    if (packages.length > 0) {
        const retriableCount = annotated.filter(
            (failure) => failure.package !== undefined,
        ).length;
        console.error(
            `\n${"=".repeat(80)}\nRETRYING ${retriableCount} failed test(s) across ${packages.length} package(s) up to ${MAX_TEST_RETRIES} times\n${"=".repeat(80)}`,
        );

        for (let attempt = 1; attempt <= MAX_TEST_RETRIES; attempt++) {
            console.error(`\nRetry ${attempt} of ${MAX_TEST_RETRIES}`);
            finalFailures = [];
            retryFailed = false;
            const packageNames = [
                ...new Set(
                    priorFailures
                        .map((failure) => failure.package)
                        .filter((name) => name !== undefined),
                ),
            ];
            for (const name of packageNames) {
                const failures = priorFailures.filter(
                    (failure) => failure.package === name,
                );
                const packageDir = resolvePackage(
                    failures[0].testFilePath,
                )?.directory;
                if (packageDir === undefined) {
                    retryTrusted = false;
                    retryFailed = true;
                    break;
                }
                const manifest = JSON.parse(
                    fs.readFileSync(
                        path.join(packageDir, "package.json"),
                        "utf8",
                    ),
                );
                let plan = planPackageRetry(
                    manifest,
                    failures.map((failure) =>
                        toAbsolutePath(failure.testFilePath),
                    ),
                    packageDir,
                );
                if (
                    plan.narrowed &&
                    plan.args
                        .slice(6)
                        .some((file) => !isRegularPackageFile(file, packageDir))
                ) {
                    plan = {
                        narrowed: false,
                        reason: "failed path is not a regular file contained in the owning package",
                        cwd: packageDir,
                        args: ["run", "test:local"],
                    };
                }
                console.error(
                    plan.narrowed
                        ? `Retrying failed files in ${name}`
                        : `Full-package retry for ${name}: ${plan.reason}`,
                );
                const retryDirectory = makeFailuresDirectory(`retry${attempt}`);
                failureDirectories.push(retryDirectory);
                const retryResult = runPnpm(
                    plan.args,
                    retryDirectory,
                    true,
                    plan.cwd,
                );
                const observed = readFailures(retryDirectory);
                finalFailures.push(...observed);
                const failed =
                    retryResult.error !== undefined ||
                    retryResult.signal !== null ||
                    (retryResult.status ?? 1) !== 0;
                retryFailed ||= failed;
                // Check each command independently: another package's artifacts
                // cannot make a crashed or unreported invocation trustworthy.
                if (
                    retryResult.error !== undefined ||
                    retryResult.signal !== null ||
                    (failed && observed.length === 0)
                ) {
                    console.error(
                        `Untrusted retry for ${name}: command failed without reliable failure artifacts.`,
                    );
                    retryTrusted = false;
                    break;
                }
            }
            finalFailures = dedupeFailures(finalFailures, workspaceRoot);
            if (!retryTrusted) break;
            if (!retryFailed) {
                break;
            }
            if (attempt < MAX_TEST_RETRIES) {
                priorFailures = mergeFailures(
                    priorFailures,
                    annotatePackages(finalFailures),
                );
            }
        }
    }

    const classification = classifyRetryResults({
        first: priorFailures,
        second: finalFailures,
        retryTrusted,
        retryFailed,
    });

    for (const line of buildSummaryLines(classification)) {
        console.error(line);
    }

    function annotatePackages(failures) {
        return failures.map((failure) => ({
            ...failure,
            package: resolvePackage(failure.testFilePath)?.name,
        }));
    }

    function mergeFailures(...groups) {
        return [
            ...new Map(
                groups.flat().map((failure) => [failure.key, failure]),
            ).values(),
        ];
    }

    if (inGithubActions) {
        emitGithubReport(classification);
    }

    return hasHardFailures(classification) ? 1 : 0;
}

function makeFailuresDirectory(label) {
    return fs.mkdtempSync(
        path.join(workspaceRoot, `.typeagent-test-failures-${label}-`),
    );
}

function isRegularPackageFile(file, packageDir) {
    try {
        const relative = path.relative(
            fs.realpathSync(packageDir),
            fs.realpathSync(file),
        );
        return (
            relative !== "" &&
            relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative) &&
            fs.statSync(file).isFile()
        );
    } catch {
        return false;
    }
}

function runPnpm(
    pnpmArguments,
    failuresDirectory,
    disableJestCache = false,
    cwd = workspaceRoot,
) {
    let windowsCommand;
    try {
        windowsCommand = isWindows
            ? windowsPnpmCommand(pnpmArguments)
            : undefined;
    } catch (error) {
        return { error, signal: null, status: null };
    }
    const [command, commandArguments] = isWindows
        ? [
              process.env.ComSpec ?? "cmd.exe",
              ["/d", "/v:off", "/s", "/c", windowsCommand],
          ]
        : ["pnpm", pnpmArguments];

    return spawnSync(command, commandArguments, {
        cwd,
        ...(isWindows ? { windowsVerbatimArguments: true } : {}),
        env: {
            ...process.env,
            TYPEAGENT_TEST_FAILURES_DIR: failuresDirectory,
            ...(disableJestCache ? { TYPEAGENT_JEST_NO_CACHE: "true" } : {}),
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

function resolvePackage(testFilePath) {
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
            ? { name: manifest.name, directory: packageDir }
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
    const markdown = buildStepSummaryMarkdown(classification);
    appendGithubSummary(markdown);
}

function appendGithubSummary(markdown) {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
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
