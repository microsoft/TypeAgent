// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(testDir, "..");

function withDeploy(run) {
    const deployDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "ta-copilot-prune-"),
    );
    try {
        run(deployDir);
    } finally {
        fs.rmSync(deployDir, { recursive: true, force: true });
    }
}

function packageDirectory(deployDir, packageName) {
    return path.join(deployDir, "node_modules", ...packageName.split("/"));
}

function addPackage(deployDir, packageName) {
    const directory = packageDirectory(deployDir, packageName);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "package.json"), "{}");
    return directory;
}

function runScript(scriptName, args) {
    const result = spawnSync(
        process.execPath,
        [path.join(scriptsDir, scriptName), ...args],
        { encoding: "utf8" },
    );
    assert.equal(
        result.status,
        0,
        `${scriptName} failed:\n${result.stderr || result.stdout}`,
    );
}

test("external CLI pruning removes the SDK runtime but keeps the SDK", () => {
    withDeploy((deployDir) => {
        const sdk = addPackage(deployDir, "@github/copilot-sdk");
        const runtime = addPackage(deployDir, "@github/copilot-sdk-win32-x64");

        runScript("pruneSdkBinaries.mjs", ["--dir", deployDir]);

        assert.ok(fs.existsSync(sdk));
        assert.ok(!fs.existsSync(runtime));
    });
});

test("normal deploy pruning keeps the target SDK runtime", () => {
    withDeploy((deployDir) => {
        const target = addPackage(deployDir, "@github/copilot-sdk-win32-x64");
        const foreign = addPackage(deployDir, "@github/copilot-sdk-linux-x64");

        runScript("pruneDeploy.mjs", [
            "--dir",
            deployDir,
            "--platform",
            "win32",
            "--arch",
            "x64",
        ]);

        assert.ok(fs.existsSync(target));
        assert.ok(!fs.existsSync(foreign));
    });
});

test("connect-only shell pruning removes every SDK runtime package", () => {
    withDeploy((deployDir) => {
        const sdk = addPackage(deployDir, "@github/copilot-sdk");
        const windowsRuntime = addPackage(
            deployDir,
            "@github/copilot-sdk-win32-x64",
        );
        const macRuntime = addPackage(
            deployDir,
            "@github/copilot-sdk-darwin-arm64",
        );

        runScript("prune-shell-deploy.mjs", [deployDir]);

        assert.ok(fs.existsSync(sdk));
        assert.ok(!fs.existsSync(windowsRuntime));
        assert.ok(!fs.existsSync(macRuntime));
    });
});
