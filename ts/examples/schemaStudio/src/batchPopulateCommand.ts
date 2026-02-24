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
import { readFileSync, writeFileSync, existsSync } from "fs";
import {
    getAllActionConfigProvider,
    loadAgentJsonTranslator,
    createSchemaInfoProvider,
    getCacheFactory,
    TypeAgentTranslator,
    ActionConfigProvider,
    ActionConfig,
    ComposeSchemaOptions,
} from "agent-dispatcher/internal";
import { getDefaultAppAgentProviders } from "default-agent-provider";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    AgentCache,
    RequestAction,
    createExecutableAction,
    getFullActionName,
} from "agent-cache";
import { GenerateSchemaOptions } from "@typeagent/action-schema";

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
    bgGreen: "\x1b[42m\x1b[30m",
    bgRed: "\x1b[41m\x1b[97m",
    bgYellow: "\x1b[43m\x1b[30m",
};

interface BatchResult {
    prompt: string;
    schemaName: string;
    translatedAction: string;
    translated: boolean;
    explained: boolean;
    explanation: string;
    cacheHitAfter: boolean;
    cacheHitBefore: boolean;
    errorMessage?: string;
}

interface TranslatorEntry {
    schemaName: string;
    translator: TypeAgentTranslator;
    actionConfig: ActionConfig;
}

export function createBatchPopulateCommand(
    studio: SchemaStudio,
): CommandHandler {
    // Cached state for reuse across invocations
    let _provider: ActionConfigProvider | undefined;
    let _schemaNames: string[] | undefined;
    let _translators: Map<string, TranslatorEntry> | undefined;
    let _cache: AgentCache | undefined;

    const argDef = defineArgs();
    const handler: CommandHandler = handleCommand;
    handler.metadata = argDef;
    return handler;

    function defineArgs(): CommandMetadata {
        return {
            description:
                "Batch-populate the cache from a file of user prompts. " +
                "Each prompt is translated via LLM and explained into " +
                "the cache, then verified for generalizability.",
            args: {
                file: {
                    description:
                        "Path to a text file with one user prompt per line",
                },
            },
            options: {
                batchSize: {
                    description:
                        "Number of prompts to process in each batch",
                    defaultValue: 5,
                    type: "integer",
                },
                newCache: {
                    description:
                        "If true, create a fresh cache instead of reusing",
                    defaultValue: false,
                    type: "boolean",
                },
                schema: {
                    description:
                        "Schema name(s) to use for translation " +
                        '(comma-separated, e.g. "player,calendar"). ' +
                        "Defaults to all.",
                },
                output: {
                    description: "Path to write the CSV report",
                    defaultValue: "batchPopulate_report.csv",
                },
                cacheFile: {
                    description:
                        "Path to a JSON file for persisting the construction cache. " +
                        "If the file exists and --newCache is false, it will be loaded. " +
                        "The cache is saved to this file after processing.",
                },
            },
        };
    }

    async function ensureProvider(): Promise<{
        provider: ActionConfigProvider;
        schemaNames: string[];
    }> {
        if (_provider && _schemaNames) {
            return { provider: _provider, schemaNames: _schemaNames };
        }
        const instanceDir = getInstanceDir();
        const result = await getAllActionConfigProvider(
            getDefaultAppAgentProviders(instanceDir),
        );
        _provider = result.provider;
        _schemaNames = result.schemaNames;
        return result;
    }

    function getTranslator(
        schemaName: string,
        provider: ActionConfigProvider,
        allSchemaNames: string[],
    ): TranslatorEntry {
        if (_translators?.has(schemaName)) {
            return _translators.get(schemaName)!;
        }
        if (!_translators) {
            _translators = new Map();
        }

        const actionConfig = provider.getActionConfig(schemaName);

        // Build the list of action configs, including injected schemas
        const actionConfigs: ActionConfig[] = [actionConfig];
        const switchActionConfigs: ActionConfig[] = [];
        for (const config of provider.getActionConfigs()) {
            if (config.schemaName === schemaName) continue;
            if (!allSchemaNames.includes(config.schemaName)) continue;
            if (config.injected) {
                actionConfigs.push(config);
            } else {
                switchActionConfigs.push(config);
            }
        }

        const composeOptions: ComposeSchemaOptions = {
            activity: false,
            multiple: false,
        };
        const generateOptions: GenerateSchemaOptions = { exact: true };

        // Reuses the exact same translator pipeline as the dispatcher
        const translator = loadAgentJsonTranslator(
            actionConfigs,
            switchActionConfigs,
            provider,
            composeOptions,
            generateOptions,
        );

        const entry: TranslatorEntry = {
            schemaName,
            translator,
            actionConfig,
        };
        _translators.set(schemaName, entry);
        return entry;
    }

    async function ensureCache(
        provider: ActionConfigProvider,
        useNewCache: boolean,
        cacheFilePath?: string,
    ): Promise<AgentCache> {
        if (_cache && !useNewCache) {
            return _cache;
        }
        const cacheFactory = getCacheFactory();
        const schemaInfoProvider = createSchemaInfoProvider(provider);
        _cache = cacheFactory.create(undefined, schemaInfoProvider);

        // Try to load an existing cache file if provided
        if (
            cacheFilePath &&
            !useNewCache &&
            existsSync(cacheFilePath)
        ) {
            await _cache.constructionStore.load(cacheFilePath);
        } else {
            // Initialize a fresh construction store
            await _cache.constructionStore.newCache(cacheFilePath);
        }
        return _cache;
    }

    async function saveCache(): Promise<void> {
        if (_cache) {
            const filePath = _cache.constructionStore.getFilePath();
            if (filePath) {
                await _cache.constructionStore.save(filePath);
            }
        }
    }

    async function translatePrompt(
        prompt: string,
        entries: TranslatorEntry[],
    ): Promise<{
        schemaName: string;
        actionName: string;
        parameters?: Record<string, unknown> | undefined;
    } | null> {
        // Try each translator until one succeeds
        for (const entry of entries) {
            const result = await entry.translator.translate(prompt);
            if (result.success) {
                const action = result.data;

                // Handle "additionalActionLookup" — the translator
                // is redirecting to a different schema group.
                // Re-translate with the target schema's translator.
                if (action.actionName === "additionalActionLookup") {
                    const params = action.parameters as {
                        schemaName?: string;
                        request?: string;
                    } | undefined;
                    const targetSchema = params?.schemaName;
                    const targetRequest = params?.request ?? prompt;
                    if (targetSchema) {
                        const targetEntry = entries.find(
                            (e) => e.schemaName === targetSchema,
                        );
                        if (targetEntry) {
                            const retryResult =
                                await targetEntry.translator.translate(
                                    targetRequest,
                                );
                            if (retryResult.success) {
                                const retryAction = retryResult.data;
                                const retrySchema =
                                    targetEntry.translator.getSchemaName(
                                        retryAction.actionName,
                                    ) ?? targetSchema;
                                return {
                                    schemaName: retrySchema,
                                    actionName: retryAction.actionName,
                                    parameters:
                                        retryAction.parameters ??
                                        undefined,
                                };
                            }
                        }
                    }
                }

                const resolvedSchema =
                    entry.translator.getSchemaName(action.actionName) ??
                    entry.schemaName;
                return {
                    schemaName: resolvedSchema,
                    actionName: action.actionName,
                    parameters: action.parameters ?? undefined,
                };
            }
        }
        return null;
    }

    async function handleCommand(
        args: string[],
        io: InteractiveIo,
    ): Promise<CommandResult> {
        const namedArgs = parseNamedArguments(args, argDef);
        const filePath: string = namedArgs.file;
        const batchSize: number = namedArgs.batchSize;
        const useNewCache: boolean = namedArgs.newCache;
        const outputPath: string = namedArgs.output;
        const schemaFilter: string | undefined = namedArgs.schema;
        const cacheFilePath: string | undefined = namedArgs.cacheFile;

        if (!filePath) {
            io.writer.writeLine(
                "Error: Please provide a file path as the first argument.",
            );
            io.writer.writeLine(
                '  Usage: @batchPopulate "path/to/prompts.txt"',
            );
            return;
        }

        // Read input file
        let prompts: string[];
        try {
            prompts = readFileSync(filePath, "utf-8")
                .split("\n")
                .map((line) => line.trim())
                .filter(
                    (line) => line.length > 0 && !line.startsWith("#"),
                );
        } catch (err: any) {
            io.writer.writeLine(`Error reading file: ${err.message}`);
            return;
        }

        if (prompts.length === 0) {
            io.writer.writeLine("No prompts found in file.");
            return;
        }

        io.writer.writeLine(`Found ${prompts.length} prompt(s) in file.`);

        // Initialize provider and schemas
        io.writer.writeLine("Loading action schemas...");
        const { provider, schemaNames: allSchemaNames } =
            await ensureProvider();

        // Determine which schemas to use
        let targetSchemas: string[];
        if (schemaFilter) {
            targetSchemas = schemaFilter
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            // Validate
            for (const s of targetSchemas) {
                if (!allSchemaNames.includes(s)) {
                    io.writer.writeLine(
                        `Warning: schema "${s}" not found. ` +
                            `Available: ${allSchemaNames.join(", ")}`,
                    );
                }
            }
            targetSchemas = targetSchemas.filter((s) =>
                allSchemaNames.includes(s),
            );
        } else {
            targetSchemas = allSchemaNames.filter(
                (s) =>
                    !s.startsWith("system.") &&
                    !s.startsWith("dispatcher."),
            );
        }

        if (targetSchemas.length === 0) {
            io.writer.writeLine("No valid schemas selected.");
            return;
        }

        io.writer.writeLine(`Schemas: ${targetSchemas.join(", ")}`);

        // Build translators (reuses dispatcher's translation pipeline)
        io.writer.writeLine("Creating translators...");
        const translatorEntries: TranslatorEntry[] = [];
        for (const schema of targetSchemas) {
            try {
                translatorEntries.push(
                    getTranslator(schema, provider, allSchemaNames),
                );
            } catch (err: any) {
                io.writer.writeLine(
                    `  Warning: skipping schema "${schema}": ${err.message}`,
                );
            }
        }

        if (translatorEntries.length === 0) {
            io.writer.writeLine(
                "No translators could be created.",
            );
            return;
        }

        // Initialize cache
        const cache = await ensureCache(
            provider,
            useNewCache,
            cacheFilePath,
        );

        const cacheLabel = cacheFilePath
            ? useNewCache
                ? `new → ${cacheFilePath}`
                : existsSync(cacheFilePath)
                  ? `loaded from ${cacheFilePath}`
                  : `new → ${cacheFilePath}`
            : useNewCache
              ? "new (in-memory)"
              : "current (in-memory)";
        io.writer.writeLine(
            `Batch size: ${batchSize} | Cache: ${cacheLabel}`,
        );
        io.writer.writeLine("");

        // Process in batches
        const results: BatchResult[] = [];
        const totalBatches = Math.ceil(prompts.length / batchSize);
        const startTime = Date.now();

        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
            const batchStart = batchIdx * batchSize;
            const batchEnd = Math.min(
                batchStart + batchSize,
                prompts.length,
            );
            const batch = prompts.slice(batchStart, batchEnd);

            io.writer.writeLine(
                `${c.bold}${c.cyan}--- Batch ${batchIdx + 1}/${totalBatches} ` +
                    `(items ${batchStart + 1}-${batchEnd}) ---${c.reset}`,
            );

            for (const prompt of batch) {
                const result: BatchResult = {
                    prompt,
                    schemaName: "",
                    translatedAction: "",
                    translated: false,
                    explained: false,
                    explanation: "",
                    cacheHitAfter: false,
                    cacheHitBefore: false,
                };

                try {
                    // Step 0: Check the cache before translating.
                    // If we already have a construction that matches,
                    // skip the expensive LLM translation + explanation.
                    let preMatch: import("agent-cache").MatchResult[] =
                        [];
                    try {
                        preMatch = cache.match(prompt);
                    } catch {
                        // match() throws when both stores are
                        // empty/disabled — safe to ignore
                    }
                    if (preMatch.length > 0) {
                        const best = preMatch[0];
                        const action = best.match.actions[0];
                        result.cacheHitBefore = true;
                        result.translated = true;
                        result.explained = true;
                        result.cacheHitAfter = true;
                        result.schemaName =
                            action.action.schemaName;
                        result.translatedAction =
                            getFullActionName(action) +
                            `(${JSON.stringify(action.action.parameters ?? {})})`;
                        result.explanation = "(cached)";
                        results.push(result);

                        io.writer.writeLine(
                            `  ${c.magenta}⚡ CACHED${c.reset}     ${c.white}${result.prompt}${c.reset}`,
                        );
                        io.writer.writeLine(
                            `           ${c.cyan}→ ${result.translatedAction}${c.reset}`,
                        );
                        continue;
                    }

                    // Step 1: Translate the prompt using the same
                    // translator pipeline as the dispatcher
                    const translated = await translatePrompt(
                        prompt,
                        translatorEntries,
                    );

                    if (!translated) {
                        result.errorMessage =
                            "Translation failed for all schemas";
                    } else {
                        result.translated = true;
                        result.schemaName = translated.schemaName;
                        result.translatedAction =
                            `${translated.schemaName}.${translated.actionName}` +
                            `(${JSON.stringify(translated.parameters ?? {})})`;

                        // Step 2: Build a RequestAction and
                        // explain + cache it
                        const executableAction =
                            createExecutableAction(
                                translated.schemaName,
                                translated.actionName,
                                translated.parameters as any,
                            );
                        const requestAction = RequestAction.create(
                            prompt,
                            executableAction,
                        );

                        const processResult =
                            await cache.processRequestAction(
                                requestAction,
                                true, // cache = true
                            );

                        const explResult =
                            processResult.explanationResult;
                        if (explResult.explanation.success) {
                            result.explained = true;
                            // Use toPrettyString if available,
                            // otherwise JSON-stringify the data
                            if (explResult.toPrettyString) {
                                result.explanation =
                                    explResult.toPrettyString(
                                        explResult.explanation
                                            .data,
                                    );
                            } else {
                                result.explanation =
                                    JSON.stringify(
                                        explResult.explanation
                                            .data,
                                    );
                            }
                        } else {
                            result.errorMessage =
                                `Explanation failed: ${explResult.explanation.message}`;
                        }

                        // Step 3: Check if the prompt is now
                        // generalizable via the cache
                        let matchResult:
                            import("agent-cache").MatchResult[] = [];
                        try {
                            matchResult = cache.match(prompt);
                        } catch {
                            // match() throws when both stores are
                            // empty/disabled — safe to ignore
                        }
                        result.cacheHitAfter =
                            matchResult.length > 0;
                    }
                } catch (err: any) {
                    result.errorMessage = err.message;
                }

                results.push(result);

                // Print per-item status with color
                const status = result.cacheHitBefore
                    ? `${c.magenta}⚡ CACHED${c.reset}    `
                    : result.translated
                      ? result.cacheHitAfter
                          ? `${c.green}✓ GENERALIZED${c.reset}`
                          : `${c.yellow}~ TRANSLATED (no cache hit)${c.reset}`
                      : `${c.red}✗ FAILED${c.reset}`;
                io.writer.writeLine(
                    `  ${status}  ${c.white}${result.prompt}${c.reset}`,
                );
                if (result.translatedAction) {
                    io.writer.writeLine(
                        `           ${c.cyan}→ ${result.translatedAction}${c.reset}`,
                    );
                }
                if (result.explanation) {
                    io.writer.writeLine(
                        `           ${c.dim}📝 ${result.explanation}${c.reset}`,
                    );
                }
                if (result.errorMessage) {
                    io.writer.writeLine(
                        `           ${c.red}Error: ${result.errorMessage}${c.reset}`,
                    );
                }
            }
            io.writer.writeLine("");

            // Write CSV report after every batch so partial
            // results survive cancellation or failure
            writeCSVReport(outputPath, results);
        }

        const elapsedMs = Date.now() - startTime;

        // Save cache to disk if a cache file was specified
        await saveCache();
        if (cacheFilePath) {
            io.writer.writeLine(
                `Cache saved to: ${cacheFilePath}`,
            );
        }

        io.writer.writeLine(`CSV report written to: ${outputPath}`);
        io.writer.writeLine("");

        // Print summary
        printSummary(io, results, elapsedMs);

        return `Batch populate completed in ${(elapsedMs / 1000).toFixed(1)}s`;
    }
}

function writeCSVReport(
    outputPath: string,
    results: BatchResult[],
): void {
    const header =
        "Prompt,SchemaName,TranslatedAction,Translated," +
        "Explained,Error";
    // const header =
    //     "Prompt,SchemaName,TranslatedAction,Translated," +
    //     "Explained,Explanation,CacheHitBefore,CacheHitAfter,Error";
    const rows = results.map((r) => {
        const escapeCsv = (s: string) =>
            `"${s.replace(/"/g, '""')}"`;
        return [
            escapeCsv(r.prompt),
            escapeCsv(r.schemaName),
            escapeCsv(r.translatedAction),
            r.translated,
            r.explained,
            // escapeCsv(r.explanation),
            // r.cacheHitBefore,
            // r.cacheHitAfter,
            escapeCsv(r.errorMessage ?? ""),
        ].join(",");
    });
    writeFileSync(outputPath, [header, ...rows].join("\n"), "utf-8");
}

function printSummary(
    io: InteractiveIo,
    results: BatchResult[],
    elapsedMs: number,
): void {
    const total = results.length;
    const translated = results.filter((r) => r.translated).length;
    const explained = results.filter((r) => r.explained).length;
    const cacheHits = results.filter((r) => r.cacheHitAfter).length;
    const cacheSkipped = results.filter((r) => r.cacheHitBefore).length;
    const failed = results.filter((r) => !r.translated).length;

    const pct = (n: number) =>
        total > 0 ? ((n / total) * 100).toFixed(1) : "0.0";

    io.writer.writeLine(`${c.bold}${c.cyan}${"=".repeat(60)}${c.reset}`);
    io.writer.writeLine(`${c.bold}${c.white}  BATCH POPULATE REPORT${c.reset}`);
    io.writer.writeLine(`${c.bold}${c.cyan}${"=".repeat(60)}${c.reset}`);
    io.writer.writeLine(`  Total prompts:          ${c.bold}${total}${c.reset}`);
    if (cacheSkipped > 0) {
        io.writer.writeLine(
            `  Pre-cached (skipped):   ${c.magenta}${cacheSkipped}  (${pct(cacheSkipped)}%)${c.reset}`,
        );
    }
    io.writer.writeLine(
        `  Translated:             ${c.green}${translated}  (${pct(translated)}%)${c.reset}`,
    );
    io.writer.writeLine(
        `  Explained:              ${c.green}${explained}  (${pct(explained)}%)${c.reset}`,
    );
    io.writer.writeLine(
        `  Generalizable (cache):  ${cacheHits > 0 ? c.green : c.yellow}${cacheHits}  (${pct(cacheHits)}%)${c.reset}`,
    );
    io.writer.writeLine(
        `  Failed:                 ${failed > 0 ? c.red : c.green}${failed}  (${pct(failed)}%)${c.reset}`,
    );
    io.writer.writeLine(
        `  Elapsed time:           ${c.dim}${(elapsedMs / 1000).toFixed(1)}s${c.reset}`,
    );
    io.writer.writeLine(`${c.bold}${c.cyan}${"=".repeat(60)}${c.reset}`);

    // Per-schema breakdown
    const schemaMap = new Map<
        string,
        { total: number; cached: number; failed: number }
    >();
    for (const r of results) {
        const key = r.schemaName || "(none)";
        if (!schemaMap.has(key)) {
            schemaMap.set(key, { total: 0, cached: 0, failed: 0 });
        }
        const entry = schemaMap.get(key)!;
        entry.total++;
        if (r.cacheHitAfter) entry.cached++;
        if (!r.translated) entry.failed++;
    }
    if (schemaMap.size > 1) {
        io.writer.writeLine("");
        io.writer.writeLine("  Per-schema breakdown:");
        for (const [schema, stats] of schemaMap) {
            io.writer.writeLine(
                `    ${schema}: ${stats.total} total, ` +
                    `${stats.cached} cached, ` +
                    `${stats.failed} failed`,
            );
        }
    }
}
