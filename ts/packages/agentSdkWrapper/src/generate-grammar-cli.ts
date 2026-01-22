#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { config } from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";

// Load .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
config({ path: path.join(repoRoot, ".env") });

import { SchemaToGrammarGenerator } from "./schemaToGrammarGenerator.js";
import { loadSchemaInfo } from "./schemaReader.js";

interface GenerateGrammarOptions {
    schema: string;
    output?: string;
    examplesPerAction?: number;
    model?: string;
    help?: boolean;
}

function parseArgs(): GenerateGrammarOptions {
    const args = process.argv.slice(2);
    const options: GenerateGrammarOptions = {
        schema: "",
        examplesPerAction: 3,
        model: "claude-sonnet-4-20250514",
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case "--schema":
            case "-s":
                options.schema = args[++i];
                break;
            case "--output":
            case "-o":
                options.output = args[++i];
                break;
            case "--examples":
            case "-e":
                options.examplesPerAction = parseInt(args[++i]);
                break;
            case "--model":
            case "-m":
                options.model = args[++i];
                break;
            case "--help":
            case "-h":
                options.help = true;
                break;
            default:
                if (!arg.startsWith("-") && !options.schema) {
                    options.schema = arg;
                }
                break;
        }
    }

    return options;
}

function printHelp() {
    console.log(`
Usage: generate-grammar [options] <schema-path>

Generate an Action Grammar (.agr) file from an agent schema.

Arguments:
  schema-path                 Path to the .pas.json schema file

Options:
  -o, --output <path>        Output path for the .agr file (default: <schema-name>.agr)
  -e, --examples <number>    Number of examples per action (default: 3)
  -m, --model <model>        Claude model to use (default: claude-sonnet-4-20250514)
  -h, --help                 Show this help message

Examples:
  # Generate grammar from player schema
  generate-grammar packages/agents/player/dist/playerSchema.pas.json

  # Generate with custom output path
  generate-grammar -o player.agr packages/agents/player/dist/playerSchema.pas.json

  # Generate with more examples per action
  generate-grammar -e 5 packages/agents/player/dist/playerSchema.pas.json
`);
}

async function main() {
    const options = parseArgs();

    if (options.help || !options.schema) {
        printHelp();
        process.exit(options.help ? 0 : 1);
    }

    try {
        console.log(`Loading schema from: ${options.schema}`);

        // Load the schema
        const schemaInfo = loadSchemaInfo(options.schema);
        console.log(
            `Schema: ${schemaInfo.schemaName} (${schemaInfo.actions.size} actions)`,
        );

        // Determine output path
        const outputPath =
            options.output ||
            path.join(
                path.dirname(options.schema),
                `${schemaInfo.schemaName}.agr`,
            );

        console.log(`\nGenerating grammar...`);
        console.log(`  Model: ${options.model}`);
        console.log(`  Examples per action: ${options.examplesPerAction}`);

        // Generate grammar
        const generator = new SchemaToGrammarGenerator({
            model: options.model!,
            examplesPerAction: options.examplesPerAction!,
        });

        const result = await generator.generateGrammar(schemaInfo, {
            examplesPerAction: options.examplesPerAction!,
        });

        // Write output
        fs.writeFileSync(outputPath, result.grammarText, "utf8");

        console.log(`\n✓ Grammar generated: ${outputPath}`);
        console.log(`\nResults:`);
        console.log(`  ✓ ${result.successfulActions.length} actions converted`);
        if (result.rejectedActions.size > 0) {
            console.log(`  ✗ ${result.rejectedActions.size} actions rejected:`);
            for (const [action, reason] of result.rejectedActions) {
                console.log(`    - ${action}: ${reason}`);
            }
        }

        console.log(`\nTest cases generated: ${result.testCases.length}`);

        // Save test cases to a separate file
        const testCasesPath = outputPath.replace(/\.agr$/, ".tests.json");
        fs.writeFileSync(
            testCasesPath,
            JSON.stringify(result.testCases, null, 2),
            "utf8",
        );
        console.log(`Test cases saved: ${testCasesPath}`);
    } catch (error) {
        console.error(
            `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (error instanceof Error && error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();
