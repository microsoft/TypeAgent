#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Command line tool for testing grammar generation on individual request/action pairs
 */

import { config } from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

// Load .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../..");
config({ path: path.join(repoRoot, ".env") });

import { ClaudeGrammarGenerator } from "./grammarGenerator.js";
import { loadSchemaInfo } from "./schemaReader.js";
import { GrammarTestCase } from "./testTypes.js";

interface TestGrammarOptions {
    schema: string;
    request: string;
    action: string;
    parameters: string;
    model?: string;
    verbose?: boolean;
    help?: boolean;
}

function parseArgs(): TestGrammarOptions {
    const args = process.argv.slice(2);
    const options: TestGrammarOptions = {
        schema: "",
        request: "",
        action: "",
        parameters: "{}",
        model: "claude-sonnet-4-20250514",
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case "--schema":
            case "-s":
                options.schema = args[++i];
                break;
            case "--request":
            case "-r":
                options.request = args[++i];
                break;
            case "--action":
            case "-a":
                options.action = args[++i];
                break;
            case "--parameters":
            case "-p":
                options.parameters = args[++i];
                break;
            case "--model":
            case "-m":
                options.model = args[++i];
                break;
            case "--verbose":
            case "-v":
                options.verbose = true;
                break;
            case "--help":
            case "-h":
                options.help = true;
                break;
        }
    }

    return options;
}

function printHelp() {
    console.log(`
Usage: test-grammar [options]

Test grammar generation for a single request/action pair.

Options:
  -s, --schema <path>        Path to the .pas.json schema file (required)
  -r, --request <text>       Natural language request (required)
  -a, --action <name>        Action name (required)
  -p, --parameters <json>    Action parameters as JSON (default: {})
  -m, --model <model>        Claude model to use (default: claude-sonnet-4-20250514)
  -v, --verbose              Show detailed analysis
  -h, --help                 Show this help message

Examples:
  # Test a simple player request
  test-grammar -s packages/agents/player/dist/playerSchema.pas.json \\
    -r "play Bohemian Rhapsody by Queen" \\
    -a playTrack \\
    -p '{"trackName":"Bohemian Rhapsody","artistName":"Queen"}'

  # Test with verbose output
  test-grammar -v -s packages/agents/calendar/dist/calendarSchema.pas.json \\
    -r "schedule meeting tomorrow at 2pm" \\
    -a scheduleEvent \\
    -p '{"eventDescription":"meeting","date":"tomorrow","time":"2pm"}'
`);
}

async function main() {
    const options = parseArgs();

    if (
        options.help ||
        !options.schema ||
        !options.request ||
        !options.action
    ) {
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

        // Parse parameters
        let parameters: Record<string, any>;
        try {
            parameters = JSON.parse(options.parameters);
        } catch (error) {
            console.error(
                `Error parsing parameters JSON: ${error instanceof Error ? error.message : String(error)}`,
            );
            process.exit(1);
        }

        // Create test case
        const testCase: GrammarTestCase = {
            request: options.request,
            schemaName: schemaInfo.schemaName,
            action: {
                actionName: options.action,
                parameters: parameters,
            },
        };

        console.log(`\nTest Case:`);
        console.log(`  Request: "${testCase.request}"`);
        console.log(`  Action: ${testCase.action.actionName}`);
        console.log(
            `  Parameters: ${JSON.stringify(testCase.action.parameters, null, 2)}`,
        );

        // Generate grammar
        console.log(`\nGenerating grammar with ${options.model}...`);
        const generator = new ClaudeGrammarGenerator(options.model!);
        const analysis = await generator.generateGrammar(testCase, schemaInfo);

        // Display results
        console.log(`\n${"=".repeat(80)}`);
        if (analysis.shouldGenerateGrammar) {
            console.log(`✓ ACCEPTED`);
            console.log(`${"=".repeat(80)}\n`);
            console.log(`Grammar Pattern:`);
            console.log(`  ${analysis.grammarPattern}\n`);

            console.log(`Fixed Phrases:`);
            for (const phrase of analysis.fixedPhrases) {
                console.log(`  - "${phrase}"`);
            }

            console.log(`\nParameter Mappings:`);
            for (const mapping of analysis.parameterMappings) {
                console.log(`  ${mapping.parameterName}:`);
                console.log(`    Source: "${mapping.sourceText}"`);
                console.log(
                    `    Target: ${JSON.stringify(mapping.targetValue)}`,
                );
                console.log(
                    `    Type: ${mapping.isWildcard ? "wildcard" : "fixed"}`,
                );
                if (mapping.conversion) {
                    console.log(
                        `    Conversion: ${mapping.conversion.type} - ${mapping.conversion.description}`,
                    );
                }
            }

            console.log(`\nComplete Grammar Rule:`);
            console.log(`${"=".repeat(80)}`);
            const grammarRule = generator.formatAsGrammarRule(
                testCase,
                analysis,
            );
            console.log(grammarRule);
            console.log(`${"=".repeat(80)}`);
        } else {
            console.log(`✗ REJECTED`);
            console.log(`${"=".repeat(80)}\n`);
            console.log(`Reason: ${analysis.rejectionReason}`);
        }

        if (options.verbose) {
            console.log(`\nReasoning:`);
            console.log(analysis.reasoning);

            console.log(`\nLinguistic Analysis:`);
            for (const sentence of analysis.requestAnalysis.sentences) {
                console.log(`  Sentence: "${sentence.text}"`);
                console.log(`  Parse: ${sentence.parse}`);
                console.log(`  Tokens:`);
                for (const token of sentence.tokens) {
                    console.log(
                        `    - ${token.text} [${token.pos}] (${token.role})`,
                    );
                }
            }
        }

        process.exit(analysis.shouldGenerateGrammar ? 0 : 1);
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
