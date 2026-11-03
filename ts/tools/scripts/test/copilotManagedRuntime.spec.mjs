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
    defaultRuntimeRoot,
    globalCopilotPackageVersion,
    managedRuntimeDirectory,
    npmInstallArgs,
    npmInvocation,
    npmViewArgs,
    readCopilotRuntimeManifest,
    resolveInstalledCopilotPath,
    setupStatePath,
    transientNpmrcContent,
} from "../copilotRuntime.mjs";
import { bundleEntry } from "../bundleUtils.mjs";
import { listedEntryState } from "../../installers/common/register-plugin.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const tsRoot = path.resolve(testDir, "..", "..", "..");

test("managed cache defaults ignore the application asset root", () => {
    const dataHome = path.join(os.tmpdir(), "ta-data-home");
    const appRoot = path.join(os.tmpdir(), "ta-application");
    const env = {
        TYPEAGENT_RUNTIME_ROOT: appRoot,
        LOCALAPPDATA: dataHome,
        XDG_DATA_HOME: dataHome,
    };
    assert.equal(
        defaultRuntimeRoot(env),
        path.join(dataHome, "TypeAgent", "runtimes"),
    );
    assert.equal(
        defaultRuntimeRoot({
            ...env,
            TYPEAGENT_COPILOT_RUNTIME_ROOT: "custom-cache",
        }),
        path.resolve("custom-cache"),
    );
    assert.equal(
        defaultRuntimeRoot({ TYPEAGENT_RUNTIME_ROOT: appRoot }),
        path.join(os.homedir(), ".local", "share", "TypeAgent", "runtimes"),
    );
});

test("bundled runtime helper uses a separate managed cache and verifies startup", async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ta-copilot-bundle-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const appRoot = path.join(root, "agent-server");
    const dataHome = path.join(root, "profile");
    const runtimeRoot = path.join(dataHome, "TypeAgent", "runtimes");
    const manifest = createCopilotRuntimeManifest({
        platform: process.platform,
        arch: process.arch,
    });
    const packageDir = path.join(
        managedRuntimeDirectory(manifest, runtimeRoot),
        "node_modules",
        ...manifest.platformPackage.split("/"),
    );
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
        path.join(packageDir, "package.json"),
        JSON.stringify({
            name: manifest.platformPackage,
            version: manifest.platformVersion,
        }),
    );
    const executable = path.join(packageDir, manifest.executablePath);
    const runtimeLibrary = path.join(packageDir, manifest.runtimeLibraryPath);
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, "fixture executable");
    fs.writeFileSync(runtimeLibrary, "fixture library");

    const sdkDir = path.join(appRoot, "node_modules", "@github", "copilot-sdk");
    fs.mkdirSync(sdkDir, { recursive: true });
    fs.writeFileSync(
        path.join(sdkDir, "package.json"),
        JSON.stringify({ type: "module", exports: "./index.js" }),
    );
    fs.writeFileSync(
        path.join(sdkDir, "index.js"),
        `import fs from "node:fs";
function record(stage) {
    fs.appendFileSync(process.env.TEST_RUNTIME_EVENTS, stage + "\\n");
    if (process.env.TEST_RUNTIME_FAILURE === stage) {
        throw new Error("Runtime verification failed at " + stage);
    }
}
export const RuntimeConnection = { forStdio: (options) => ({ kind: "stdio", ...options }) };
export class CopilotClient {
    constructor(options) {
        if (options.connection.path !== process.env.TEST_RUNTIME_EXECUTABLE) {
            throw new Error("Wrong managed runtime selected");
        }
    }
    async start() { record("start"); }
    async getStatus() { record("status"); return { version: "${manifest.runtimeVersion}", protocolVersion: 3 }; }
    async getAuthStatus() { record("auth"); return { isAuthenticated: false }; }
    async listModels() { throw new Error("Model access is not required"); }
    async stop() { record("stop"); }
}`,
    );
    fs.writeFileSync(
        path.join(appRoot, "copilot-runtime.json"),
        JSON.stringify(manifest),
    );
    const helper = path.join(appRoot, "tools", "copilotRuntime.mjs");
    await bundleEntry({
        entryPoint: path.join(tsRoot, "tools", "scripts", "copilotRuntime.mjs"),
        outfile: helper,
        runtimeRootFromOutput: "../",
    });
    const events = path.join(root, "events.txt");
    const env = {
        ...process.env,
        LOCALAPPDATA: dataHome,
        XDG_DATA_HOME: dataHome,
        TEST_RUNTIME_EVENTS: events,
        TEST_RUNTIME_EXECUTABLE: executable,
    };
    delete env.TYPEAGENT_RUNTIME_ROOT;
    delete env.TYPEAGENT_COPILOT_RUNTIME_ROOT;
    delete env.TEST_RUNTIME_FAILURE;
    const invoke = (args, overrides = {}) =>
        spawnSync(process.execPath, [helper, ...args], {
            encoding: "utf8",
            env: { ...env, ...overrides },
            timeout: 30_000,
        });
    const readEvents = () => fs.readFileSync(events, "utf8").trim().split("\n");

    await t.test(
        "bundle banner does not redirect default cache discovery",
        () => {
            const result = invoke(["path"]);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(result.stdout.trim(), executable);
            assert.equal(
                fs.existsSync(
                    path.join(
                        appRoot,
                        "node_modules",
                        manifest.platformPackage,
                    ),
                ),
                false,
            );
        },
    );
    await t.test("dedicated cache setting overrides platform defaults", () => {
        const result = invoke(["path"], {
            LOCALAPPDATA: path.join(root, "unused-profile"),
            XDG_DATA_HOME: path.join(root, "unused-profile"),
            TYPEAGENT_COPILOT_RUNTIME_ROOT: runtimeRoot,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), executable);
    });
    await t.test("explicit cache argument overrides the environment", () => {
        const result = invoke(["path", "--runtime-root", runtimeRoot], {
            TYPEAGENT_COPILOT_RUNTIME_ROOT: path.join(root, "unused-cache"),
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), executable);
    });
    for (const flag of ["--runtime-only", "--skip-login"]) {
        await t.test(
            `${flag} verifies startup without querying auth or models`,
            () => {
                fs.writeFileSync(events, "");
                const result = invoke(["setup", flag, "--non-interactive"]);
                assert.equal(result.status, 0, result.stderr);
                assert.match(result.stdout, /runtime startup verified/);
                assert.deepEqual(readEvents(), ["start", "status", "stop"]);
            },
        );
    }
    for (const stage of ["start", "status"]) {
        await t.test(
            `failed ${stage} reports incomplete setup and stops the client`,
            () => {
                fs.writeFileSync(events, "");
                const result = invoke(
                    ["setup", "--runtime-only", "--non-interactive"],
                    { TEST_RUNTIME_FAILURE: stage },
                );
                assert.equal(result.status, 1, result.stderr);
                assert.match(result.stderr, /Runtime verification failed/);
                assert.doesNotMatch(result.stdout, /runtime startup verified/);
                assert.deepEqual(
                    readEvents(),
                    stage === "start"
                        ? ["start", "stop"]
                        : ["start", "status", "stop"],
                );
            },
        );
    }
    await t.test("normal setup still requires sign-in", () => {
        fs.writeFileSync(events, "");
        const result = invoke(["setup", "--non-interactive"]);
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /sign-in is required/);
        assert.deepEqual(readEvents(), ["start", "status", "auth", "stop"]);
        const state = JSON.parse(
            fs.readFileSync(setupStatePath(runtimeRoot), "utf8"),
        );
        assert.equal(state.status, "auth-required");
    });
});

test("manifest records the resolved SDK-compatible Windows runtime", () => {
    const manifest = createCopilotRuntimeManifest({
        platform: "win32",
        arch: "x64",
    });
    assert.equal(manifest.sdkPackage, "@github/copilot-sdk");
    assert.equal(manifest.sdkVersion, "1.0.13");
    assert.equal(manifest.runtimeVersion, "1.0.83");
    assert.equal(manifest.runtimePlatform, "win32-x64");
    assert.equal(manifest.platformPackage, "@github/copilot-sdk-win32-x64");
    assert.equal(manifest.platformVersion, manifest.sdkVersion);
    assert.equal(
        manifest.executablePath,
        "prebuilds/win32-x64/copilot-runtime.exe",
    );
    assert.equal(
        manifest.runtimeLibraryPath,
        "prebuilds/win32-x64/runtime.node",
    );
    assert.match(manifest.registry, /^https:\/\/pkgs\.dev\.azure\.com\//);
});

test("platform package naming follows Copilot package conventions", () => {
    assert.equal(
        copilotPlatformPackage("win32", "x64"),
        "@github/copilot-sdk-win32-x64",
    );
    assert.equal(
        copilotPlatformPackage("darwin", "arm64"),
        "@github/copilot-sdk-darwin-arm64",
    );
    assert.equal(
        copilotPlatformPackage("linuxmusl", "x64"),
        "@github/copilot-sdk-linuxmusl-x64",
    );
    assert.throws(
        () => copilotPlatformPackage("win32", "ia32"),
        /Unsupported Copilot runtime architecture/,
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
    assert.ok(
        args.includes(
            `${manifest.platformPackage}@${manifest.platformVersion}`,
        ),
    );
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
        const runtimeDir = managedRuntimeDirectory(manifest, root);
        const packageDir = path.join(
            runtimeDir,
            "node_modules",
            ...manifest.platformPackage.split("/"),
        );
        fs.mkdirSync(packageDir, { recursive: true });
        fs.writeFileSync(
            path.join(packageDir, "package.json"),
            JSON.stringify({
                name: manifest.platformPackage,
                version: manifest.platformVersion,
            }),
        );
        const prebuildDir = path.join(packageDir, "prebuilds", "win32-x64");
        fs.mkdirSync(prebuildDir, { recursive: true });
        const executable = path.join(prebuildDir, "copilot-runtime.exe");
        const runtimeLibrary = path.join(prebuildDir, "runtime.node");
        fs.writeFileSync(executable, "");
        assert.equal(
            resolveInstalledCopilotPath(runtimeDir, manifest),
            undefined,
        );
        fs.writeFileSync(runtimeLibrary, "");
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

test("global Copilot compatibility uses npm package metadata", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ta-copilot-global-"));
    try {
        const packageDir = path.join(root, "@github", "copilot");
        fs.mkdirSync(packageDir, { recursive: true });
        fs.writeFileSync(
            path.join(packageDir, "package.json"),
            JSON.stringify({
                name: "@github/copilot",
                version: "1.0.83",
            }),
        );
        assert.equal(globalCopilotPackageVersion(root), "1.0.83");
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
    assert.match(
        prereqs,
        /if \(\$LASTEXITCODE -ne 0\) \{\s*Write-Log "  WARNING: Copilot runtime setup is incomplete\.[^\n]*\s*return \$null/,
    );
    assert.match(prereqs, /exit 0\s*$/);
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
