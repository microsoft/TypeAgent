// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localTestCommands } from "./runLocalTestPackages.mjs";
import { partitionPackages } from "./lib/ciTestPartitions.mjs";
import { fanoutNodes } from "./lib/ciFanoutTargets.mjs";

const manifestName = "ci-fanout-manifest.json";
const packagePath = "packages/memory/service";
const groups = ["1", "2", "3", "4"];
const platforms = ["linux", "win32", "darwin"];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const portable = (value) => value.split(path.sep).join("/");

function outputPath(value) {
    assert.equal(typeof value, "string", "Artifact path must be a string");
    const parts = value.split("/");
    assert.ok(
        parts.includes("dist") &&
            parts.every(
                (part) =>
                    part &&
                    ![
                        ".",
                        "..",
                        "node_modules",
                        ".git",
                        ".npmrc",
                        "config.local.yaml",
                    ].includes(part) &&
                    !part.startsWith(".env") &&
                    !/[\\:]/.test(part),
            ),
        `Unsafe artifact path: ${value}`,
    );
    return parts;
}

export function outputs(root, relative = "", insideDist = false) {
    const files = [];
    for (const entry of fs.readdirSync(path.join(root, relative), {
        withFileTypes: true,
    })) {
        if (["node_modules", ".git"].includes(entry.name)) continue;
        const child = path.join(relative, entry.name);
        const compiled = insideDist || entry.name === "dist";
        if (entry.isSymbolicLink()) {
            assert.ok(!compiled, `Symlink in compiled output: ${child}`);
        } else if (entry.isDirectory()) {
            files.push(...outputs(root, child, compiled));
        } else if (compiled) {
            assert.ok(entry.isFile(), `Non-file compiled output: ${child}`);
            const name = portable(child);
            outputPath(name);
            files.push(name);
        }
    }
    return files.sort();
}

export function identity(root, sha) {
    assert.match(sha, /^[a-f0-9]{40}$/);
    return {
        sha,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        abi: process.versions.modules,
        lockHash: digest(fs.readFileSync(path.join(root, "pnpm-lock.yaml"))),
    };
}

export function verifyCheckout(root, sha) {
    assert.match(sha, /^[a-f0-9]{40}$/);
    assert.equal(
        execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8",
        }).trim(),
        sha,
        "Checkout does not match the candidate SHA",
    );
}

function scopedOutputs(root, scope, directories) {
    const files = outputs(root);
    if (!["packages", "remainder"].includes(scope)) return files;
    assert.ok(
        Array.isArray(directories) && directories.length > 0,
        "Empty runtime closure",
    );
    assert.equal(new Set(directories).size, directories.length);
    for (const directory of directories) {
        outputPath(`${directory}/dist/index.js`);
        assert.ok(
            !directory.split("/").includes("dist"),
            "Invalid package directory",
        );
    }
    return files.filter(
        (file) =>
            (scope === "remainder" || !file.endsWith(".tsbuildinfo")) &&
            directories.some((directory) =>
                file.startsWith(`${directory}/dist/`),
            ),
    );
}

export function createManifest(
    root,
    sha,
    tests,
    scope = "memory",
    directories,
) {
    assert.ok(
        ["memory", "workspace", "packages", "remainder"].includes(scope),
        "Unknown artifact scope",
    );
    assert.ok(
        ["workspace", "remainder"].includes(scope) || tests.length > 0,
        "Empty test inventory",
    );
    assert.equal(
        new Set(tests).size,
        tests.length,
        "Duplicate discovered tests",
    );
    const files = scopedOutputs(root, scope, directories).map((name) => {
        const bytes = fs.readFileSync(path.join(root, name));
        return { path: name, size: bytes.length, sha256: digest(bytes) };
    });
    for (const test of tests) {
        outputPath(test);
        assert.ok(
            (scope === "memory"
                ? [packagePath]
                : Object.values(partitionPackages).map(
                      ({ directory }) => directory,
                  )
            ).some((directory) => test.startsWith(`${directory}/dist/test/`)) &&
                test.endsWith(".spec.js") &&
                files.some((file) => file.path === test),
            `Test is not a compiled memory-service spec: ${test}`,
        );
    }
    return {
        version: 1,
        scope,
        ...(["packages", "remainder"].includes(scope) ? { directories } : {}),
        ...identity(root, sha),
        files,
        tests: [...tests].sort(),
    };
}

export function verifyManifest(
    root,
    sha,
    manifest,
    scope = "memory",
    producer = false,
) {
    assert.ok(
        ["memory", "workspace", "packages", "remainder"].includes(scope),
        "Unknown artifact scope",
    );
    assert.equal(manifest.version, 1);
    assert.equal(manifest.scope, scope, "Artifact scope mismatch");
    for (const [key, value] of Object.entries(identity(root, sha))) {
        assert.equal(manifest[key], value, `Artifact ${key} mismatch`);
    }
    assert.ok(manifest.files.length > 0);
    assert.ok(
        ["workspace", "remainder"].includes(scope) || manifest.tests.length > 0,
    );
    assert.equal(new Set(manifest.tests).size, manifest.tests.length);
    for (const file of manifest.files) {
        const parts = outputPath(file.path);
        for (let count = 1; count <= parts.length; count++) {
            assert.ok(
                !fs
                    .lstatSync(path.join(root, ...parts.slice(0, count)))
                    .isSymbolicLink(),
                `Symlink in artifact path: ${file.path}`,
            );
        }
        const bytes = fs.readFileSync(path.join(root, ...parts));
        assert.equal(bytes.length, file.size, `Artifact size: ${file.path}`);
        assert.equal(digest(bytes), file.sha256, `Artifact hash: ${file.path}`);
    }
    const inventory = manifest.files.map((file) => file.path).sort();
    assert.deepEqual(
        scopedOutputs(root, scope, manifest.directories),
        inventory,
    );
    if (!producer && ["packages", "remainder"].includes(scope))
        assert.deepEqual(outputs(root), inventory);
    for (const test of manifest.tests) {
        outputPath(test);
        assert.ok(
            (scope === "memory"
                ? [packagePath]
                : Object.values(partitionPackages).map(
                      ({ directory }) => directory,
                  )
            ).some((directory) => test.startsWith(`${directory}/dist/test/`)) &&
                test.endsWith(".spec.js"),
        );
        assert.ok(manifest.files.some((file) => file.path === test));
    }
}

export function stageArtifact(root, manifest, directory) {
    assert.ok(
        !fs.existsSync(directory),
        "Artifact staging directory must be new",
    );
    verifyManifest(root, manifest.sha, manifest, manifest.scope, true);
    fs.mkdirSync(directory, { recursive: true });
    for (const file of manifest.files) {
        const parts = outputPath(file.path);
        const destination = path.join(directory, ...parts);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(root, ...parts), destination);
    }
    fs.writeFileSync(
        path.join(directory, manifestName),
        JSON.stringify(manifest, null, 2),
    );
}

export function qualify(reports, sha) {
    const nodes = fanoutNodes();
    assert.equal(
        reports.length,
        platforms.length * nodes.length * groups.length,
        "Expected every shard per selected OS/Node",
    );
    return platforms.flatMap((platform) =>
        nodes.map((node) => qualifyTarget(reports, sha, platform, node)),
    );
}

function qualifyTarget(reports, sha, platform, node) {
    const selected = reports.filter(
        (report) => report.platform === platform && report.node === node,
    );
    assert.deepEqual(selected.map((report) => report.group).sort(), groups);
    const reference = selected[0];
    for (const report of selected) {
        assert.equal(report.sha, sha, "Result SHA mismatch");
        assert.equal(
            report.manifestHash,
            reference.manifestHash,
            "Mixed build artifacts",
        );
        assert.equal(report.exitCode, 0, "Failed test process");
        assert.equal(report.success, true, "Unsuccessful Jest result");
        assert.ok(Number.isFinite(report.elapsedMs) && report.elapsedMs > 0);
        assert.deepEqual(report.expectedTests, reference.expectedTests);
    }
    assert.ok(reference.expectedTests.length > 0);
    assert.equal(
        new Set(reference.expectedTests).size,
        reference.expectedTests.length,
    );
    const shards = selected;
    assert.deepEqual(
        shards.flatMap((report) => report.files).sort(),
        reference.expectedTests,
    );
    const outcomes = shards.flatMap((report) => report.outcomes);
    qualifyShardOutcomes(shards);
    return {
        platform,
        node,
        files: reference.expectedTests.length,
        assertions: outcomes.length,
        skippedAssertions: outcomes.filter(
            (outcome) => JSON.parse(outcome)[2] !== "passed",
        ).length,
        slowestShardMs: Math.max(...shards.map((report) => report.elapsedMs)),
        shardProcessMs: shards.reduce(
            (sum, report) => sum + report.elapsedMs,
            0,
        ),
    };
}

function qualifyShardOutcomes(shards) {
    for (const report of shards) {
        const files = new Set();
        for (const encoded of report.outcomes) {
            const outcome = JSON.parse(encoded);
            assert.ok(Array.isArray(outcome) && outcome.length === 3);
            const [file, name, status] = outcome;
            assert.ok(report.files.includes(file), "Assertion outside shard");
            assert.ok(typeof name === "string" && name.length > 0);
            assert.ok(
                ["passed", "pending", "todo"].includes(status),
                "Unsuccessful assertion outcome",
            );
            files.add(file);
        }
        assert.deepEqual(
            [...files].sort(),
            [...report.files].sort(),
            "Missing shard assertions",
        );
    }
}

export function memoryTestSelection(root, platform = process.platform) {
    if (platform !== "darwin") return ["--testPathPattern=.*[.]spec[.]js"];
    const selection = localTestCommands("macos-compat", root).find(
        ({ cwd }) => cwd === path.resolve(root, packagePath),
    );
    assert.ok(selection, "Missing macOS memory compatibility selection");
    for (const file of selection.args.slice(3)) {
        assert.ok(
            fs.statSync(file).isFile(),
            `Missing compiled compatibility suite: ${file}`,
        );
    }
    return selection.args.slice(2);
}

function jestArgs(root, args) {
    return [
        "--no-warnings",
        "--experimental-vm-modules",
        path.join(root, packagePath, "node_modules/jest/bin/jest.js"),
        ...memoryTestSelection(root),
        "--runInBand",
        ...args,
    ];
}

function runGroup(root, sha, group, directory) {
    assert.ok(groups.includes(group), `Unknown test group: ${group}`);
    const manifestBytes = fs.readFileSync(path.join(root, manifestName));
    const manifest = JSON.parse(manifestBytes);
    verifyManifest(root, sha, manifest);
    console.log(
        `Verified ${manifest.files.length} compiled outputs from ${sha}; running ${process.platform} group ${group}.`,
    );
    fs.mkdirSync(directory, { recursive: true });
    const stem = path.join(
        directory,
        `${process.platform}-${process.versions.node}-${group}`,
    );
    const args = ["--json", `--outputFile=${stem}.jest.json`];
    args.push(`--shard=${group}/4`);
    const start = Date.now();
    const result = spawnSync(process.execPath, jestArgs(root, args), {
        cwd: path.join(root, packagePath),
        stdio: "inherit",
        env: { ...process.env, CI: "true" },
    });
    if (result.error) throw result.error;
    const elapsedMs = Date.now() - start;
    const json = JSON.parse(fs.readFileSync(`${stem}.jest.json`, "utf8"));
    const relative = (name) => portable(path.relative(root, name));
    const report = {
        sha,
        platform: process.platform,
        node: process.version,
        group,
        manifestHash: digest(manifestBytes),
        expectedTests: manifest.tests,
        exitCode: result.status,
        success: json.success,
        elapsedMs,
        files: json.testResults.map((file) => relative(file.name)),
        outcomes: json.testResults.flatMap((file) =>
            file.assertionResults.map((test) =>
                JSON.stringify([
                    relative(file.name),
                    test.fullName,
                    test.status,
                ]),
            ),
        ),
    };
    fs.writeFileSync(
        `${stem}.qualification.json`,
        JSON.stringify(report, null, 2),
    );
    assert.equal(result.status, 0, `Jest group ${group} failed`);
    assert.equal(json.success, true);
}

function main() {
    const root = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../..",
    );
    const sha = process.env.GITHUB_SHA;
    verifyCheckout(root, sha);
    assert.ok(
        process.env.RUNNER_TEMP,
        "RUNNER_TEMP is required for CI artifacts",
    );
    const directory = path.join(process.env.RUNNER_TEMP, "fanout-results");
    switch (process.argv[2]) {
        case "create": {
            const tests = JSON.parse(
                execFileSync(
                    process.execPath,
                    jestArgs(root, ["--listTests", "--json"]),
                    {
                        cwd: path.join(root, packagePath),
                        encoding: "utf8",
                        maxBuffer: 16 * 1024 * 1024,
                        stdio: ["ignore", "pipe", "inherit"],
                        env: { ...process.env, CI: "true" },
                    },
                ),
            ).map((name) => portable(path.relative(root, name)));
            const manifest = createManifest(root, sha, tests);
            stageArtifact(
                root,
                manifest,
                path.join(process.env.RUNNER_TEMP, "fanout-build"),
            );
            console.log(
                `Discovered ${tests.length} test files; fingerprinted ${manifest.files.length} compiled outputs from ${sha}.`,
            );
            break;
        }
        case "test":
            runGroup(root, sha, process.argv[3], directory);
            break;
        case "aggregate": {
            const reports = fs
                .readdirSync(directory)
                .filter((name) => name.endsWith(".qualification.json"))
                .map((name) =>
                    JSON.parse(
                        fs.readFileSync(path.join(directory, name), "utf8"),
                    ),
                );
            const summary = qualify(reports, sha);
            console.log(JSON.stringify(summary, null, 2));
            if (process.env.GITHUB_STEP_SUMMARY) {
                fs.appendFileSync(
                    process.env.GITHUB_STEP_SUMMARY,
                    "## Memory-service fan-out qualification\n\n" +
                        "Complete shard inventory and per-file assertion qualification.\n\n" +
                        "Test-process timings only; excludes build, install, artifact transfer and queue delay.\n\n" +
                        "| OS | Node | Files | Assertions | Skipped | Slowest shard (s) | Sum of shards (s) |\n" +
                        "|---|---|---:|---:|---:|---:|---:|\n" +
                        summary
                            .map(
                                (row) =>
                                    `| ${row.platform} | ${row.node} | ${row.files} | ${row.assertions} | ${row.skippedAssertions} | ${(row.slowestShardMs / 1000).toFixed(1)} | ${(row.shardProcessMs / 1000).toFixed(1)} |`,
                            )
                            .join("\n") +
                        "\n",
                );
            }
            break;
        }
        default:
            throw new Error("Expected create, test <1|2|3|4>, or aggregate");
    }
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    main();
}
