// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandler,
    CommandMetadata,
    CommandResult,
    InteractiveIo,
    parseNamedArguments,
} from "interactive-app";
import { SchemaStudio } from "./studio.js";
import {
    readFileSync,
    writeFileSync,
    existsSync,
    readdirSync,
    statSync,
} from "fs";
import path from "path";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    ConstructionCache,
    loadConstructionCacheFile,
} from "agent-cache";

// ANSI color codes for terminal output
const c = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    white: "\x1b[97m",
    magenta: "\x1b[35m",
    bold: "\x1b[1m",
};

interface SessionCacheInfo {
    sessionName: string;
    fileName: string;
    explainerName: string;
    filePath: string;
    current: boolean;
}

export function createMergeCacheCommand(
    studio: SchemaStudio,
): CommandHandler {
    const argDef = defineArgs();
    const handler: CommandHandler = handleCommand;
    handler.metadata = argDef;
    return handler;

    function defineArgs(): CommandMetadata {
        return {
            description:
                "Merge a batchPopulate cache file into a dispatcher session cache. " +
                "Use --source to specify the batchPopulate cache and --target " +
                "for the session cache. If --target is omitted, the command " +
                "lists available session caches and lets you pick one.",
            options: {
                source: {
                    description:
                        "Path to the source cache JSON file (e.g. from @batchPopulate --cacheFile)",
                },
                target: {
                    description:
                        "Path to the target session cache JSON file. If omitted, " +
                        "auto-discovers session caches from the dispatcher profile.",
                },
                output: {
                    description:
                        "Path to write the merged result. Defaults to overwriting --target.",
                },
                list: {
                    description:
                        "List available session cache files without merging.",
                    defaultValue: false,
                    type: "boolean",
                },
                session: {
                    description:
                        'Session name to use when auto-discovering caches. Defaults to "last".',
                },
                dryRun: {
                    description:
                        "Show what would be merged without writing any files.",
                    defaultValue: false,
                    type: "boolean",
                },
            },
        };
    }

    /**
     * Discover session cache files from the dispatcher profile directory.
     */
    function discoverSessionCaches(
        sessionFilter?: string,
    ): SessionCacheInfo[] {
        const instanceDir = getInstanceDir();
        const sessionsDir = path.join(instanceDir, "sessions");

        if (!existsSync(sessionsDir)) {
            return [];
        }

        // Read sessions.json to find the last session
        let lastSession: string | undefined;
        const sessionsJsonPath = path.join(instanceDir, "sessions.json");
        if (existsSync(sessionsJsonPath)) {
            try {
                const data = JSON.parse(
                    readFileSync(sessionsJsonPath, "utf8"),
                );
                lastSession = data.lastSession;
            } catch {
                // ignore
            }
        }

        // List all session directories
        const sessionDirs = readdirSync(sessionsDir).filter((name) => {
            const fullPath = path.join(sessionsDir, name);
            return statSync(fullPath).isDirectory();
        });

        // Filter to specific session if requested
        let targetSessions: string[];
        if (sessionFilter && sessionFilter !== "last") {
            targetSessions = sessionDirs.filter((s) =>
                s.includes(sessionFilter),
            );
        } else if (sessionFilter === "last" || !sessionFilter) {
            // Default to last session
            targetSessions = lastSession ? [lastSession] : sessionDirs;
        } else {
            targetSessions = sessionDirs;
        }

        const results: SessionCacheInfo[] = [];
        for (const sessionName of targetSessions) {
            const constructionsDir = path.join(
                sessionsDir,
                sessionName,
                "constructions",
            );
            if (!existsSync(constructionsDir)) {
                continue;
            }

            // Read session's data.json to find current cache file
            let sessionCacheData: Record<string, string> = {};
            const dataJsonPath = path.join(
                sessionsDir,
                sessionName,
                "data.json",
            );
            if (existsSync(dataJsonPath)) {
                try {
                    const data = JSON.parse(
                        readFileSync(dataJsonPath, "utf8"),
                    );
                    sessionCacheData = data.cacheData ?? {};
                } catch {
                    // ignore
                }
            }

            const files = readdirSync(constructionsDir).filter(
                (f) => f.endsWith(".json"),
            );
            for (const fileName of files) {
                const filePath = path.join(constructionsDir, fileName);
                try {
                    const cacheJson = JSON.parse(
                        readFileSync(filePath, "utf8"),
                    );
                    const explainerName = cacheJson.explainerName ?? "unknown";
                    const isCurrent =
                        sessionCacheData[explainerName] === fileName;
                    results.push({
                        sessionName,
                        fileName,
                        explainerName,
                        filePath,
                        current: isCurrent,
                    });
                } catch {
                    // skip unparseable files
                }
            }
        }
        return results;
    }

    /**
     * Print a summary of a ConstructionCache.
     */
    function printCacheSummary(
        label: string,
        cache: ConstructionCache,
        io: InteractiveIo,
    ) {
        const namespaces = cache.getConstructionNamespaces();
        let totalConstructions = 0;
        const details: string[] = [];
        for (const ns of namespaces) {
            const nsData = cache.getConstructionNamespace(ns);
            const count = nsData?.constructions.length ?? 0;
            totalConstructions += count;
            // Extract the schema name from the namespace key
            const schemaName = ns.split(",")[0] || ns;
            details.push(`${schemaName}: ${count}`);
        }
        io.writer.writeLine(
            `  ${c.bold}${label}${c.reset}: ${totalConstructions} constructions ` +
            `across ${namespaces.length} namespaces`,
        );
        for (const detail of details) {
            io.writer.writeLine(`    ${c.dim}${detail}${c.reset}`);
        }
    }

    async function handleCommand(
        args: string[],
        io: InteractiveIo,
    ): Promise<CommandResult> {
        const namedArgs = parseNamedArguments(args, argDef);
        const sourcePath: string | undefined = namedArgs.source;
        const targetPath: string | undefined = namedArgs.target;
        const outputPath: string | undefined = namedArgs.output;
        const listOnly: boolean = namedArgs.list;
        const sessionFilter: string | undefined = namedArgs.session;
        const dryRun: boolean = namedArgs.dryRun;

        // --- List mode ---
        if (listOnly) {
            io.writer.writeLine(
                `\n${c.bold}Discovering session caches...${c.reset}`,
            );
            const caches = discoverSessionCaches(sessionFilter);
            if (caches.length === 0) {
                io.writer.writeLine(
                    `${c.yellow}No session cache files found.${c.reset}`,
                );
                return;
            }
            io.writer.writeLine(
                `\nFound ${c.cyan}${caches.length}${c.reset} cache file(s):\n`,
            );
            for (const info of caches) {
                const currentTag = info.current
                    ? ` ${c.green}[CURRENT]${c.reset}`
                    : "";
                io.writer.writeLine(
                    `  ${c.bold}Session:${c.reset} ${info.sessionName}` +
                    `  ${c.bold}Explainer:${c.reset} ${info.explainerName}` +
                    `  ${c.bold}File:${c.reset} ${info.fileName}${currentTag}`,
                );
                io.writer.writeLine(
                    `    ${c.dim}${info.filePath}${c.reset}`,
                );
            }
            return;
        }

        // --- Merge mode ---
        if (!sourcePath) {
            io.writer.writeLine(
                `${c.red}Error: --source is required. ` +
                `Provide the path to the batchPopulate cache JSON file.${c.reset}`,
            );
            return;
        }

        if (!existsSync(sourcePath)) {
            io.writer.writeLine(
                `${c.red}Error: Source file not found: ${sourcePath}${c.reset}`,
            );
            return;
        }

        // Resolve target path
        let resolvedTarget = targetPath;
        if (!resolvedTarget) {
            // Auto-discover: find the current cache file in the last session
            const caches = discoverSessionCaches(sessionFilter);
            const current = caches.find((c) => c.current);
            if (current) {
                resolvedTarget = current.filePath;
                io.writer.writeLine(
                    `${c.cyan}Auto-discovered target:${c.reset} ${resolvedTarget}`,
                );
            } else if (caches.length > 0) {
                // Use the most recently modified file
                const sorted = [...caches].sort((a, b) => {
                    const aStat = statSync(a.filePath);
                    const bStat = statSync(b.filePath);
                    return bStat.mtimeMs - aStat.mtimeMs;
                });
                resolvedTarget = sorted[0].filePath;
                io.writer.writeLine(
                    `${c.yellow}No current cache marked; using most recent:${c.reset} ${resolvedTarget}`,
                );
            } else {
                io.writer.writeLine(
                    `${c.red}Error: No session cache files found. ` +
                    `Use --target to specify explicitly, or run the dispatcher first.${c.reset}`,
                );
                return;
            }
        }

        if (!existsSync(resolvedTarget)) {
            io.writer.writeLine(
                `${c.red}Error: Target file not found: ${resolvedTarget}${c.reset}`,
            );
            return;
        }

        const resolvedOutput = outputPath ?? resolvedTarget;

        io.writer.writeLine(`\n${c.bold}=== Cache Merge ===${c.reset}`);
        io.writer.writeLine(
            `  ${c.bold}Source:${c.reset} ${sourcePath}`,
        );
        io.writer.writeLine(
            `  ${c.bold}Target:${c.reset} ${resolvedTarget}`,
        );
        io.writer.writeLine(
            `  ${c.bold}Output:${c.reset} ${resolvedOutput}`,
        );

        // Load both caches
        io.writer.writeLine(`\n${c.dim}Loading source cache...${c.reset}`);
        const sourceCache = await loadConstructionCacheFile(sourcePath);
        if (!sourceCache) {
            io.writer.writeLine(
                `${c.red}Error: Source cache file is empty.${c.reset}`,
            );
            return;
        }

        io.writer.writeLine(`${c.dim}Loading target cache...${c.reset}`);
        const targetCache = await loadConstructionCacheFile(resolvedTarget);
        if (!targetCache) {
            io.writer.writeLine(
                `${c.red}Error: Target cache file is empty.${c.reset}`,
            );
            return;
        }

        // Print summaries before merge
        io.writer.writeLine(`\n${c.bold}Before merge:${c.reset}`);
        printCacheSummary("Source", sourceCache, io);
        printCacheSummary("Target", targetCache, io);

        // Perform the merge: iterate source constructions and add to target
        let addedCount = 0;
        let mergedCount = 0;
        let skippedCount = 0;

        const sourceNamespaces = sourceCache.getConstructionNamespaces();
        for (const namespace of sourceNamespaces) {
            const nsData = sourceCache.getConstructionNamespace(namespace);
            if (!nsData) continue;

            // Split namespace back into keys (joined with |)
            const namespaceKeys = namespace.split("|");

            for (const construction of nsData.constructions) {
                const result = targetCache.addConstruction(
                    namespaceKeys,
                    construction,
                    false, // mergeMatchSets
                    false, // cacheConflicts
                );

                if (result.added) {
                    addedCount++;
                } else if (result.existing.length > 0) {
                    mergedCount++;
                } else {
                    skippedCount++;
                }
            }
        }

        // Print merge results
        io.writer.writeLine(`\n${c.bold}Merge results:${c.reset}`);
        io.writer.writeLine(
            `  ${c.green}Added:${c.reset}   ${addedCount} new constructions`,
        );
        io.writer.writeLine(
            `  ${c.yellow}Merged:${c.reset}  ${mergedCount} (already existed, kept existing)`,
        );
        if (skippedCount > 0) {
            io.writer.writeLine(
                `  ${c.dim}Skipped: ${skippedCount}${c.reset}`,
            );
        }

        // Print summary after merge
        io.writer.writeLine(`\n${c.bold}After merge:${c.reset}`);
        printCacheSummary("Result", targetCache, io);

        // Write output
        if (dryRun) {
            io.writer.writeLine(
                `\n${c.yellow}Dry run — no files written.${c.reset}`,
            );
        } else {
            const jsonOutput = JSON.stringify(targetCache.toJSON(), null, 2);
            writeFileSync(resolvedOutput, jsonOutput, "utf8");
            io.writer.writeLine(
                `\n${c.green}Merged cache written to: ${resolvedOutput}${c.reset}`,
            );
        }

        io.writer.writeLine("");
    }
}
