#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Test script for calendar grammar generation

import { ClaudeGrammarGenerator } from "./dist/grammarGenerator.js";
import { loadTestCases, loadSchemasForTests } from "./dist/testRunner.js";

async function main() {
    console.log("Loading calendar test cases...");
    const testCases = loadTestCases("./tests/calendarTests.jsonl");
    console.log(`Loaded ${testCases.length} test cases\n`);

    console.log("Loading schemas...");
    const schemas = loadSchemasForTests(testCases);
    console.log(`Loaded ${schemas.size} schemas\n`);

    const generator = new ClaudeGrammarGenerator();

    for (const [index, testCase] of testCases.entries()) {
        console.log(`\n${"=".repeat(80)}`);
        console.log(
            `Test ${index + 1}/${testCases.length}: "${testCase.request}"`,
        );
        console.log(`Action: ${testCase.action.actionName}`);
        console.log(
            `Parameters: ${JSON.stringify(testCase.action.parameters)}`,
        );
        console.log(`Note: ${testCase.note || "N/A"}`);
        console.log(`${"=".repeat(80)}`);

        try {
            const schemaInfo = schemas.get(testCase.schemaName);
            if (!schemaInfo) {
                console.error(`❌ Schema not found: ${testCase.schemaName}`);
                continue;
            }

            const analysis = await generator.generateGrammar(
                testCase,
                schemaInfo,
            );

            if (analysis.shouldGenerateGrammar) {
                console.log("\n✅ ACCEPTED - Grammar should be generated");
                console.log("\nGrammar Pattern:");
                console.log(`  ${analysis.grammarPattern}`);

                console.log("\nParameter Mappings:");
                for (const mapping of analysis.parameterMappings) {
                    console.log(`  ${mapping.parameterName}:`);
                    console.log(`    Source: "${mapping.sourceText}"`);
                    console.log(
                        `    Value: ${JSON.stringify(mapping.targetValue)}`,
                    );
                    console.log(`    Wildcard: ${mapping.isWildcard}`);
                    if (mapping.transformation) {
                        console.log(
                            `    Transformation: ${mapping.transformation.type} - ${mapping.transformation.description}`,
                        );
                    }
                }

                console.log("\nFixed Phrases:");
                console.log(`  ${analysis.fixedPhrases.join(", ")}`);

                const grammarRule = generator.formatAsGrammarRule(
                    testCase,
                    analysis,
                );
                console.log("\nFull Grammar Rule:");
                console.log(grammarRule);
            } else {
                console.log("\n❌ REJECTED - Grammar should NOT be generated");
                console.log(`Reason: ${analysis.rejectionReason}`);
            }

            console.log("\nReasoning:");
            console.log(`  ${analysis.reasoning}`);
        } catch (error) {
            console.error(`\n❌ ERROR: ${error.message}`);
            if (error.stack) {
                console.error(error.stack);
            }
        }
    }
}

main().catch(console.error);
