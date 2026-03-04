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
import { readFileSync, writeFileSync } from "fs";
import {
    getAllActionConfigProvider,
    initializeGeolocation,
    ActionConfigProvider,
    ActionConfig,
} from "agent-dispatcher/internal";
import { getDefaultAppAgentProviders } from "default-agent-provider";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    Grammar,
    grammarFromJson,
    NFA,
    compileGrammarToNFA,
    matchGrammarWithNFA,
    type NFAGrammarMatchResult,
} from "action-grammar";

// ANSI color codes for terminal output
const c = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    white: "\x1b[97m",
    bold: "\x1b[1m",
    yellow: "\x1b[33m",
};

interface GrammarCheckResult {
    prompt: string;
    matched: boolean;
    matchedSchema: string;
    matchedAction: string;
    errorMessage?: string;
}

interface CompiledGrammar {
    schemaName: string;
    grammar: Grammar;
    nfa: NFA;
}

export function createBatchGrammarCheckCommand(
    _studio: SchemaStudio,
): CommandHandler {
    let _provider: ActionConfigProvider | undefined;
    let _schemaNames: string[] | undefined;

    const argDef = defineArgs();
    const handler: CommandHandler = handleCommand;
    handler.metadata = argDef;
    return handler;

    function defineArgs(): CommandMetadata {
        return {
            description:
                "Check whether prompts from a file match the compiled action " +
                "grammar for selected schemas. No LLM calls are made — " +
                "matching is done purely via the NFA grammar engine.",
            args: {
                file: {
                    description:
                        "Path to a text file with one user prompt per line",
                },
            },
            options: {
                schema: {
                    description:
                        "Schema name(s) to check against " +
                        '(comma-separated, e.g. "player,calendar"). ' +
                        'Supports wildcards, e.g. "excel*,calendar". ' +
                        "Overrides --skip filter. Defaults to all schemas that have a grammar file.",
                },
                skip: {
                    description:
                        "Comma-delimited list of schema names to skip. " +
                        'Supports wildcards, e.g. "browser.*,system.*".',
                },
                output: {
                    description: "Path to write the CSV report",
                    defaultValue: "batchGrammarCheck_report.csv",
                },
                limit: {
                    description:
                        "The maximum number of prompts to process from the file.",
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

    function loadGrammarForConfig(
        actionConfig: ActionConfig,
    ): Grammar | undefined {
        try {
            const grammarField = actionConfig.grammarFile;
            if (grammarField === undefined) return undefined;
            const content =
                typeof grammarField === "function"
                    ? grammarField()
                    : grammarField;
            if ((content as any).format !== "ag") return undefined;
            return grammarFromJson(JSON.parse((content as any).content));
        } catch {
            return undefined;
        }
    }

    async function handleCommand(
        args: string[],
        io: InteractiveIo,
    ): Promise<CommandResult> {
        const namedArgs = parseNamedArguments(args, argDef);
        const filePath: string = namedArgs.file;
        const outputPath: string = namedArgs.output;
        const schemaFilter: string | undefined = namedArgs.schema;
        const skipFilter: string | undefined = namedArgs.skip;
        const limit: number | undefined = namedArgs.limit;

        if (!filePath) {
            io.writer.writeLine(
                "Error: Please provide a file path as the first argument.",
            );
            io.writer.writeLine(
                '  Usage: @batchGrammarCheck "path/to/prompts.txt"',
            );
            return;
        }

        // Read input file
        let prompts: string[];
        try {
            prompts = readFileSync(filePath, "utf-8")
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0 && !line.startsWith("#"));
        } catch (err: any) {
            io.writer.writeLine(`Error reading file: ${err.message}`);
            return;
        }

        if (prompts.length === 0) {
            io.writer.writeLine("No prompts found in file.");
            return;
        }

        if (limit !== undefined) {
            prompts = prompts.slice(0, limit);
        }

        io.writer.writeLine(`Found ${prompts.length} prompt(s) in file.`);

        // Initialize provider and schemas
        io.writer.writeLine("Loading action schemas...");
        const [{ provider, schemaNames: allSchemaNames }] = await Promise.all([
            ensureProvider(),
            initializeGeolocation(),
        ]);

        // Start with base schemas (exclude system and dispatcher by default)
        let targetSchemas = allSchemaNames.filter(
            (s) => !s.startsWith("system.") && !s.startsWith("dispatcher."),
        );

        // Apply skip filter first
        if (skipFilter) {
            const skipPatterns = skipFilter
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
                .map((pattern) => {
                    const escaped = pattern
                        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
                        .replace(/\*/g, ".*")
                        .replace(/\?/g, ".");
                    return new RegExp(`^${escaped}$`, "i");
                });
            const before = targetSchemas.length;
            targetSchemas = targetSchemas.filter(
                (s) => !skipPatterns.some((re) => re.test(s)),
            );
            const skipped = before - targetSchemas.length;
            if (skipped > 0) {
                io.writer.writeLine(
                    `Skipped ${skipped} schema(s) matching: ${skipFilter}`,
                );
            }
        }

        // Apply include filter (overrides skip)
        if (schemaFilter) {
            const includePatterns = schemaFilter
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
                .map((pattern) => {
                    const escaped = pattern
                        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
                        .replace(/\*/g, ".*")
                        .replace(/\?/g, ".");
                    return new RegExp(`^${escaped}$`, "i");
                });

            // Find all schemas matching include patterns
            const includedSchemas = allSchemaNames.filter((s) =>
                includePatterns.some((re) => re.test(s)),
            );

            if (includedSchemas.length === 0) {
                io.writer.writeLine(
                    `Warning: no schemas matched "${schemaFilter}". ` +
                        `Available: ${allSchemaNames.join(", ")}`,
                );
            }

            // Include overrides skip - use only the included schemas
            targetSchemas = includedSchemas;
            io.writer.writeLine(
                `Included ${targetSchemas.length} schema(s) matching: ${schemaFilter}`,
            );
        }

        if (targetSchemas.length === 0) {
            io.writer.writeLine("No valid schemas selected.");
            return;
        }

        // Compile grammars for all target schemas
        io.writer.writeLine("Compiling grammars...");
        const compiledGrammars: CompiledGrammar[] = [];
        for (const schemaName of targetSchemas) {
            let actionConfig: ActionConfig;
            try {
                actionConfig = provider.getActionConfig(schemaName);
            } catch {
                continue;
            }
            const grammar = loadGrammarForConfig(actionConfig);
            if (!grammar) continue;
            try {
                const nfa = compileGrammarToNFA(grammar, schemaName);
                compiledGrammars.push({ schemaName, grammar, nfa });
            } catch (err: any) {
                io.writer.writeLine(
                    `  Warning: failed to compile grammar for "${schemaName}": ${err.message}`,
                );
            }
        }

        if (compiledGrammars.length === 0) {
            io.writer.writeLine(
                "No grammar files found for the selected schemas.",
            );
            return;
        }

        const grammarSchemaNames = compiledGrammars
            .map((g) => g.schemaName)
            .join(", ");
        io.writer.writeLine(
            `Checking against ${compiledGrammars.length} grammar(s): ${grammarSchemaNames}`,
        );
        io.writer.writeLine("");

        // Check each prompt against all grammars
        const results: GrammarCheckResult[] = [];
        const startTime = Date.now();

        for (const prompt of prompts) {
            const result: GrammarCheckResult = {
                prompt,
                matched: false,
                matchedSchema: "",
                matchedAction: "",
            };

            try {
                for (const { schemaName, grammar, nfa } of compiledGrammars) {
                    const matches: NFAGrammarMatchResult[] =
                        matchGrammarWithNFA(grammar, nfa, prompt);
                    if (matches.length > 0) {
                        result.matched = true;
                        result.matchedSchema = schemaName;
                        const matchObj = matches[0].match as any;
                        result.matchedAction =
                            matchObj?.actionName ?? "(unknown)";
                        break;
                    }
                }
            } catch (err: any) {
                result.errorMessage = err.message;
            }

            results.push(result);

            const status = result.errorMessage
                ? `${c.red}✗ ERROR${c.reset}  `
                : result.matched
                  ? `${c.green}✓ MATCH${c.reset}  `
                  : `${c.yellow}~ MISS${c.reset}   `;

            io.writer.writeLine(
                `  ${status}  ${c.white}${result.prompt}${c.reset}`,
            );
            if (result.matched) {
                io.writer.writeLine(
                    `           ${c.cyan}→ ${result.matchedSchema}.${result.matchedAction}${c.reset}`,
                );
            }
            if (result.errorMessage) {
                io.writer.writeLine(
                    `           ${c.red}Error: ${result.errorMessage}${c.reset}`,
                );
            }
        }

        const elapsedMs = Date.now() - startTime;
        io.writer.writeLine("");

        writeCSVReport(outputPath, results);
        io.writer.writeLine(`CSV report written to: ${outputPath}`);
        io.writer.writeLine("");

        printSummary(io, results, elapsedMs);

        return `Grammar check completed in ${(elapsedMs / 1000).toFixed(1)}s`;
    }
}

function writeCSVReport(
    outputPath: string,
    results: GrammarCheckResult[],
): void {
    const header = "Prompt,Matched,MatchedSchema,MatchedAction,Error";
    const rows = results.map((r) => {
        const escapeCsv = (s: string) => `"${s.replace(/"/g, '""')}"`;
        return [
            escapeCsv(r.prompt),
            r.matched,
            escapeCsv(r.matchedSchema),
            escapeCsv(r.matchedAction),
            escapeCsv(r.errorMessage ?? ""),
        ].join(",");
    });
    writeFileSync(outputPath, [header, ...rows].join("\n"), "utf-8");
}

function printSummary(
    io: InteractiveIo,
    results: GrammarCheckResult[],
    elapsedMs: number,
): void {
    const total = results.length;
    const matched = results.filter((r) => r.matched).length;
    const missed = results.filter((r) => !r.matched && !r.errorMessage).length;
    const errors = results.filter((r) => !!r.errorMessage).length;

    const pct = (n: number) =>
        total > 0 ? ((n / total) * 100).toFixed(1) : "0.0";

    io.writer.writeLine(`${c.bold}${c.cyan}${"=".repeat(60)}${c.reset}`);
    io.writer.writeLine(`${c.bold}${c.white}  BATCH GRAMMAR CHECK REPORT${c.reset}`);
    io.writer.writeLine(`${c.bold}${c.cyan}${"=".repeat(60)}${c.reset}`);
    io.writer.writeLine(
        `  Total prompts:   ${c.bold}${total}${c.reset}`,
    );
    io.writer.writeLine(
        `  Matched:         ${matched > 0 ? c.green : c.yellow}${matched}  (${pct(matched)}%)${c.reset}`,
    );
    io.writer.writeLine(
        `  Missed:          ${missed > 0 ? c.yellow : c.green}${missed}  (${pct(missed)}%)${c.reset}`,
    );
    if (errors > 0) {
        io.writer.writeLine(
            `  Errors:          ${c.red}${errors}  (${pct(errors)}%)${c.reset}`,
        );
    }
    io.writer.writeLine(
        `  Elapsed time:    ${c.dim}${(elapsedMs / 1000).toFixed(1)}s${c.reset}`,
    );
    io.writer.writeLine(`${c.bold}${c.cyan}${"=".repeat(60)}${c.reset}`);

    // Per-schema breakdown for matched prompts
    const schemaMap = new Map<string, number>();
    for (const r of results.filter((r) => r.matched)) {
        const key = r.matchedSchema || "(none)";
        schemaMap.set(key, (schemaMap.get(key) ?? 0) + 1);
    }
    if (schemaMap.size > 0) {
        io.writer.writeLine("");
        io.writer.writeLine("  Matches by schema:");
        for (const [schema, count] of schemaMap) {
            io.writer.writeLine(`    ${schema}: ${count}`);
        }
    }
}
