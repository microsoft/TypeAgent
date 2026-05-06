#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarFromFile } from "grammar-tools-core";
import { previewCompletion } from "grammar-tools-core";
import { format } from "grammar-tools-core";
import * as fs from "fs";
import * as path from "path";

const args = process.argv.slice(2);
const command = args[0];

function usage(): void {
    console.log([
        "grammar-studio - Grammar exploration CLI",
        "",
        "Usage:",
        "  grammar-studio load <file.agr>       Load and validate a grammar file",
        "  grammar-studio complete <file> <inp> Preview completions for input",
        "  grammar-studio format <file.agr>     Format a grammar file",
        "  grammar-studio help                  Show this help",
    ].join("\n"));
}

async function main(): Promise<void> {
    switch (command) {
        case "load": {
            const file = args[1];
            if (!file) {
                console.error("Error: file path required");
                process.exit(1);
            }
            const result = await loadGrammarFromFile(path.resolve(file));
            if (result.ok) {
                const g = result.grammar;
                console.log("Loaded: " + g.identifiers.ruleIds.length + " rules");
            } else {
                console.error("Failed to load grammar:");
                for (const d of result.diagnostics) {
                    console.error("  " + d.severity + ": " + d.message);
                }
                process.exit(1);
            }
            break;
        }
        case "complete": {
            const file = args[1];
            const input = args[2];
            if (!file || input === undefined) {
                console.error("Error: file and input required");
                process.exit(1);
            }
            const result = await loadGrammarFromFile(path.resolve(file));
            if (!result.ok) {
                console.error("Failed to load grammar");
                process.exit(1);
            }
            const preview = previewCompletion(result.grammar, input);
            console.log(JSON.stringify(preview, null, 2));
            break;
        }
        case "format": {
            const file = args[1];
            if (!file) {
                console.error("Error: file path required");
                process.exit(1);
            }
            const source = fs.readFileSync(path.resolve(file), "utf-8");
            const formatted = format(source);
            process.stdout.write(formatted);
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
