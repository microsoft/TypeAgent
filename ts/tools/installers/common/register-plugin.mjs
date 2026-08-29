#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
        copilotPath: process.env.COPILOT_CLI_PATH || "copilot",
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

function quoteCmdArgument(value) {
    return `"${value.replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

function spawnCopilot(copilotPath, args) {
    if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(copilotPath)) {
        const commandLine = [
            "call",
            quoteCmdArgument(copilotPath),
            ...args.map(quoteCmdArgument),
        ].join(" ");
        return spawnSync(
            process.env.ComSpec ?? "cmd.exe",
            ["/d", "/s", "/c", commandLine],
            {
                encoding: "utf8",
                shell: false,
                windowsVerbatimArguments: true,
            },
        );
    }
    return spawnSync(copilotPath, args, {
        encoding: "utf8",
        shell: false,
    });
}

function runCopilot(copilotPath, args, logger, allowFailure = false) {
    logger.write(`Running: ${copilotPath} ${args.join(" ")}`);
    const res = spawnCopilot(copilotPath, args);

    if (res.error) {
        if (allowFailure) {
            logger.write(`Copilot invocation failed: ${res.error.message}`);
            return { output: "", status: 1, failed: true };
        }
        throw new Error(`Copilot invocation failed: ${res.error.message}`);
    }

    const stdout = res.stdout || "";
    const stderr = res.stderr || "";
    for (const line of stdout.split(/\r?\n/)) {
        if (line.trim()) logger.write(`copilot> ${line}`);
    }
    for (const line of stderr.split(/\r?\n/)) {
        if (line.trim()) logger.write(`copilot! ${line}`);
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

function removeInstalledSnapshot(opts, logger) {
    const installedSnapshot = path.join(
        getInstalledMarketplaceRoot(opts),
        opts.pluginName,
    );
    if (!fs.existsSync(installedSnapshot)) return;
    logger.write(`Removing previous plugin snapshot: ${installedSnapshot}`);
    fs.rmSync(installedSnapshot, { recursive: true, force: true });
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

function migrateMarketplaceRegistration(opts, logger) {
    const marketplaces = runCopilot(
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
    const plugins = runCopilot(opts.copilotPath, ["plugin", "list"], logger);
    if (
        hasListedEntry(
            plugins.output,
            `${opts.pluginName}@${opts.marketplaceName}`,
        )
    ) {
        if (process.platform === "win32") {
            removeInstalledSnapshot(opts, logger);
        }
        runCopilot(
            opts.copilotPath,
            ["plugin", "uninstall", opts.pluginName],
            logger,
            true,
        );
    }
    runCopilot(
        opts.copilotPath,
        ["plugin", "marketplace", "remove", opts.marketplaceName],
        logger,
    );
    return false;
}

function ensureCopilotAvailable(copilotPath, logger) {
    runCopilot(copilotPath, ["--version"], logger);
}

function installPlugin(opts, logger) {
    const { pluginVersion, pluginDescription } = resolvePluginMetadata(opts);
    logger.write(`Plugin source ready: ${opts.pluginSourceDir}`);
    cleanFailedInstallArtifacts(opts, logger);
    const marketplaceRegistered = migrateMarketplaceRegistration(opts, logger);

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
        runCopilot(
            opts.copilotPath,
            ["plugin", "marketplace", "add", opts.marketplaceRoot],
            logger,
        );
    }

    runCopilot(
        opts.copilotPath,
        ["plugin", "marketplace", "update", opts.marketplaceName],
        logger,
    );

    const pluginListResult = runCopilot(
        opts.copilotPath,
        ["plugin", "list"],
        logger,
    );
    const pluginIdentifier = `${opts.pluginName}@${opts.marketplaceName}`;
    if (hasListedEntry(pluginListResult.output, pluginIdentifier)) {
        const update = runCopilot(
            opts.copilotPath,
            ["plugin", "update", opts.pluginName],
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
                "Copilot could not replace its Windows snapshot; retrying from a clean snapshot.",
            );
            removeInstalledSnapshot(opts, logger);
            cleanFailedInstallArtifacts(opts, logger);
            runCopilot(
                opts.copilotPath,
                ["plugin", "install", pluginIdentifier],
                logger,
            );
        }
    } else {
        runCopilot(
            opts.copilotPath,
            ["plugin", "install", pluginIdentifier],
            logger,
        );
    }

    const verifyListResult = runCopilot(
        opts.copilotPath,
        ["plugin", "list"],
        logger,
    );
    if (!hasListedEntry(verifyListResult.output, pluginIdentifier)) {
        throw new Error(
            `Plugin verification failed: '${pluginIdentifier}' not found in copilot plugin list.`,
        );
    }

    logger.write("Plugin registration complete.");
}

function uninstallPlugin(opts, logger) {
    logger.write("Uninstall mode: removing plugin and marketplace.");
    runCopilot(
        opts.copilotPath,
        ["plugin", "uninstall", opts.pluginName],
        logger,
        true,
    );
    runCopilot(
        opts.copilotPath,
        ["plugin", "marketplace", "remove", opts.marketplaceName],
        logger,
        true,
    );
    logger.write("Uninstall mode completed.");
}

function main() {
    const opts = parseArgs(process.argv);
    const logger = createLogger(opts.logPath);

    logger.write("TypeAgent register-plugin starting.");
    logger.write(`InstallDir: ${opts.installDir}`);
    logger.write(`PluginSourceDir: ${opts.pluginSourceDir}`);
    logger.write(`MarketplaceRoot: ${opts.marketplaceRoot}`);
    logger.write(`Uninstall: ${opts.uninstall}`);

    ensureCopilotAvailable(opts.copilotPath, logger);

    if (opts.uninstall) {
        uninstallPlugin(opts, logger);
    } else {
        installPlugin(opts, logger);
    }

    process.exit(0);
}

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[TypeAgent] Registration failed: ${message}`);
    process.exit(1);
}
