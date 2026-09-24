#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
export const copilotVersionTimeoutMs = 10_000;
export const copilotCommandTimeoutMs = 120_000;

function parseArgs(argv) {
    const opts = {
        installDir: process.cwd(),
        pluginSourceDir: "",
        marketplaceName: "typeagent-local",
        marketplaceRoot: path.join(
            getCopilotHome(),
            "marketplaces",
            "typeagent-local",
        ),
        pluginName: "typeagent",
        pluginDescription: "TypeAgent integration for Copilot CLI",
        pluginVersion: "",
        uninstall: false,
        logPath: "",
        copilotPath: "",
    };

    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--install-dir") opts.installDir = argv[++i];
        else if (a === "--plugin-source-dir") opts.pluginSourceDir = argv[++i];
        else if (a === "--marketplace-name") opts.marketplaceName = argv[++i];
        else if (a === "--marketplace-root") opts.marketplaceRoot = argv[++i];
        else if (a === "--plugin-name") opts.pluginName = argv[++i];
        else if (a === "--plugin-description")
            opts.pluginDescription = argv[++i];
        else if (a === "--plugin-version") opts.pluginVersion = argv[++i];
        else if (a === "--log-path") opts.logPath = argv[++i];
        else if (a === "--copilot-path") opts.copilotPath = argv[++i];
        else if (a === "--uninstall") opts.uninstall = true;
        else if (a === "--help") {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${a}`);
        }
    }

    opts.installDir = path.resolve(opts.installDir);
    if (!opts.pluginSourceDir) {
        opts.pluginSourceDir = path.join(opts.installDir, "copilot-plugin");
    } else {
        opts.pluginSourceDir = path.resolve(opts.pluginSourceDir);
    }
    opts.marketplaceRoot = path.resolve(opts.marketplaceRoot);

    return opts;
}

function printHelp() {
    console.log(
        [
            "Usage: node register-plugin.mjs [options]",
            "",
            "Options:",
            "  --install-dir <path>",
            "  --plugin-source-dir <path>",
            "  --marketplace-name <name>",
            "  --marketplace-root <path>",
            "  --plugin-name <name>",
            "  --plugin-description <text>",
            "  --plugin-version <version>",
            "  --copilot-path <path-or-command>",
            "  --log-path <path>",
            "  --uninstall",
            "  --help",
        ].join("\n"),
    );
}

function createLogger(logPath) {
    const resolvedLog = logPath ? path.resolve(logPath) : "";
    if (resolvedLog) {
        fs.mkdirSync(path.dirname(resolvedLog), { recursive: true });
        fs.writeFileSync(resolvedLog, "", "utf8");
    }

    const write = (line) => {
        const formatted = `[${new Date().toISOString()}] ${line}`;
        console.log(formatted);
        if (resolvedLog) {
            fs.appendFileSync(resolvedLog, `${formatted}\n`, "utf8");
        }
    };

    return { write, logPath: resolvedLog };
}

function getCopilotHome() {
    return path.resolve(
        process.env.COPILOT_HOME ?? path.join(os.homedir(), ".copilot"),
    );
}

function findListedEntry(output, identifier) {
    return output.split(/\r?\n/).find((line) => {
        const entry = line.trim().replace(/^[^A-Za-z0-9_.@-]+/, "");
        return entry.split(/\s+/, 1)[0] === identifier;
    });
}

function hasListedEntry(output, identifier) {
    return findListedEntry(output, identifier) !== undefined;
}

export function listedEntryState(output, identifier) {
    const entry = findListedEntry(output, identifier);
    if (!entry) return "absent";
    return /\(disabled\)/i.test(entry) ? "disabled" : "enabled";
}

function quoteCmdArgument(value) {
    return `"${value.replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

function resolveWindowsLauncher(copilotPath) {
    const resolveCandidate = (candidate) => {
        if (path.extname(candidate) !== "") return candidate;
        return (
            [".exe", ".cmd", ".bat", ".ps1"]
                .map((extension) => `${candidate}${extension}`)
                .find((withExtension) => fs.existsSync(withExtension)) ??
            candidate
        );
    };

    const directCandidate = resolveCandidate(copilotPath);
    if (directCandidate !== copilotPath || path.isAbsolute(copilotPath)) {
        return directCandidate;
    }

    const where = spawnSync("where.exe", [copilotPath], {
        encoding: "utf8",
        timeout: copilotVersionTimeoutMs,
    });
    if (where.status !== 0) return copilotPath;
    for (const line of where.stdout.split(/\r?\n/)) {
        const candidate = line.trim();
        if (candidate) return resolveCandidate(candidate);
    }
    return copilotPath;
}

function runBoundedProcess(command, args, { timeout, ...options }) {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            ...options,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        let error;
        child.stdout.setEncoding("utf8").on("data", (data) => {
            stdout += data;
        });
        child.stderr.setEncoding("utf8").on("data", (data) => {
            stderr += data;
        });
        const timer = setTimeout(() => {
            error = Object.assign(
                new Error(`Copilot command timed out after ${timeout} ms`),
                { code: "ETIMEDOUT" },
            );
            // Kill the launcher and its children before closing inherited pipes.
            if (process.platform === "win32" && child.pid) {
                const killed = spawnSync(
                    "taskkill.exe",
                    ["/PID", String(child.pid), "/T", "/F"],
                    { timeout: 5_000, windowsHide: true, encoding: "utf8" },
                );
                if (killed.error || killed.status !== 0) {
                    stderr += `\nCould not terminate Copilot process tree: ${killed.error?.message ?? killed.stderr}`;
                }
            }
            child.kill("SIGKILL");
            child.stdout.destroy();
            child.stderr.destroy();
            child.unref();
            resolve({ stdout, stderr, status: null, error });
        }, timeout);
        child.on("error", (cause) => {
            error = cause;
        });
        child.on("close", (status) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, status, error });
        });
    });
}

function spawnCopilot(copilotPath, args, timeout) {
    const launcherPath =
        process.platform === "win32"
            ? resolveWindowsLauncher(copilotPath)
            : copilotPath;
    if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(launcherPath)) {
        const commandLine = [
            "call",
            quoteCmdArgument(launcherPath),
            ...args.map(quoteCmdArgument),
        ].join(" ");
        return runBoundedProcess(
            process.env.ComSpec ?? "cmd.exe",
            ["/d", "/s", "/c", commandLine],
            {
                encoding: "utf8",
                shell: false,
                timeout,
                windowsVerbatimArguments: true,
            },
        );
    }
    if (process.platform === "win32" && /\.ps1$/i.test(launcherPath)) {
        return runBoundedProcess(
            "powershell.exe",
            [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                launcherPath,
                ...args,
            ],
            {
                encoding: "utf8",
                shell: false,
                timeout,
            },
        );
    }
    return runBoundedProcess(launcherPath, args, {
        encoding: "utf8",
        shell: false,
        timeout,
    });
}

function discoverPathCopilots(platform = process.platform, env = process.env) {
    const command = platform === "win32" ? "where.exe" : "which";
    const args = platform === "win32" ? ["copilot"] : ["-a", "copilot"];
    const result = spawnSync(command, args, {
        encoding: "utf8",
        env,
        shell: false,
        timeout: copilotVersionTimeoutMs,
    });
    if (result.status !== 0) return [];
    return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

export function isVsCodeCopilotShimPath(
    candidate,
    env = process.env,
    platform = process.platform,
) {
    const pathApi = platform === "win32" ? path.win32 : path;
    const shimRoot = env.APPDATA
        ? pathApi.join(
              env.APPDATA,
              "Code",
              "User",
              "globalStorage",
              "github.copilot-chat",
              "copilotCli",
          )
        : "";
    const paths = [candidate, shimRoot].map((value) => {
        try {
            const resolved =
                platform === process.platform
                    ? fs.realpathSync(value)
                    : pathApi.resolve(value);
            return platform === "win32" ? resolved.toLowerCase() : resolved;
        } catch {
            const resolved = pathApi.resolve(value);
            return platform === "win32" ? resolved.toLowerCase() : resolved;
        }
    });
    return (
        shimRoot !== "" &&
        (paths[0] === paths[1] ||
            paths[0].startsWith(`${paths[1]}${pathApi.sep}`))
    );
}

export function copilotCandidates({
    copilotPath = "",
    env = process.env,
    platform = process.platform,
    pathCopilot = discoverPathCopilots(platform, env),
} = {}) {
    const candidates = [];
    const add = (source, candidate) => {
        if (candidate?.trim()) candidates.push({ source, path: candidate });
    };
    const addAll = (source, candidateOrCandidates) => {
        for (const candidate of Array.isArray(candidateOrCandidates)
            ? candidateOrCandidates
            : [candidateOrCandidates]) {
            add(source, candidate);
        }
    };

    add("COPILOT_CLI_PATH", env.COPILOT_CLI_PATH);
    add("supplied PATH candidate", copilotPath);
    addAll("current PATH", pathCopilot);
    if (platform === "win32") {
        if (env.APPDATA) {
            add(
                "npm fallback",
                path.win32.join(env.APPDATA, "npm", "copilot.cmd"),
            );
            add(
                "npm fallback",
                path.win32.join(env.APPDATA, "npm", "copilot.ps1"),
            );
        }
        if (env.LOCALAPPDATA) {
            add(
                "WinGet fallback",
                path.win32.join(
                    env.LOCALAPPDATA,
                    "Microsoft",
                    "WinGet",
                    "Links",
                    "copilot.exe",
                ),
            );
        }
    }

    const seen = new Set();
    return candidates.filter(({ path: candidate }) => {
        const key = platform === "win32" ? candidate.toLowerCase() : candidate;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export async function resolveCopilotCli({
    copilotPath = "",
    logger,
    env = process.env,
    platform = process.platform,
    pathCopilot,
    probe = (candidate) =>
        spawnCopilot(candidate, ["--version"], copilotVersionTimeoutMs),
} = {}) {
    const candidates = copilotCandidates({
        copilotPath,
        env,
        platform,
        ...(pathCopilot === undefined ? {} : { pathCopilot }),
    });

    for (const candidate of candidates) {
        logger.write(
            `Considering Copilot CLI (${candidate.source}): ${candidate.path}`,
        );
        if (isVsCodeCopilotShimPath(candidate.path, env, platform)) {
            logger.write(`Rejected VS Code Copilot shim: ${candidate.path}`);
            continue;
        }

        const result = await probe(candidate.path);
        if (result.error?.code === "ETIMEDOUT") {
            logger.write(
                `Copilot CLI validation timed out after ${copilotVersionTimeoutMs} ms: ${candidate.path}`,
            );
            continue;
        }
        if (result.error) {
            logger.write(
                `Copilot CLI validation failed for ${candidate.path}: ${result.error.message}`,
            );
            continue;
        }
        if (result.status !== 0) {
            logger.write(
                `Copilot CLI validation failed with exit code ${result.status}: ${candidate.path}`,
            );
            continue;
        }

        logger.write(`Selected Copilot CLI: ${candidate.path}`);
        return candidate.path;
    }

    throw new Error("No working GitHub Copilot CLI was found.");
}

export async function runCopilot(
    copilotPath,
    args,
    logger,
    allowFailure = false,
    timeout = copilotCommandTimeoutMs,
) {
    logger.write(`Running: ${copilotPath} ${args.join(" ")}`);
    const res = await spawnCopilot(copilotPath, args, timeout);

    const stdout = res.stdout || "";
    const stderr = res.stderr || "";
    for (const line of stdout.split(/\r?\n/)) {
        if (line.trim()) logger.write(`copilot> ${line}`);
    }
    for (const line of stderr.split(/\r?\n/)) {
        if (line.trim()) logger.write(`copilot! ${line}`);
    }

    if (res.error) {
        const message = `Copilot invocation failed: ${res.error.message}`;
        logger.write(message);
        if (!allowFailure) throw new Error(message);
        return { output: `${stdout}\n${stderr}`, status: 1, failed: true };
    }

    const reportedFailure =
        /(?:^|\n)(?:Failed to|Error: Request .* failed)/im.test(
            `${stdout}\n${stderr}`,
        );
    if (!allowFailure && (res.status !== 0 || reportedFailure)) {
        throw new Error(
            `Copilot command exited with code ${res.status}: ${copilotPath} ${args.join(" ")}`,
        );
    }

    return {
        output: `${stdout}\n${stderr}`,
        status: res.status ?? 1,
        failed: res.status !== 0 || reportedFailure,
    };
}

function ensureLocalPluginMarketplace({
    marketplaceRoot,
    marketplaceName,
    pluginName,
    pluginSourceDir,
    pluginDescription,
    pluginVersion,
    logger,
}) {
    const manifestDir = path.join(marketplaceRoot, ".github", "plugin");
    const manifestPath = path.join(manifestDir, "marketplace.json");
    const pluginsRoot = path.join(marketplaceRoot, "plugins");
    const marketplacePluginDir = path.join(pluginsRoot, pluginName);

    fs.mkdirSync(manifestDir, { recursive: true });
    fs.mkdirSync(pluginsRoot, { recursive: true });

    if (fs.existsSync(marketplacePluginDir)) {
        fs.rmSync(marketplacePluginDir, { recursive: true, force: true });
    }
    fs.cpSync(pluginSourceDir, marketplacePluginDir, { recursive: true });

    let manifest = null;
    if (fs.existsSync(manifestPath)) {
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        } catch {
            logger.write(
                "Existing marketplace.json is invalid JSON; recreating.",
            );
            manifest = null;
        }
    }

    if (!manifest || typeof manifest !== "object") {
        manifest = {
            name: marketplaceName,
            owner: { name: "Microsoft" },
            metadata: {
                description: "Local TypeAgent plugin marketplace",
                version: "1.0.0",
            },
            plugins: [],
        };
    }

    const plugins = Array.isArray(manifest.plugins) ? manifest.plugins : [];
    manifest.plugins = plugins.filter((p) => p?.name !== pluginName);
    manifest.plugins.push({
        name: pluginName,
        description: pluginDescription,
        version: pluginVersion,
        source: `plugins/${pluginName}`,
    });

    manifest.name = marketplaceName;
    if (!manifest.owner || !manifest.owner.name) {
        manifest.owner = { name: "Microsoft" };
    }
    if (!manifest.metadata) {
        manifest.metadata = {};
    }
    if (!manifest.metadata.description) {
        manifest.metadata.description = "Local TypeAgent plugin marketplace";
    }
    if (!manifest.metadata.version) {
        manifest.metadata.version = "1.0.0";
    }

    fs.writeFileSync(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
    );
    return manifestPath;
}

function resolvePluginMetadata(opts) {
    const pluginJsonPath = path.join(opts.pluginSourceDir, "plugin.json");
    const pluginMcpServer = path.join(
        opts.pluginSourceDir,
        "dist",
        "mcp",
        "server.js",
    );

    if (!fs.existsSync(pluginJsonPath)) {
        throw new Error(`Plugin source missing plugin.json: ${pluginJsonPath}`);
    }
    if (!fs.existsSync(pluginMcpServer)) {
        throw new Error(
            `Plugin source missing MCP server entrypoint: ${pluginMcpServer}`,
        );
    }

    let pluginVersion = opts.pluginVersion;
    let pluginDescription = opts.pluginDescription;
    try {
        const manifest = JSON.parse(fs.readFileSync(pluginJsonPath, "utf8"));
        if (!pluginVersion && typeof manifest.version === "string") {
            pluginVersion = manifest.version;
        }
        if (
            (!pluginDescription ||
                pluginDescription ===
                    "TypeAgent integration for Copilot CLI") &&
            typeof manifest.description === "string" &&
            manifest.description.trim()
        ) {
            pluginDescription = manifest.description;
        }
    } catch {
        // Keep defaults if plugin.json metadata parsing fails.
    }

    if (!pluginVersion) {
        pluginVersion = "0.0.1";
    }

    return { pluginVersion, pluginDescription };
}

function getInstalledMarketplaceRoot(opts) {
    return path.join(
        getCopilotHome(),
        "installed-plugins",
        opts.marketplaceName,
    );
}

function getInstalledSnapshot(opts) {
    return path.join(getInstalledMarketplaceRoot(opts), opts.pluginName);
}

function removeInstalledSnapshot(opts, logger) {
    const installedSnapshot = getInstalledSnapshot(opts);
    if (!fs.existsSync(installedSnapshot)) return;
    logger.write(`Removing previous plugin snapshot: ${installedSnapshot}`);
    fs.rmSync(installedSnapshot, { recursive: true, force: true });
}

async function retryUpdateFromCleanSnapshot(opts, logger, pluginIdentifier) {
    const installedSnapshot = getInstalledSnapshot(opts);
    const backupRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), `${opts.pluginName}-plugin-backup-`),
    );
    const backupSnapshot = path.join(backupRoot, opts.pluginName);
    fs.cpSync(installedSnapshot, backupSnapshot, { recursive: true });

    try {
        removeInstalledSnapshot(opts, logger);
        cleanFailedInstallArtifacts(opts, logger);
        try {
            await runCopilot(
                opts.copilotPath,
                ["plugin", "update", pluginIdentifier],
                logger,
            );
        } catch (error) {
            logger.write(
                "The clean-snapshot update failed; restoring the previous plugin snapshot.",
            );
            if (fs.existsSync(installedSnapshot)) {
                fs.rmSync(installedSnapshot, {
                    recursive: true,
                    force: true,
                });
            }
            fs.cpSync(backupSnapshot, installedSnapshot, { recursive: true });
            throw error;
        }
    } finally {
        fs.rmSync(backupRoot, { recursive: true, force: true });
    }
}

function cleanFailedInstallArtifacts(opts, logger) {
    const installedRoot = getInstalledMarketplaceRoot(opts);
    if (!fs.existsSync(installedRoot)) return;
    for (const entry of fs.readdirSync(installedRoot)) {
        if (!entry.startsWith(`.${opts.pluginName}.tmp-`)) continue;
        logger.write(`Removing failed-install artifact: ${entry}`);
        fs.rmSync(path.join(installedRoot, entry), {
            recursive: true,
            force: true,
        });
    }
}

async function migrateMarketplaceRegistration(opts, logger) {
    const marketplaces = await runCopilot(
        opts.copilotPath,
        ["plugin", "marketplace", "list"],
        logger,
    );
    const registeredMarketplace = findListedEntry(
        marketplaces.output,
        opts.marketplaceName,
    );
    if (!registeredMarketplace) return false;
    if (
        registeredMarketplace
            .toLowerCase()
            .includes(opts.marketplaceRoot.toLowerCase())
    ) {
        return true;
    }

    logger.write(
        `Replacing marketplace '${opts.marketplaceName}' with ${opts.marketplaceRoot}.`,
    );
    const plugins = await runCopilot(
        opts.copilotPath,
        ["plugin", "list"],
        logger,
    );
    if (
        hasListedEntry(
            plugins.output,
            `${opts.pluginName}@${opts.marketplaceName}`,
        )
    ) {
        if (process.platform === "win32") {
            removeInstalledSnapshot(opts, logger);
        }
        await runCopilot(
            opts.copilotPath,
            ["plugin", "uninstall", opts.pluginName],
            logger,
            true,
        );
    }
    await runCopilot(
        opts.copilotPath,
        ["plugin", "marketplace", "remove", opts.marketplaceName],
        logger,
    );
    return false;
}

async function installPlugin(opts, logger) {
    const { pluginVersion, pluginDescription } = resolvePluginMetadata(opts);
    logger.write(`Plugin source ready: ${opts.pluginSourceDir}`);
    cleanFailedInstallArtifacts(opts, logger);
    const marketplaceRegistered = await migrateMarketplaceRegistration(
        opts,
        logger,
    );

    const manifestPath = ensureLocalPluginMarketplace({
        marketplaceRoot: opts.marketplaceRoot,
        marketplaceName: opts.marketplaceName,
        pluginName: opts.pluginName,
        pluginSourceDir: opts.pluginSourceDir,
        pluginDescription,
        pluginVersion,
        logger,
    });
    logger.write(`Marketplace manifest updated: ${manifestPath}`);

    if (!marketplaceRegistered) {
        await runCopilot(
            opts.copilotPath,
            ["plugin", "marketplace", "add", opts.marketplaceRoot],
            logger,
        );
    }

    await runCopilot(
        opts.copilotPath,
        ["plugin", "marketplace", "update", opts.marketplaceName],
        logger,
    );

    const pluginListResult = await runCopilot(
        opts.copilotPath,
        ["plugin", "list"],
        logger,
    );
    const pluginIdentifier = `${opts.pluginName}@${opts.marketplaceName}`;
    const pluginState = listedEntryState(
        pluginListResult.output,
        pluginIdentifier,
    );
    if (pluginState === "enabled") {
        const update = await runCopilot(
            opts.copilotPath,
            ["plugin", "update", pluginIdentifier],
            logger,
            true,
        );
        if (update.failed) {
            const windowsAccessDenied =
                process.platform === "win32" &&
                /(?:Access is denied|os error 5)/i.test(update.output);
            if (!windowsAccessDenied) {
                throw new Error(`Plugin update failed: '${pluginIdentifier}'.`);
            }
            logger.write(
                "Copilot could not replace its Windows snapshot; removing the locked snapshot and retrying the update.",
            );
            await retryUpdateFromCleanSnapshot(opts, logger, pluginIdentifier);
        }
    } else {
        if (pluginState === "disabled") {
            logger.write(
                `Plugin '${pluginIdentifier}' is available but disabled; installing it to enable the plugin.`,
            );
        }
        await runCopilot(
            opts.copilotPath,
            ["plugin", "install", pluginIdentifier],
            logger,
        );
    }

    const verifyListResult = await runCopilot(
        opts.copilotPath,
        ["plugin", "list"],
        logger,
    );
    const verifiedState = listedEntryState(
        verifyListResult.output,
        pluginIdentifier,
    );
    if (verifiedState !== "enabled") {
        throw new Error(
            `Plugin verification failed: '${pluginIdentifier}' is ${verifiedState}.`,
        );
    }

    logger.write("Plugin registration complete.");
}

async function uninstallPlugin(opts, logger) {
    logger.write("Uninstall mode: removing plugin and marketplace.");
    await runCopilot(
        opts.copilotPath,
        ["plugin", "uninstall", opts.pluginName],
        logger,
        true,
    );
    await runCopilot(
        opts.copilotPath,
        ["plugin", "marketplace", "remove", opts.marketplaceName],
        logger,
        true,
    );
    logger.write("Uninstall mode completed.");
}

async function main() {
    const opts = parseArgs(process.argv);
    const logger = createLogger(opts.logPath);

    logger.write("TypeAgent register-plugin starting.");
    logger.write(`InstallDir: ${opts.installDir}`);
    logger.write(`PluginSourceDir: ${opts.pluginSourceDir}`);
    logger.write(`MarketplaceRoot: ${opts.marketplaceRoot}`);
    logger.write(`Uninstall: ${opts.uninstall}`);

    try {
        opts.copilotPath = await resolveCopilotCli({
            copilotPath: opts.copilotPath,
            logger,
        });

        if (opts.uninstall) {
            await uninstallPlugin(opts, logger);
        } else {
            await installPlugin(opts, logger);
        }
    } catch (error) {
        logger.write(
            `Registration failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
    }

    process.exit(0);
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
    try {
        await main();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[TypeAgent] Registration failed: ${message}`);
        process.exit(1);
    }
}
