#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Flexible test script for grammar generation
// Usage:
//   node testGrammar.js <test-file> [test-index or test-range]
// Examples:
//   node testGrammar.js calendarTests.jsonl           # Run all tests
//   node testGrammar.js calendarTests.jsonl 5         # Run test 5 only
//   node testGrammar.js calendarTests.jsonl 3-7       # Run tests 3-7
//   node testGrammar.js playerTests.jsonl 1,3,5       # Run tests 1, 3, and 5

import { ClaudeGrammarGenerator } from "./dist/grammarGenerator.js";
import { loadTestCases, loadSchemasForTests } from "./dist/testRunner.js";

function parseTestSelection(selectionStr, totalTests) {
    if (!selectionStr) {
        // Run all tests
        return Array.from({ length: totalTests }, (_, i) => i);
    }

    const indices = [];

    // Handle comma-separated indices: "1,3,5"
    if (selectionStr.includes(",")) {
        const parts = selectionStr.split(",");
        for (const part of parts) {
            const index = parseInt(part.trim()) - 1; // Convert to 0-based
            if (index >= 0 && index < totalTests) {
                indices.push(index);
            }
        }
        return indices;
    }

    // Handle range: "3-7"
    if (selectionStr.includes("-")) {
        const [start, end] = selectionStr
            .split("-")
            .map((s) => parseInt(s.trim()) - 1);
        if (start >= 0 && end < totalTests && start <= end) {
            for (let i = start; i <= end; i++) {
                indices.push(i);
            }
        }
        return indices;
    }

    // Handle single index: "5"
    const index = parseInt(selectionStr) - 1;
    if (index >= 0 && index < totalTests) {
        return [index];
    }

    return [];
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error(
            "Usage: node testGrammar.js <test-file> [test-index or test-range]",
        );
        console.error("Examples:");
        console.error(
            "  node testGrammar.js calendarTests.jsonl           # Run all tests",
        );
        console.error(
            "  node testGrammar.js calendarTests.jsonl 5         # Run test 5 only",
        );
        console.error(
            "  node testGrammar.js calendarTests.jsonl 3-7       # Run tests 3-7",
        );
        console.error(
            "  node testGrammar.js calendarTests.jsonl 1,3,5     # Run tests 1, 3, and 5",
        );
        process.exit(1);
    }

    const testFile = args[0];
    const testSelection = args[1];
    const testPath =
        testFile.includes("/") || testFile.includes("\\")
            ? testFile
            : `./tests/${testFile}`;

    console.log(`Loading test cases from ${testPath}...`);
    const allTestCases = loadTestCases(testPath);
    console.log(`Loaded ${allTestCases.length} test cases\n`);

    const selectedIndices = parseTestSelection(
        testSelection,
        allTestCases.length,
    );
    if (selectedIndices.length === 0) {
        console.error("No valid tests selected");
        process.exit(1);
    }

    const testCases = selectedIndices.map((i) => allTestCases[i]);
    console.log(
        `Running ${testCases.length} of ${allTestCases.length} tests\n`,
    );

    console.log("Loading schemas...");
    const schemas = loadSchemasForTests(testCases);
    console.log(`Loaded ${schemas.size} schemas\n`);

    const generator = new ClaudeGrammarGenerator();

    for (const [arrayIndex, testCase] of testCases.entries()) {
        const originalIndex = selectedIndices[arrayIndex];
        console.log(`\n${"=".repeat(80)}`);
        console.log(
            `Test ${originalIndex + 1}/${allTestCases.length}: "${testCase.request}"`,
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
                    if (mapping.conversion) {
                        console.log(
                            `    Conversion: ${mapping.conversion.type} - ${mapping.conversion.description}`,
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
