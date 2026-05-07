#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarFromFile } from "grammar-tools-core";
import { previewCompletion } from "grammar-tools-core";
import { format } from "grammar-tools-core";
import { traceMatch, formatTrace } from "grammar-tools-core";
import * as fs from "fs";
import * as path from "path";

const args = process.argv.slice(2);
const jsonFlag = args.includes("--json");
const positionals = args.filter((a) => a !== "--json");
const command = positionals[0];

function usage(): void {
    console.log(
        [
            "grammar-tools - Grammar exploration CLI",
            "",
            "Usage:",
            "  grammar-tools load <file.agr>            Load and validate a grammar file",
            "  grammar-tools complete <file> <input>    Preview completions for input",
            "  grammar-tools format <file.agr>          Format a grammar file",
            "  grammar-tools trace <file> <input>       Trace matcher execution on input",
            "  grammar-tools help                       Show this help",
            "",
            "Options:",
            "  --json    Output as JSON (machine-readable)",
        ].join("\n"),
    );
}

async function main(): Promise<void> {
    switch (command) {
        case "load": {
            const file = positionals[1];
            if (!file) {
                console.error("Error: file path required");
                process.exit(1);
            }
            const result = await loadGrammarFromFile(path.resolve(file));
            if (result.ok) {
                const g = result.grammar;
                if (jsonFlag) {
                    console.log(
                        JSON.stringify(
                            {
                                ok: true,
                                rules: g.identifiers.ruleIds.length,
                            },
                            null,
                            2,
                        ),
                    );
                } else {
                    console.log(
                        `Loaded: ${g.identifiers.ruleIds.length} rules`,
                    );
                }
            } else {
                if (jsonFlag) {
                    console.log(
                        JSON.stringify(
                            {
                                ok: false,
                                diagnostics: result.diagnostics,
                            },
                            null,
                            2,
                        ),
                    );
                } else {
                    console.error("Failed to load grammar:");
                    for (const d of result.diagnostics) {
                        console.error(`  ${d.severity}: ${d.message}`);
                    }
                }
                process.exit(1);
            }
            break;
        }
        case "complete": {
            const file = positionals[1];
            const input = positionals.slice(2).join(" ");
            if (!file || !input) {
                console.error("Error: file and input required");
                process.exit(1);
            }
            const result = await loadGrammarFromFile(path.resolve(file));
            if (!result.ok) {
                console.error("Failed to load grammar");
                process.exit(1);
            }
            const preview = previewCompletion(result.grammar, input);
            if (jsonFlag) {
                console.log(JSON.stringify(preview, null, 2));
            } else {
                // Human-friendly: show each group's completions
                for (const group of preview.groups) {
                    for (const c of group.completions) {
                        console.log(`  ${c}`);
                    }
                }
                if (preview.groups.length === 0) {
                    console.log("(no completions)");
                }
            }
            break;
        }
        case "format": {
            const file = positionals[1];
            if (!file) {
                console.error("Error: file path required");
                process.exit(1);
            }
            let source: string;
            try {
                source = fs.readFileSync(path.resolve(file), "utf-8");
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                if (jsonFlag) {
                    console.log(
                        JSON.stringify({ ok: false, error: msg }, null, 2),
                    );
                } else {
                    console.error(`Error reading file: ${msg}`);
                }
                process.exit(1);
            }
            const formatted = format(source);
            if (jsonFlag) {
                console.log(JSON.stringify({ formatted }, null, 2));
            } else {
                process.stdout.write(formatted);
            }
            break;
        }
        case "trace": {
            const file = positionals[1];
            const input = positionals.slice(2).join(" ");
            if (!file || !input) {
                console.error("Usage: grammar-tools trace <file.agr> <input>");
                process.exit(1);
            }
            const result = await loadGrammarFromFile(path.resolve(file));
            if (!result.ok) {
                if (jsonFlag) {
                    console.log(
                        JSON.stringify(
                            {
                                ok: false,
                                diagnostics: result.diagnostics,
                            },
                            null,
                            2,
                        ),
                    );
                } else {
                    console.error("Failed to load grammar:");
                    for (const d of result.diagnostics) {
                        console.error(`  ${d.severity}: ${d.message}`);
                    }
                }
                process.exit(1);
            }
            const trace = traceMatch(result.grammar, input);
            if (jsonFlag) {
                console.log(
                    JSON.stringify(
                        {
                            input: trace.input,
                            result: trace.result,
                            events: trace.events,
                        },
                        null,
                        2,
                    ),
                );
            } else {
                console.log(formatTrace(trace));
            }
            break;
        }
        case "help":
        case undefined:
            usage();
            break;
        default:
            console.error("Unknown command: " + command);
            usage();
            process.exit(1);
    }
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
