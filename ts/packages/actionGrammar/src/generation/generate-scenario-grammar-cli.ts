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
const repoRoot = path.resolve(__dirname, "../../../..");
config({ path: path.join(repoRoot, ".env") });

import { ScenarioBasedGrammarGenerator } from "./scenarioBasedGenerator.js";
import { loadSchemaInfo } from "./schemaReader.js";
import { getScenariosForAgent } from "./scenarioTemplates.js";

interface GenerateScenarioGrammarOptions {
    schema: string;
    output?: string;
    agentType?: "player" | "calendar" | "list";
    patternsPerScenario?: number;
    frenchRatio?: number;
    model?: string;
    help?: boolean;
}

function parseArgs(): GenerateScenarioGrammarOptions {
    const args = process.argv.slice(2);
    const options: GenerateScenarioGrammarOptions = {
        schema: "",
        patternsPerScenario: 20,
        frenchRatio: 0.1,
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
            case "--agent-type":
            case "-a":
                const agentType = args[++i];
                if (
                    agentType === "player" ||
                    agentType === "calendar" ||
                    agentType === "list"
                ) {
                    options.agentType = agentType;
                }
                break;
            case "--patterns":
            case "-p":
                options.patternsPerScenario = parseInt(args[++i]);
                break;
            case "--french-ratio":
            case "-f":
                options.frenchRatio = parseFloat(args[++i]);
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
Usage: generate-scenario-grammar [options] <schema-path>

Generate a comprehensive Action Grammar (.agr) file using scenario-based generation.

This tool generates natural, contextual grammar patterns by simulating realistic user
scenarios (morning routine, working from home, cooking, etc.) rather than just syntactic
variations.

Arguments:
  schema-path                Path to the .pas.json schema file

Options:
  -o, --output <path>        Output path for the .agr file
                             Default: <schema-name>.scenario.agr
  -a, --agent-type <type>    Agent type (player, calendar, list) to use appropriate scenarios
                             If not specified, attempts to infer from schema name
  -p, --patterns <number>    Number of patterns per (action × scenario) (default: 20)
  -f, --french-ratio <ratio> Ratio of French patterns to English (default: 0.1 for 10%)
  -m, --model <model>        Claude model to use (default: claude-sonnet-4-20250514)
  -h, --help                 Show this help message

Features:
  - Scenario-based pattern generation for natural language coverage
  - Validates against adjacent unchecked wildcard rules
  - Includes prefix/suffix patterns (politeness, greetings, acknowledgements)
  - 90% English, 10% French by default
  - Comprehensive coverage (80-250 patterns per action)

Examples:
  # Generate grammar for player agent
  generate-scenario-grammar -a player packages/agents/player/dist/playerSchema.pas.json

  # Generate for calendar with custom pattern count
  generate-scenario-grammar -a calendar -p 30 packages/agents/calendar/dist/calendarSchema.pas.json

  # Generate with custom output path
  generate-scenario-grammar -a list -o list.comprehensive.agr packages/agents/list/dist/listSchema.pas.json

  # Generate with more French patterns (20% instead of 10%)
  generate-scenario-grammar -a player -f 0.2 packages/agents/player/dist/playerSchema.pas.json
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

        // Determine agent type if not specified
        let agentType = options.agentType;
        if (!agentType) {
            const schemaNameLower = schemaInfo.schemaName.toLowerCase();
            if (schemaNameLower.includes("player")) {
                agentType = "player";
            } else if (schemaNameLower.includes("calendar")) {
                agentType = "calendar";
            } else if (schemaNameLower.includes("list")) {
                agentType = "list";
            } else {
                console.error(
                    `Error: Could not infer agent type from schema name "${schemaInfo.schemaName}". Please specify with --agent-type`,
                );
                process.exit(1);
            }
            console.log(`Inferred agent type: ${agentType}`);
        }

        // Get scenarios for agent type
        const scenarios = getScenariosForAgent(agentType);
        console.log(
            `Using ${scenarios.length} scenarios for ${agentType} agent`,
        );

        // Determine output path
        const outputPath =
            options.output ||
            path.join(
                path.dirname(options.schema),
                `${schemaInfo.schemaName}.scenario.agr`,
            );

        console.log(`\nGenerating comprehensive grammar...`);
        console.log(`  Model: ${options.model}`);
        console.log(`  Patterns per scenario: ${options.patternsPerScenario}`);
        console.log(
            `  French ratio: ${(options.frenchRatio! * 100).toFixed(0)}%`,
        );

        // Generate grammar
        const generator = new ScenarioBasedGrammarGenerator({
            model: options.model!,
            maxRetries: 3,
        });

        const result = await generator.generateGrammar(schemaInfo, {
            scenarios,
            patternsPerScenario: options.patternsPerScenario!,
            frenchRatio: options.frenchRatio!,
            includePrefixSuffixPatterns: true,
        });

        // Write output
        fs.writeFileSync(outputPath, result.grammarText, "utf8");

        console.log(`\n✓ Grammar generated: ${outputPath}`);
        console.log(`\nResults:`);
        console.log(`  Total patterns: ${result.stats.totalPatterns}`);
        console.log(`  English patterns: ${result.stats.englishPatterns}`);
        console.log(`  French patterns: ${result.stats.frenchPatterns}`);
        console.log(`  Rejected patterns: ${result.stats.rejectedCount}`);

        if (result.rejectedPatterns.length > 0) {
            console.log(`\nRejected patterns (adjacent unchecked wildcards):`);
            for (const rejected of result.rejectedPatterns.slice(0, 10)) {
                console.log(`  - ${rejected}`);
            }
            if (result.rejectedPatterns.length > 10) {
                console.log(
                    `  ... and ${result.rejectedPatterns.length - 10} more`,
                );
            }
        }

        console.log(`\nPatterns per action:`);
        for (const [action, count] of result.patternsPerAction) {
            console.log(`  ${action}: ${count} patterns`);
        }
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
