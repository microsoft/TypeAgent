#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const defaultArtifactDir =
    path.basename(scriptDir).toLowerCase() === "tools"
        ? path.dirname(scriptDir)
        : path.resolve(scriptDir, "..", "..");

function parseArgs(argv) {
    const options = {
        command: "setup",
        artifactDir: defaultArtifactDir,
        interactive: true,
        login: true,
        deviceCode: false,
        host: "https://github.com",
    };
    let commandSet = false;
    for (let i = 2; i < argv.length; i++) {
        const value = argv[i];
        if (!value.startsWith("-") && !commandSet) {
            options.command = value;
            commandSet = true;
        } else if (value === "--artifact-dir") {
            options.artifactDir = path.resolve(argv[++i]);
        } else if (value === "--manifest") {
            options.manifestPath = path.resolve(argv[++i]);
        } else if (value === "--runtime-root") {
            options.runtimeRoot = path.resolve(argv[++i]);
        } else if (value === "--non-interactive") {
            options.interactive = false;
        } else if (value === "--runtime-only" || value === "--skip-login") {
            options.login = false;
        } else if (value === "--device-code") {
            options.deviceCode = true;
        } else if (value === "--host") {
            options.host = argv[++i];
        } else if (value === "--help") {
            options.command = "help";
        } else {
            throw new Error(`Unknown argument: ${value}`);
        }
    }
    return options;
}

export function readCopilotRuntimeManifest(manifestPath) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const required = [
        "sdkVersion",
        "cliPackage",
        "cliVersion",
        "platformPackage",
        "platformVersion",
        "registry",
        "azureDevOpsResource",
    ];
    for (const key of required) {
        if (typeof manifest[key] !== "string" || manifest[key].length === 0) {
            throw new Error(
                `Invalid Copilot runtime manifest: missing ${key}.`,
            );
        }
    }
    if (manifest.cliVersion !== manifest.platformVersion) {
        throw new Error(
            "Invalid Copilot runtime manifest: CLI and platform versions differ.",
        );
    }
    if (!manifest.registry.startsWith("https://")) {
        throw new Error(
            "Invalid Copilot runtime manifest: registry must use HTTPS.",
        );
    }
    return manifest;
}

export function defaultRuntimeRoot(env = process.env) {
    if (env.TYPEAGENT_COPILOT_RUNTIME_ROOT) {
        return path.resolve(env.TYPEAGENT_COPILOT_RUNTIME_ROOT);
    }
    if (env.TYPEAGENT_RUNTIME_ROOT) {
        return path.resolve(env.TYPEAGENT_RUNTIME_ROOT);
    }
    if (process.platform === "win32" && env.LOCALAPPDATA) {
        return path.join(env.LOCALAPPDATA, "TypeAgent", "runtimes");
    }
    return path.join(
        env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
        "TypeAgent",
        "runtimes",
    );
}

export function managedRuntimeDirectory(manifest, runtimeRoot) {
    return path.join(
        runtimeRoot ?? defaultRuntimeRoot(),
        "copilot",
        manifest.cliVersion,
    );
}

function platformPackageDirectory(runtimeDir, manifest) {
    return path.join(
        runtimeDir,
        "node_modules",
        ...manifest.platformPackage.split("/"),
    );
}

export function resolveInstalledCopilotPath(runtimeDir, manifest) {
    const packageDir = platformPackageDirectory(runtimeDir, manifest);
    const packageJsonPath = path.join(packageDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
        return undefined;
    }
    try {
        const metadata = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        if (
            metadata.name !== manifest.platformPackage ||
            metadata.version !== manifest.platformVersion ||
            typeof metadata.bin !== "object" ||
            metadata.bin === null
        ) {
            return undefined;
        }
        const target = Object.values(metadata.bin).find(
            (value) => typeof value === "string",
        );
        if (typeof target !== "string") {
            return undefined;
        }
        const executable = path.resolve(packageDir, target);
        return fs.existsSync(executable) ? executable : undefined;
    } catch {
        return undefined;
    }
}

function run(command, args, options = {}) {
    const isWindowsShim =
        process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
    return spawnSync(command, args, {
        encoding: options.encoding,
        env: options.env ?? process.env,
        stdio: options.stdio,
        windowsHide: options.windowsHide ?? false,
        shell: isWindowsShim,
    });
}

export function npmInvocation(
    npmCommand,
    platform = process.platform,
    nodeExecutable = process.execPath,
) {
    if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(npmCommand)) {
        return { command: npmCommand, argsPrefix: [] };
    }

    const npmDirectory = path.dirname(npmCommand);
    const npmCli = path.join(
        npmDirectory,
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
    );
    if (!fs.existsSync(npmCli)) {
        throw new Error(`Could not find npm-cli.js next to ${npmCommand}.`);
    }

    const bundledNode = path.join(npmDirectory, "node.exe");
    return {
        command: fs.existsSync(bundledNode) ? bundledNode : nodeExecutable,
        argsPrefix: [npmCli],
    };
}

function resolveCommand(name) {
    const lookup =
        process.platform === "win32"
            ? run("where.exe", [name], { encoding: "utf8" })
            : run("which", [name], { encoding: "utf8" });
    if (lookup.status !== 0) {
        return undefined;
    }
    return lookup.stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find(Boolean);
}

function runNpm(args, options = {}) {
    const npm =
        resolveCommand(process.platform === "win32" ? "npm.cmd" : "npm") ??
        (process.platform === "win32" ? "npm.cmd" : "npm");
    const invocation = npmInvocation(npm);
    return run(
        invocation.command,
        [...invocation.argsPrefix, ...args],
        options,
    );
}

export function globalCopilotPackageVersion(npmRoot) {
    const packageJson = path.join(
        npmRoot,
        "@github",
        "copilot",
        "package.json",
    );
    if (!fs.existsSync(packageJson)) {
        return undefined;
    }
    try {
        const metadata = JSON.parse(fs.readFileSync(packageJson, "utf8"));
        return metadata.name === "@github/copilot" &&
            typeof metadata.version === "string"
            ? metadata.version
            : undefined;
    } catch {
        return undefined;
    }
}

export function npmInstallArgs(manifest, runtimeDir, userconfig) {
    return [
        "install",
        "--prefix",
        runtimeDir,
        "--omit=dev",
        "--no-save",
        "--package-lock=false",
        "--registry",
        manifest.registry,
        "--userconfig",
        userconfig,
        `${manifest.cliPackage}@${manifest.cliVersion}`,
    ];
}

export function transientNpmrcContent(registry, token) {
    const normalized = registry.endsWith("/") ? registry : `${registry}/`;
    const authKey = normalized.replace(/^https:/, "");
    const baseAuthKey = authKey.replace(/registry\/?$/, "");
    return (
        `registry=${normalized}\n` +
        `${baseAuthKey}:_authToken=${token}\n` +
        `${authKey}:_authToken=${token}\n` +
        `${authKey}:always-auth=true\n`
    );
}

function writeTransientNpmrc(registry, token) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ta-npmauth-"));
    const userconfig = path.join(directory, ".npmrc");
    fs.writeFileSync(userconfig, transientNpmrcContent(registry, token), {
        encoding: "utf8",
        mode: 0o600,
    });
    return userconfig;
}

function acquireFeedToken(manifest, interactive) {
    if (process.env.TYPEAGENT_FEED_TOKEN) {
        return process.env.TYPEAGENT_FEED_TOKEN;
    }
    const getToken = () =>
        run(
            process.platform === "win32" ? "az.cmd" : "az",
            [
                "account",
                "get-access-token",
                "--resource",
                manifest.azureDevOpsResource,
                "--output",
                "json",
                "--only-show-errors",
            ],
            { encoding: "utf8", windowsHide: true },
        );

    let result = getToken();
    if (result.status !== 0 && interactive) {
        console.log(
            "TypeAgent package feed sign-in is required before downloading GitHub Copilot.",
        );
        const login = run(
            process.platform === "win32" ? "az.cmd" : "az",
            ["login", "--only-show-errors"],
            { stdio: "inherit" },
        );
        if (login.status === 0) {
            result = getToken();
        }
    }
    if (result.status !== 0) {
        throw new Error(
            "Could not authenticate to the TypeAgent package feed. Install Azure CLI, run 'az login', and retry.",
        );
    }
    try {
        const token = JSON.parse(result.stdout).accessToken;
        if (typeof token === "string" && token.length > 0) {
            return token;
        }
    } catch {}
    throw new Error(
        "Azure CLI did not return a usable TypeAgent package feed token.",
    );
}

export function npmViewArgs(manifest, packageName, version, userconfig) {
    return [
        "view",
        `${packageName}@${version}`,
        "version",
        "--registry",
        manifest.registry,
        "--userconfig",
        userconfig,
    ];
}

function verifyFeedPackage(manifest, packageName, version, userconfig) {
    const result = runNpm(
        npmViewArgs(manifest, packageName, version, userconfig),
        { encoding: "utf8", windowsHide: true },
    );
    if (result.status !== 0 || result.stdout.trim() !== version) {
        const detail = `${result.stderr ?? result.stdout ?? ""}`.trim();
        throw new Error(
            `The TypeAgent package feed could not resolve ${packageName}@${version}${detail ? `: ${detail}` : "."}`,
        );
    }
}

function verifyCopilotRuntimeFeed(manifest, interactive) {
    const token = acquireFeedToken(manifest, interactive);
    const userconfig = writeTransientNpmrc(manifest.registry, token);
    try {
        verifyFeedPackage(
            manifest,
            manifest.cliPackage,
            manifest.cliVersion,
            userconfig,
        );
        verifyFeedPackage(
            manifest,
            manifest.platformPackage,
            manifest.platformVersion,
            userconfig,
        );
        console.log(
            `Verified ${manifest.cliPackage}@${manifest.cliVersion} and ${manifest.platformPackage}@${manifest.platformVersion} through the TypeAgent package feed.`,
        );
    } finally {
        fs.rmSync(path.dirname(userconfig), { recursive: true, force: true });
    }
}

export function setupStatePath(runtimeRoot = defaultRuntimeRoot()) {
    return path.join(path.dirname(runtimeRoot), "setup", "copilot.json");
}

function writeSetupState(runtimeRoot, state) {
    const statePath = setupStatePath(runtimeRoot);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
        statePath,
        `${JSON.stringify({ updatedAt: new Date().toISOString(), ...state }, null, 2)}\n`,
    );
}

export function installManagedCopilotRuntime(
    manifest,
    { runtimeRoot = defaultRuntimeRoot(), interactive = true } = {},
) {
    const finalDirectory = managedRuntimeDirectory(manifest, runtimeRoot);
    const existing = resolveInstalledCopilotPath(finalDirectory, manifest);
    if (existing) {
        return existing;
    }

    const token = acquireFeedToken(manifest, interactive);
    const parent = path.dirname(finalDirectory);
    fs.mkdirSync(parent, { recursive: true });
    const temporaryDirectory = fs.mkdtempSync(
        path.join(parent, `.tmp-${manifest.cliVersion}-`),
    );
    const userconfig = writeTransientNpmrc(manifest.registry, token);
    try {
        console.log(
            `Installing ${manifest.cliPackage}@${manifest.cliVersion} from the TypeAgent package feed...`,
        );
        const result = runNpm(
            npmInstallArgs(manifest, temporaryDirectory, userconfig),
            { stdio: "inherit" },
        );
        if (result.status !== 0) {
            throw new Error(
                `npm exited with code ${result.status ?? "unknown"} while installing the Copilot runtime.`,
            );
        }
        const executable = resolveInstalledCopilotPath(
            temporaryDirectory,
            manifest,
        );
        if (!executable) {
            throw new Error(
                `The TypeAgent feed install did not produce ${manifest.platformPackage}@${manifest.platformVersion}.`,
            );
        }
        const backupDirectory = `${finalDirectory}.backup-${process.pid}-${Date.now()}`;
        let previousMoved = false;
        let adopted = false;
        try {
            if (fs.existsSync(finalDirectory)) {
                fs.renameSync(finalDirectory, backupDirectory);
                previousMoved = true;
            }
            fs.renameSync(temporaryDirectory, finalDirectory);
            adopted = true;
            const installed = resolveInstalledCopilotPath(
                finalDirectory,
                manifest,
            );
            if (!installed) {
                throw new Error(
                    "Installed Copilot runtime could not be verified.",
                );
            }
            if (previousMoved) {
                fs.rmSync(backupDirectory, { recursive: true, force: true });
            }
            writeSetupState(runtimeRoot, {
                status: "installed",
                cliVersion: manifest.cliVersion,
                cliPath: installed,
            });
            return installed;
        } catch (error) {
            if (adopted) {
                fs.rmSync(finalDirectory, { recursive: true, force: true });
            }
            if (previousMoved && fs.existsSync(backupDirectory)) {
                fs.renameSync(backupDirectory, finalDirectory);
            }
            throw error;
        }
    } catch (error) {
        writeSetupState(runtimeRoot, {
            status:
                error instanceof Error && error.message.includes("authenticate")
                    ? "feed-auth-required"
                    : "feed-unavailable",
            cliVersion: manifest.cliVersion,
            message: error instanceof Error ? error.message : String(error),
        });
        throw error;
    } finally {
        fs.rmSync(path.dirname(userconfig), { recursive: true, force: true });
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
}

function resolveExactSystemCopilot(manifest) {
    const explicit =
        process.env.TYPEAGENT_COPILOT_CLI_PATH ?? process.env.COPILOT_CLI_PATH;
    if (explicit && fs.existsSync(explicit)) {
        return explicit;
    }
    const system = resolveCommand("copilot");
    if (!system) {
        return undefined;
    }
    const npmRoot = runNpm(["root", "-g"], {
        encoding: "utf8",
        windowsHide: true,
    });
    if (npmRoot.status !== 0) {
        return undefined;
    }
    return globalCopilotPackageVersion(npmRoot.stdout.trim()) ===
        manifest.cliVersion
        ? system
        : undefined;
}

export function resolveCopilotRuntime(
    manifest,
    { runtimeRoot = defaultRuntimeRoot() } = {},
) {
    return (
        resolveInstalledCopilotPath(
            managedRuntimeDirectory(manifest, runtimeRoot),
            manifest,
        ) ?? resolveExactSystemCopilot(manifest)
    );
}

async function inspectCopilot(executable) {
    let sdk;
    try {
        sdk = await import("@github/copilot-sdk");
    } catch {
        const sourceSdk = path.resolve(
            scriptDir,
            "..",
            "..",
            "packages",
            "agentServer",
            "bundledRuntime",
            "node_modules",
            "@github",
            "copilot-sdk",
            "dist",
            "index.js",
        );
        sdk = await import(pathToFileURL(sourceSdk).href);
    }
    const { CopilotClient, RuntimeConnection } = sdk;
    const client = new CopilotClient({
        connection: RuntimeConnection.forStdio({ path: executable }),
    });
    try {
        await client.start();
        const runtime = await client.getStatus();
        const auth = await client.getAuthStatus();
        const models = auth.isAuthenticated ? await client.listModels() : [];
        return {
            runtime,
            auth,
            models: models.filter(
                (model) => model.policy?.state !== "disabled",
            ),
        };
    } finally {
        await client.stop().catch(() => {});
    }
}

function runLogin(executable, options) {
    const args = ["login"];
    if (options.deviceCode) {
        args.push("--device-code");
    }
    if (options.host && options.host !== "https://github.com") {
        args.push("--host", options.host);
    }
    return run(executable, args, { stdio: "inherit" }).status === 0;
}

async function setupCopilot(manifest, options) {
    const runtimeRoot = options.runtimeRoot ?? defaultRuntimeRoot();
    let executable = resolveCopilotRuntime(manifest, { runtimeRoot });
    if (!executable) {
        executable = installManagedCopilotRuntime(manifest, {
            runtimeRoot,
            interactive: options.interactive,
        });
    }
    console.log(`GitHub Copilot runtime: ${executable}`);

    if (!options.login) {
        return 0;
    }

    let status = await inspectCopilot(executable);
    if (!status.auth.isAuthenticated) {
        if (!options.interactive) {
            writeSetupState(runtimeRoot, {
                status: "auth-required",
                cliVersion: manifest.cliVersion,
                cliPath: executable,
            });
            console.error(
                "GitHub Copilot sign-in is required. Run 'node typeagent-serve.mjs setup --provider copilot'.",
            );
            return 2;
        }
        console.log("Starting GitHub Copilot sign-in...");
        if (!runLogin(executable, options)) {
            writeSetupState(runtimeRoot, {
                status: "auth-cancelled",
                cliVersion: manifest.cliVersion,
                cliPath: executable,
            });
            return 2;
        }
        status = await inspectCopilot(executable);
    }

    if (!status.auth.isAuthenticated) {
        writeSetupState(runtimeRoot, {
            status: "auth-required",
            cliVersion: manifest.cliVersion,
            cliPath: executable,
        });
        console.error("GitHub Copilot still reports as not authenticated.");
        return 2;
    }
    if (status.models.length === 0) {
        writeSetupState(runtimeRoot, {
            status: "model-unavailable",
            cliVersion: manifest.cliVersion,
            cliPath: executable,
            login: status.auth.login,
        });
        console.error(
            "GitHub Copilot authentication succeeded, but no enabled models are available.",
        );
        return 2;
    }

    writeSetupState(runtimeRoot, {
        status: "ready",
        cliVersion: manifest.cliVersion,
        cliPath: executable,
        login: status.auth.login,
        authType: status.auth.authType,
        models: status.models.map((model) => model.id),
    });
    console.log(
        `GitHub Copilot is ready${status.auth.login ? ` for ${status.auth.login}` : ""} (${status.models.length} model${status.models.length === 1 ? "" : "s"} available).`,
    );
    return 0;
}

function printHelp() {
    console.log(
        [
            "Usage: node copilotRuntime.mjs [setup|install|path|status|verify-feed] [options]",
            "",
            "Options:",
            "  --artifact-dir <path>",
            "  --manifest <path>",
            "  --runtime-root <path>",
            "  --runtime-only",
            "  --non-interactive",
            "  --device-code",
            "  --host <github-host>",
        ].join("\n"),
    );
}

async function main() {
    const options = parseArgs(process.argv);
    if (options.command === "help") {
        printHelp();
        return 0;
    }
    const manifestPath =
        options.manifestPath ??
        path.join(options.artifactDir, "copilot-runtime.json");
    const manifest = readCopilotRuntimeManifest(manifestPath);
    const runtimeRoot = options.runtimeRoot ?? defaultRuntimeRoot();

    switch (options.command) {
        case "setup":
            return setupCopilot(manifest, { ...options, runtimeRoot });
        case "install": {
            const executable = installManagedCopilotRuntime(manifest, {
                runtimeRoot,
                interactive: options.interactive,
            });
            console.log(executable);
            return 0;
        }
        case "path": {
            const executable = resolveCopilotRuntime(manifest, { runtimeRoot });
            if (!executable) {
                return 1;
            }
            console.log(executable);
            return 0;
        }
        case "status": {
            const executable = resolveCopilotRuntime(manifest, { runtimeRoot });
            if (!executable) {
                console.log("GitHub Copilot runtime is not installed.");
                return 1;
            }
            const status = await inspectCopilot(executable);
            console.log(
                JSON.stringify(
                    {
                        cliPath: executable,
                        cliVersion: manifest.cliVersion,
                        runtime: status.runtime,
                        auth: status.auth,
                        models: status.models.map((model) => model.id),
                    },
                    null,
                    2,
                ),
            );
            return status.auth.isAuthenticated ? 0 : 2;
        }
        case "verify-feed":
            verifyCopilotRuntimeFeed(manifest, options.interactive);
            return 0;
        default:
            throw new Error(`Unknown command '${options.command}'.`);
    }
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
    main()
        .then((code) => process.exit(code))
        .catch((error) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        });
}
