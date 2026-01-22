// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadTestCases, runTests, printResults } from "./testRunner.js";
import { GrammarTestCase } from "./testTypes.js";
import { SchemaInfo } from "./schemaReader.js";
import { ClaudeGrammarGenerator } from "./grammarGenerator.js";

/**
 * Grammar generator using Claude
 */
async function generateGrammar(
    testCase: GrammarTestCase,
    schemaInfo: SchemaInfo,
): Promise<string> {
    const generator = new ClaudeGrammarGenerator();

    const analysis = await generator.generateGrammar(testCase, schemaInfo);

    // Add analysis details as comments
    let output = `# Analysis for: "${testCase.request}"\n`;

    if (!analysis.shouldGenerateGrammar) {
        output += `# REJECTED: ${analysis.rejectionReason}\n`;
        output += `# Reasoning: ${analysis.reasoning}\n`;
        output += `#\n`;
        output += `# Request Parse:\n`;
        for (const sentence of analysis.requestAnalysis.sentences) {
            output += `#   ${sentence.parse}\n`;
        }
        return output;
    }

    // Format as a complete grammar rule
    const grammarRule = generator.formatAsGrammarRule(testCase, analysis);

    output += `# Reasoning: ${analysis.reasoning}\n`;
    output += `#\n`;
    output += `# Request Parse:\n`;
    for (const sentence of analysis.requestAnalysis.sentences) {
        output += `#   ${sentence.parse}\n`;
    }
    output += `#\n`;
    output += `# Parameter Mappings:\n`;
    for (const mapping of analysis.parameterMappings) {
        output += `#   ${mapping.parameterName}: "${mapping.sourceText}" -> ${JSON.stringify(mapping.targetValue)}`;
        if (mapping.transformation && mapping.transformation.type !== "none") {
            output += ` [${mapping.transformation.type}: ${mapping.transformation.description}]`;
        }
        output += `\n`;
    }
    output += `#\n`;
    output += `# Fixed phrases: ${analysis.fixedPhrases.join(", ")}\n`;
    output += `#\n`;
    output += grammarRule;

    return output;
}

// Main test runner
async function main() {
    const args = process.argv.slice(2);
    const testFile = args[0];

    if (!testFile) {
        console.log("Usage: npx tsx src/runGrammarTests.ts <test-file>");
        console.log("\nAvailable test files:");
        console.log("  tests/weatherTests.jsonl");
        console.log("  tests/playerTests.jsonl");
        console.log("\nOr run all tests:");
        console.log("  npx tsx src/runGrammarTests.ts all");
        process.exit(1);
    }

    if (testFile === "all") {
        console.log("Loading all test cases...\n");

        const weatherTests = loadTestCases("tests/weatherTests.jsonl");
        const playerTests = loadTestCases("tests/playerTests.jsonl");

        console.log(`Loaded ${weatherTests.length} weather tests`);
        console.log(`Loaded ${playerTests.length} player tests\n`);

        console.log("=".repeat(60));
        console.log("Running Weather Tests");
        console.log("=".repeat(60));

        const weatherResults = await runTests(weatherTests, generateGrammar);
        printResults(weatherResults);

        console.log("\n" + "=".repeat(60));
        console.log("Running Player Tests");
        console.log("=".repeat(60));

        const playerResults = await runTests(playerTests, generateGrammar);
        printResults(playerResults);
    } else {
        console.log(`Loading test cases from ${testFile}...\n`);
        const testCases = loadTestCases(testFile);
        console.log(`Loaded ${testCases.length} test cases\n`);

        console.log("=".repeat(60));
        const results = await runTests(testCases, generateGrammar);
        printResults(results);
    }
}

main().catch(console.error);
