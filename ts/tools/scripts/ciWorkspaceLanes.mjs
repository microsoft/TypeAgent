// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localTestCommands, spawnPnpm } from "./runLocalTestPackages.mjs";
import { verifyManifest, verifyCheckout } from "./ciFanoutExperiment.mjs";
import {
    packageTimingsFromLog,
    planLanes,
    qualifyLanes,
    runtimeClosure,
} from "./lib/ciWorkspaceLanes.mjs";

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
);
const profilePath = path.join(root, "tools/scripts/ciRemainderDurations.json");

export function readWorkspace(directory) {
    const result = spawnPnpm(["-r", "list", "--depth", "-1", "--json"], {
        cwd: directory,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "inherit"],
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "Could not discover pnpm workspace");
    return JSON.parse(result.stdout)
        .filter((pkg) => path.resolve(pkg.path) !== path.resolve(directory))
        .map((pkg) => {
            const relative = path
                .relative(directory, pkg.path)
                .split(path.sep)
                .join("/");
            assert.ok(
                relative &&
                    !relative.startsWith("../") &&
                    !path.isAbsolute(relative),
                "Package outside workspace",
            );
            const manifest = JSON.parse(
                fs.readFileSync(path.join(pkg.path, "package.json"), "utf8"),
            );
            return {
                ...manifest,
                scripts: manifest.scripts ?? {},
                directory: relative,
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function createRemainderPlan(packages, platform = process.platform) {
    const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    const compatibility = localTestCommands(
        "macos-compat-without-memory",
        root,
    ).map(({ cwd }) => path.relative(root, cwd).split(path.sep).join("/"));
    return planLanes(packages, profile.timings, platform, compatibility);
}

function profile(run, files) {
    assert.match(run, /^\d+$/);
    assert.ok(files.length > 0, "Provide hosted first-pass package logs");
    const packages = readWorkspace(root);
    const timings = {};
    for (const file of files) {
        const observed = packageTimingsFromLog(fs.readFileSync(file, "utf8"));
        for (const [directory, ms] of Object.entries(observed)) {
            const pkg = packages.find((pkg) => pkg.directory === directory);
            assert.ok(pkg, `Unknown timed package: ${directory}`);
            timings[pkg.name] = Math.max(timings[pkg.name] ?? 0, ms);
        }
    }
    fs.writeFileSync(
        profilePath,
        JSON.stringify(
            {
                source: `https://github.com/microsoft/TypeAgent/actions/runs/${run}`,
                method: "Maximum observed first-pass Linux/Windows whole-package process time, including chained scripts; unprofiled packages use the reported median.",
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
    console.log(`Profiled ${Object.keys(timings).length} packages.`);
}

function runLane(group, sha) {
    const bytes = fs.readFileSync(path.join(root, "ci-fanout-manifest.json"));
    const manifest = JSON.parse(bytes);
    const scope = process.env.TYPEAGENT_REMAINDER_ARTIFACT_SCOPE ?? "workspace";
    verifyManifest(root, sha, manifest, scope);
    const packages = readWorkspace(root);
    const plan = createRemainderPlan(packages);
    assert.deepEqual(
        plan,
        manifest.remainder,
        "Restored remainder selection changed",
    );
    assert.match(group, /^[1-4]$/);
    const selected = plan.groups[Number(group) - 1];
    assert.ok(selected, "Unknown remainder lane");
    if (scope === "remainder") {
        assert.equal(
            manifest.remainderGroup,
            group,
            "Wrong remainder artifact group",
        );
        assert.deepEqual(
            manifest.directories,
            runtimeClosure(packages, selected.files),
            "Remainder runtime closure changed",
        );
    } else assert.equal(scope, "workspace");
    const started = Date.now();
    const result = spawnSync(
        process.execPath,
        [path.join(root, "tools/scripts/runTestLocalWithSummary.mjs")],
        {
            cwd: root,
            stdio: "inherit",
            env: {
                ...process.env,
                TYPEAGENT_TEST_PHASE: "workspace",
                TYPEAGENT_TEST_PROFILE:
                    process.platform === "darwin"
                        ? "macos-compat-without-memory"
                        : "fanout-lane",
                TYPEAGENT_TEST_PACKAGES_JSON: JSON.stringify(selected.files),
            },
        },
    );
    const report = {
        sha,
        platform: process.platform,
        node: process.version,
        group,
        manifestHash: createHash("sha256").update(bytes).digest("hex"),
        workspaceHash:
            scope === "workspace"
                ? createHash("sha256").update(bytes).digest("hex")
                : manifest.workspaceHash,
        plan,
        packages: selected.files,
        success: !result.error && result.status === 0,
        elapsedMs: Date.now() - started,
    };
    const directory = path.join(process.env.RUNNER_TEMP, "fanout-lanes");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
        path.join(
            directory,
            `${process.platform}-${process.versions.node}-${group}.lane.json`,
        ),
        JSON.stringify(report, null, 2),
    );
    if (result.error) throw result.error;
    assert.equal(result.signal, null, "Remainder lane interrupted");
    assert.ok(
        report.success,
        "Remainder lane failed after existing retry budget",
    );
}

function main() {
    const [command, value, ...files] = process.argv.slice(2);
    if (command === "profile") return profile(value, files);
    assert.ok(
        process.env.RUNNER_TEMP &&
            /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ""),
    );
    verifyCheckout(root, process.env.GITHUB_SHA);
    if (command === "test") return runLane(value, process.env.GITHUB_SHA);
    assert.equal(command, "aggregate", "Unknown remainder command");
    const directory = path.join(process.env.RUNNER_TEMP, "fanout-lanes");
    const reports = fs
        .readdirSync(directory)
        .filter((file) => file.endsWith(".lane.json"))
        .map((file) =>
            JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")),
        );
    const packages = readWorkspace(root);
    const plans = Object.fromEntries(
        ["linux", "win32", "darwin"].map((platform) => [
            platform,
            createRemainderPlan(packages, platform),
        ]),
    );
    const summary = qualifyLanes(reports, process.env.GITHUB_SHA, plans);
    console.log(JSON.stringify(summary, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY)
        fs.appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `## Remainder qualification\n\n${summary
                .map(
                    (row) =>
                        `- ${row.platform} ${row.node}: ${row.packages} packages, slowest lane ${(row.slowestMs / 1000).toFixed(1)}s.`,
                )
                .join("\n")}\n`,
        );
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    main();
