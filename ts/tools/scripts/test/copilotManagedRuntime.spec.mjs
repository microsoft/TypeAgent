// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    copilotPlatformPackage,
    createCopilotRuntimeManifest,
} from "../copilotRuntimeManifest.mjs";
import {
    globalCopilotPackageVersion,
    managedRuntimeDirectory,
    npmInstallArgs,
    npmInvocation,
    npmViewArgs,
    readCopilotRuntimeManifest,
    resolveInstalledCopilotPath,
    transientNpmrcContent,
} from "../copilotRuntime.mjs";
import { listedEntryState } from "../../installers/common/register-plugin.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const tsRoot = path.resolve(testDir, "..", "..", "..");

test("manifest records the resolved SDK-compatible Windows runtime", () => {
    const manifest = createCopilotRuntimeManifest({
        platform: "win32",
        arch: "x64",
    });
    assert.equal(manifest.sdkPackage, "@github/copilot-sdk");
    assert.equal(manifest.sdkVersion, "1.0.9");
    assert.equal(manifest.sdkCliRequirement, "^1.0.78");
    assert.equal(manifest.cliPackage, "@github/copilot");
    assert.equal(manifest.cliVersion, "1.0.79");
    assert.equal(manifest.platformPackage, "@github/copilot-win32-x64");
    assert.equal(manifest.platformVersion, manifest.cliVersion);
    assert.match(manifest.registry, /^https:\/\/pkgs\.dev\.azure\.com\//);
});

test("platform package naming follows Copilot package conventions", () => {
    assert.equal(
        copilotPlatformPackage("win32", "x64"),
        "@github/copilot-win32-x64",
    );
    assert.equal(
        copilotPlatformPackage("darwin", "arm64"),
        "@github/copilot-darwin-arm64",
    );
});

test("npm install is exact and locked to the authenticated feed", () => {
    const manifest = createCopilotRuntimeManifest({
        platform: "win32",
        arch: "x64",
    });
    const args = npmInstallArgs(manifest, "C:\\runtime", "C:\\auth\\.npmrc");
    assert.deepEqual(args.slice(0, 3), ["install", "--prefix", "C:\\runtime"]);
    assert.ok(args.includes("--registry"));
    assert.ok(args.includes(manifest.registry));
    assert.ok(args.includes("--userconfig"));
    assert.ok(args.includes("C:\\auth\\.npmrc"));
    assert.ok(args.includes(`@github/copilot@${manifest.cliVersion}`));
    assert.ok(!args.includes("-g"));
});

test("Windows npm shims run through node without shell parsing", () => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "TypeAgent Program Files "),
    );
    try {
        const npmCommand = path.join(root, "nodejs", "npm.cmd");
        const nodeExecutable = path.join(root, "nodejs", "node.exe");
        const npmCli = path.join(
            root,
            "nodejs",
            "node_modules",
            "npm",
            "bin",
            "npm-cli.js",
        );
        fs.mkdirSync(path.dirname(npmCli), { recursive: true });
        fs.writeFileSync(npmCommand, "");
        fs.writeFileSync(nodeExecutable, "");
        fs.writeFileSync(npmCli, "");

        assert.deepEqual(npmInvocation(npmCommand, "win32", "fallback.exe"), {
            command: nodeExecutable,
            argsPrefix: [npmCli],
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("transient npm config pins the registry and scopes the token", () => {
    const registry =
        "https://pkgs.dev.azure.com/org/project/_packaging/feed/npm/registry/";
    const contents = transientNpmrcContent(registry, "token-value");
    assert.match(contents, /^registry=https:\/\/pkgs\.dev\.azure\.com\//);
    assert.match(
        contents,
        /\n\/\/pkgs\.dev\.azure\.com\/org\/project\/_packaging\/feed\/npm\/:_authToken=token-value/,
    );
    assert.match(
        contents,
        /\n\/\/pkgs\.dev\.azure\.com\/org\/project\/_packaging\/feed\/npm\/registry\/:_authToken=token-value/,
    );
    assert.doesNotMatch(contents, /\nhttps:.*_authToken/);
});

test("feed verification resolves both exact packages through the configured registry", () => {
    const manifest = createCopilotRuntimeManifest({
        platform: "win32",
        arch: "x64",
    });
    const args = npmViewArgs(
        manifest,
        manifest.platformPackage,
        manifest.platformVersion,
        "C:\\auth\\.npmrc",
    );
    assert.deepEqual(args.slice(0, 3), [
        "view",
        `${manifest.platformPackage}@${manifest.platformVersion}`,
        "version",
    ]);
    assert.ok(args.includes(manifest.registry));
    assert.ok(args.includes("C:\\auth\\.npmrc"));
});

test("managed runtime resolves the platform executable only at the exact version", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ta-copilot-test-"));
    try {
        const manifest = createCopilotRuntimeManifest({
            platform: "win32",
            arch: "x64",
        });

        test("global Copilot compatibility uses npm package metadata", () => {
            const root = fs.mkdtempSync(
                path.join(os.tmpdir(), "ta-copilot-global-"),
            );
            try {
                const packageDir = path.join(root, "@github", "copilot");
                fs.mkdirSync(packageDir, { recursive: true });
                fs.writeFileSync(
                    path.join(packageDir, "package.json"),
                    JSON.stringify({
                        name: "@github/copilot",
                        version: "1.0.79",
                    }),
                );
                assert.equal(globalCopilotPackageVersion(root), "1.0.79");
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        });
        const runtimeDir = managedRuntimeDirectory(manifest, root);
        const packageDir = path.join(
            runtimeDir,
            "node_modules",
            "@github",
            "copilot-win32-x64",
        );
        fs.mkdirSync(packageDir, { recursive: true });
        fs.writeFileSync(
            path.join(packageDir, "package.json"),
            JSON.stringify({
                name: manifest.platformPackage,
                version: manifest.platformVersion,
                bin: { "copilot-win32-x64": "copilot.exe" },
            }),
        );
        const executable = path.join(packageDir, "copilot.exe");
        fs.writeFileSync(executable, "");
        assert.equal(
            resolveInstalledCopilotPath(runtimeDir, manifest),
            executable,
        );

        const manifestPath = path.join(root, "copilot-runtime.json");
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
        assert.deepEqual(readCopilotRuntimeManifest(manifestPath), manifest);

        const wrong = { ...manifest, platformVersion: "9.9.9" };
        assert.equal(resolveInstalledCopilotPath(runtimeDir, wrong), undefined);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("installer integration uses managed setup without adding UI properties", () => {
    const prereqs = fs.readFileSync(
        path.join(tsRoot, "tools", "installers", "wix", "install-prereqs.ps1"),
        "utf8",
    );
    const wix = fs.readFileSync(
        path.join(
            tsRoot,
            "tools",
            "installers",
            "wix",
            "TypeAgent-AgentServer.wxs",
        ),
        "utf8",
    );
    const standalone = fs.readFileSync(
        path.join(tsRoot, "tools", "scripts", "install-typeagent.ps1"),
        "utf8",
    );
    const bootstrap = fs.readFileSync(
        path.join(tsRoot, "tools", "scripts", "setup-typeagent-prereqs.ps1"),
        "utf8",
    );
    const artifactBuilders = ["bundleAgentServer.mjs", "deployAgentServer.mjs"]
        .map((file) =>
            fs.readFileSync(
                path.join(tsRoot, "tools", "scripts", file),
                "utf8",
            ),
        )
        .join("\n");
    assert.match(
        prereqs,
        /setup --provider copilot --runtime-only --non-interactive/,
    );
    assert.doesNotMatch(
        prereqs,
        /Install-Cli\s+"copilot"\s+"@github\/copilot"/,
    );
    assert.match(wix, /-Provider &quot;\[PROVIDER\]&quot;/);
    assert.doesNotMatch(wix, /Property Id="COPILOTRUNTIME"/);
    assert.match(
        wix,
        /Custom Action="LaunchCopilotSetup"\s+After="InstallFinalize"/,
    );
    assert.match(
        wix,
        /\(NOT Installed\) AND \(PROVIDER="COPILOT"\) AND \(UILevel &gt;= 4\)/,
    );
    assert.doesNotMatch(standalone, /npm install -g ["']?@github\/copilot/);
    assert.doesNotMatch(bootstrap, /npm install -g/);
    assert.doesNotMatch(artifactBuilders, /copilot must be on PATH/);
    assert.match(artifactBuilders, /copilot-runtime\.json/);
});

test("deployed launcher dispatches the Copilot setup command", () => {
    const launcher = path.join(
        tsRoot,
        "tools",
        "scripts",
        "typeagent-serve.mjs",
    );
    const result = spawnSync(
        process.execPath,
        [launcher, "setup", "--provider", "invalid"],
        { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(
        result.stderr,
        /Setup currently supports only '--provider copilot'/,
    );
    assert.doesNotMatch(result.stderr, /cmdSetup is not defined/);
});

test("plugin registration distinguishes disabled marketplace entries", () => {
    const identifier = "typeagent@typeagent-local";
    assert.equal(listedEntryState("", identifier), "absent");
    assert.equal(
        listedEntryState(
            `  • ${identifier} (v0.0.1) (disabled)\n      from C:\\marketplace`,
            identifier,
        ),
        "disabled",
    );
    assert.equal(
        listedEntryState(
            `  • ${identifier} (v0.0.1) (enabled)\n      from C:\\marketplace`,
            identifier,
        ),
        "enabled",
    );
});
