// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    BUILD_PACKAGE_SHELL_OS,
    BUILD_TS_OS,
    BUILD_TS_VERSIONS,
    countScope,
    formatGithubOutput,
    resolveScope,
    shouldFetchPrBase,
    shouldRunBuildTsFull,
    shouldRunBuildTsLint,
    shouldRunBuildTsRatchet,
    shouldRunShellPackage,
} from "../prCiScope.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(scriptDir, "../prCiScope.mjs");
const repoRoot = path.resolve(scriptDir, "../../../..");
const buildTsYml = path.join(repoRoot, ".github/workflows/build-ts.yml");
const buildPackageShellYml = path.join(
    repoRoot,
    ".github/workflows/build-package-shell.yml",
);
const azureSmokeYml = path.join(repoRoot, "pipelines/azure-smoke-tests.yml");

function extractYamlList(yaml, key) {
    const match = yaml.match(new RegExp(`${key}:\\s*\\[([^\\]]+)\\]`));
    assert.ok(match, `expected ${key}: [...] in workflow YAML`);
    return match[1]
        .split(",")
        .map((item) => item.replace(/["']/g, "").trim())
        .filter(Boolean);
}

function runCli(env) {
    const outFile = path.join(
        os.tmpdir(),
        `pr-ci-scope-${process.pid}-${Math.random().toString(16).slice(2)}.txt`,
    );
    fs.writeFileSync(outFile, "");
    const stdout = execFileSync(process.execPath, [scriptPath], {
        env: { ...process.env, ...env, GITHUB_OUTPUT: outFile },
        encoding: "utf8",
    });
    const written = fs.readFileSync(outFile, "utf8");
    fs.unlinkSync(outFile);
    return { stdout, written };
}

test("PR Node 22 ubuntu does full work plus the single ratchet/fetch", () => {
    const ctx = {
        eventName: "pull_request",
        tsFilter: "true",
        os: "ubuntu-latest",
        version: 22,
    };
    assert.equal(shouldRunBuildTsFull(ctx), true);
    assert.equal(shouldRunBuildTsRatchet(ctx), true);
    assert.equal(shouldRunBuildTsLint(ctx), true);
    assert.equal(shouldFetchPrBase(ctx), true);
    assert.equal(shouldRunShellPackage(ctx), true);
});

test("PR Node 24 cells still build and test; ratchets stay on ubuntu/22", () => {
    for (const os of BUILD_TS_OS) {
        const ctx = {
            eventName: "pull_request",
            tsFilter: "true",
            os,
            version: 24,
        };
        assert.equal(shouldRunBuildTsFull(ctx), true);
        assert.equal(shouldRunBuildTsRatchet(ctx), false);
        assert.equal(shouldFetchPrBase(ctx), false);
    }
});

test("PR still packages the shell on every OS", () => {
    for (const os of BUILD_PACKAGE_SHELL_OS) {
        assert.equal(
            shouldRunShellPackage({
                eventName: "pull_request",
                tsFilter: "true",
                os,
            }),
            true,
        );
    }
});

test("merge_group and push keep full matrix work", () => {
    for (const eventName of ["merge_group", "push", "workflow_dispatch"]) {
        const ts = countScope(eventName, "false");
        assert.equal(ts.tsFull, BUILD_TS_OS.length * BUILD_TS_VERSIONS.length);
        assert.equal(ts.tsRatchet, 0);
        assert.equal(ts.shellPackage, BUILD_PACKAGE_SHELL_OS.length);
    }
});

test("PR with no ts change skips expensive work on every cell", () => {
    const ts = countScope("pull_request", "false");
    assert.equal(ts.tsFull, 0);
    assert.equal(ts.tsRatchet, 0);
    assert.equal(ts.shellPackage, 0);
});

test("unset path-filter output still allows work (matches != 'false')", () => {
    assert.equal(
        shouldRunBuildTsFull({
            eventName: "pull_request",
            tsFilter: "",
            version: 22,
        }),
        true,
    );
});

test("CLI writes GITHUB_OUTPUT for a PR Windows Node 24 cell (full, no ratchet)", () => {
    const { stdout, written } = runCli({
        EVENT_NAME: "pull_request",
        TS_FILTER: "true",
        MATRIX_OS: "windows-latest",
        MATRIX_VERSION: "24",
    });
    const expected = formatGithubOutput(
        resolveScope({
            eventName: "pull_request",
            tsFilter: "true",
            os: "windows-latest",
            version: "24",
        }),
    );
    assert.equal(written, expected);
    assert.equal(stdout, expected);
    assert.match(written, /^full=true$/m);
    assert.match(written, /^ratchet=false$/m);
    assert.match(written, /^package=true$/m);
});

test("CLI writes GITHUB_OUTPUT for a full merge_group cell", () => {
    const { written } = runCli({
        EVENT_NAME: "merge_group",
        TS_FILTER: "false",
        MATRIX_OS: "macos-latest",
        MATRIX_VERSION: "24",
    });
    assert.match(written, /^full=true$/m);
    assert.match(written, /^ratchet=false$/m);
    assert.match(written, /^lint=true$/m);
    assert.match(written, /^package=true$/m);
});

test("shipped workflows call prCiScope and keep required matrix names", () => {
    const buildTs = fs.readFileSync(buildTsYml, "utf8");
    const buildShell = fs.readFileSync(buildPackageShellYml, "utf8");

    assert.match(buildTs, /prCiScope\.mjs/);
    assert.match(buildTs, /steps\.scope\.outputs\.full/);
    assert.match(buildTs, /steps\.scope\.outputs\.ratchet/);
    assert.match(
        buildShell,
        /github\.event_name != 'pull_request' \|\| steps\.filter\.outputs\.ts != 'false'/,
    );

    assert.deepEqual(extractYamlList(buildTs, "os"), BUILD_TS_OS);
    assert.deepEqual(
        extractYamlList(buildTs, "version").map(Number),
        BUILD_TS_VERSIONS,
    );
    assert.deepEqual(extractYamlList(buildShell, "os"), BUILD_PACKAGE_SHELL_OS);

    const fetches = buildTs.match(/git fetch --no-tags origin/g) ?? [];
    assert.equal(
        fetches.length,
        1,
        "PR base must be fetched once, not once per ratchet step",
    );

    const prFull = BUILD_TS_OS.flatMap((os) =>
        BUILD_TS_VERSIONS.map((version) =>
            shouldRunBuildTsFull({
                eventName: "pull_request",
                tsFilter: "true",
                os,
                version,
            }),
        ),
    ).filter(Boolean).length;
    assert.equal(prFull, BUILD_TS_OS.length * BUILD_TS_VERSIONS.length);
    const prRatchet = BUILD_TS_OS.flatMap((os) =>
        BUILD_TS_VERSIONS.map((version) =>
            shouldRunBuildTsRatchet({
                eventName: "pull_request",
                tsFilter: "true",
                os,
                version,
            }),
        ),
    ).filter(Boolean).length;
    assert.equal(prRatchet, 1);
});

test("ADO detect job uses a shallow PR checkout", () => {
    const yaml = fs.readFileSync(azureSmokeYml, "utf8");
    assert.match(
        yaml,
        /job:\s*detect_changes[\s\S]*fetchDepth:\s*2/,
        "detect_changes must not clone full history just to diff HEAD^1",
    );
});
