#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarFromFile } from "grammar-tools-core";
import { previewCompletion } from "grammar-tools-core";
import { format } from "grammar-tools-core";
import { traceMatch, formatTrace } from "grammar-tools-core";
import { computeCoverage } from "grammar-tools-core";
import { diffGrammars } from "grammar-tools-core";
import { runAnalyzeCollisions } from "./analyzeCollisions.js";
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
            "  grammar-tools load <file.agr>              Load and validate a grammar file",
            "  grammar-tools complete <file> <input>      Preview completions for input",
            "  grammar-tools format <file.agr>            Format a grammar file",
            "  grammar-tools trace <file> <input>         Trace matcher execution on input",
            "  grammar-tools coverage <file> <corpus>     Run coverage against a corpus file",
            "  grammar-tools diff <a.agr> <b.agr>        Diff two grammar files",
            "  grammar-tools collisions [-d dir] [-o out] [-q]",
            "                                            Cross-agent NFA-intersection scan over compiled .ag.json grammars",
            "  grammar-tools help                         Show this help",
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
                                diagnostics: result.diagnostics,
                            },
                            null,
                            2,
                        ),
                    );
                } else {
                    console.log(
                        `Loaded: ${g.identifiers.ruleIds.length} rules`,
                    );
                    for (const diagnostic of result.diagnostics ?? []) {
                        console.warn(diagnostic.message);
                    }
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
                console.log(
                    formatTrace(trace, {
                        debugInfo: result.grammar.debugInfo,
                    }),
                );
            }
            break;
        }
        case "coverage": {
            const file = positionals[1];
            const corpusFile = positionals[2];
            if (!file || !corpusFile) {
                console.error(
                    "Usage: grammar-tools coverage <file.agr> <corpus.txt>",
                );
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
            let corpusText: string;
            try {
                corpusText = fs.readFileSync(path.resolve(corpusFile), "utf-8");
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`Error reading corpus: ${msg}`);
                process.exit(1);
            }
            const inputs = corpusText
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l.length > 0 && !l.startsWith("#"));
            const report = computeCoverage(result.grammar, inputs);
            if (jsonFlag) {
                console.log(JSON.stringify(report, null, 2));
            } else {
                console.log(
                    `Coverage: ${report.totals.ruleHits}/${report.totals.rules} rules, ` +
                        `${report.totals.partHits}/${report.totals.parts} parts`,
                );
                for (const r of report.perRule) {
                    const marker = r.hits > 0 ? "+" : "-";
                    console.log(`  ${marker} ${r.id} (${r.hits} hits)`);
                }
                if (report.unmatchedInputs.length > 0) {
                    console.log(
                        `\nUnmatched inputs (${report.unmatchedInputs.length}):`,
                    );
                    for (const u of report.unmatchedInputs) {
                        console.log(`  ? ${u.input}`);
                    }
                }
            }
            break;
        }
        case "diff": {
            const fileA = positionals[1];
            const fileB = positionals[2];
            if (!fileA || !fileB) {
                console.error("Usage: grammar-tools diff <a.agr> <b.agr>");
                process.exit(1);
            }
            const resultA = await loadGrammarFromFile(path.resolve(fileA));
            if (!resultA.ok) {
                if (jsonFlag) {
                    console.log(
                        JSON.stringify(
                            {
                                ok: false,
                                file: fileA,
                                diagnostics: resultA.diagnostics,
                            },
                            null,
                            2,
                        ),
                    );
                } else {
                    console.error(`Failed to load ${fileA}:`);
                    for (const d of resultA.diagnostics) {
                        console.error(`  ${d.severity}: ${d.message}`);
                    }
                }
                process.exit(1);
            }
            const resultB = await loadGrammarFromFile(path.resolve(fileB));
            if (!resultB.ok) {
                if (jsonFlag) {
                    console.log(
                        JSON.stringify(
                            {
                                ok: false,
                                file: fileB,
                                diagnostics: resultB.diagnostics,
                            },
                            null,
                            2,
                        ),
                    );
                } else {
                    console.error(`Failed to load ${fileB}:`);
                    for (const d of resultB.diagnostics) {
                        console.error(`  ${d.severity}: ${d.message}`);
                    }
                }
                process.exit(1);
            }
            const diff = diffGrammars(resultA.grammar, resultB.grammar);
            if (jsonFlag) {
                console.log(JSON.stringify(diff, null, 2));
            } else {
                if (
                    diff.added.length === 0 &&
                    diff.removed.length === 0 &&
                    diff.changed.length === 0
                ) {
                    console.log("No differences.");
                } else {
                    if (diff.added.length > 0) {
                        console.log("Added rules:");
                        for (const r of diff.added) {
                            console.log(`  + ${r}`);
                        }
                    }
                    if (diff.removed.length > 0) {
                        console.log("Removed rules:");
                        for (const r of diff.removed) {
                            console.log(`  - ${r}`);
                        }
                    }
                    if (diff.changed.length > 0) {
                        console.log("Changed rules:");
                        for (const c of diff.changed) {
                            console.log(`  ~ ${c.rule} (${c.reason})`);
                        }
                    }
                }
            }
            break;
        }
        case "collisions": {
            // analyzeCollisions has its own arg parser (--dir / --out /
            // --quiet / --help) that mirrors the historical
            // analyze-grammar-collisions CLI. Forward everything after
            // "collisions" verbatim (--json isn't supported by that
            // subcommand and is silently dropped).
            const forwarded = process.argv.slice(2).filter((a, i, arr) => {
                if (a === "collisions" && i === arr.indexOf("collisions")) {
                    return false;
                }
                if (a === "--json") return false;
                return true;
            });
            const code = await runAnalyzeCollisions(forwarded);
            if (code !== 0) process.exit(code);
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
