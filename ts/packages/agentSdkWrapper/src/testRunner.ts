// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import { GrammarTestCase, GrammarTestResult } from "./testTypes.js";
import { loadSchemaInfo, SchemaInfo } from "./schemaReader.js";

/**
 * Load test cases from a JSONL file
 */
export function loadTestCases(filePath: string): GrammarTestCase[] {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter((line) => line.trim());
    return lines.map((line) => JSON.parse(line));
}

/**
 * Get the schema path for a given schema name
 */
export function getSchemaPath(schemaName: string): string {
    // Map schema names to their .pas.json file paths
    const schemaPaths: Record<string, string> = {
        player: "../agents/player/dist/agent/playerSchema.pas.json",
        weather: "../agents/weather/dist/weatherSchema.pas.json",
        calendar: "../agents/calendar/dist/calendarSchema.pas.json",
    };

    const schemaPath = schemaPaths[schemaName];
    if (!schemaPath) {
        throw new Error(`Unknown schema: ${schemaName}`);
    }

    return schemaPath;
}

/**
 * Load schema info for all unique schemas in test cases
 */
export function loadSchemasForTests(
    testCases: GrammarTestCase[],
): Map<string, SchemaInfo> {
    const schemas = new Map<string, SchemaInfo>();
    const uniqueSchemas = new Set(testCases.map((tc) => tc.schemaName));

    for (const schemaName of uniqueSchemas) {
        const schemaPath = getSchemaPath(schemaName);
        const schemaInfo = loadSchemaInfo(schemaPath);
        schemas.set(schemaName, schemaInfo);
    }

    return schemas;
}

/**
 * Run grammar generation tests
 */
export async function runTests(
    testCases: GrammarTestCase[],
    generateGrammar: (
        testCase: GrammarTestCase,
        schemaInfo: SchemaInfo,
    ) => Promise<string>,
): Promise<GrammarTestResult[]> {
    const schemas = loadSchemasForTests(testCases);
    const results: GrammarTestResult[] = [];

    for (const testCase of testCases) {
        const schemaInfo = schemas.get(testCase.schemaName);
        if (!schemaInfo) {
            results.push({
                testCase,
                success: false,
                error: `Schema not found: ${testCase.schemaName}`,
            });
            continue;
        }

        try {
            const grammar = await generateGrammar(testCase, schemaInfo);
            const warnings: string[] = [];

            // Check for potential issues
            if (grammar.toLowerCase().includes("<query>")) {
                warnings.push(
                    "Grammar contains <query> which might capture interrogative words",
                );
            }

            // Check if interrogative words appear in wildcard positions
            const interrogatives = [
                "what",
                "where",
                "when",
                "who",
                "why",
                "how",
                "which",
            ];
            for (const word of interrogatives) {
                if (testCase.request.toLowerCase().includes(word)) {
                    // Make sure the word appears in a fixed part, not a wildcard
                    if (!grammar.toLowerCase().includes(word)) {
                        warnings.push(
                            `Request contains "${word}" but it's not in the grammar pattern`,
                        );
                    }
                }
            }

            if (warnings.length > 0) {
                results.push({
                    testCase,
                    success: true,
                    generatedGrammar: grammar,
                    warnings: warnings,
                });
            } else {
                results.push({
                    testCase,
                    success: true,
                    generatedGrammar: grammar,
                });
            }
        } catch (error) {
            results.push({
                testCase,
                success: false,
                error: String(error),
            });
        }
    }

    return results;
}

/**
 * Print test results in a readable format
 */
export function printResults(results: GrammarTestResult[]): void {
    let passCount = 0;
    let failCount = 0;

    for (const result of results) {
        if (result.success) {
            passCount++;
            console.log(`\n✓ PASS: "${result.testCase.request}"`);
            console.log(`  Schema: ${result.testCase.schemaName}`);
            console.log(
                `  Action: ${result.testCase.action.actionName}(${JSON.stringify(result.testCase.action.parameters)})`,
            );
            console.log(`  Grammar:\n${result.generatedGrammar}`);
            if (result.warnings && result.warnings.length > 0) {
                console.log(`  ⚠ Warnings:`);
                for (const warning of result.warnings) {
                    console.log(`    - ${warning}`);
                }
            }
        } else {
            failCount++;
            console.log(`\n✗ FAIL: "${result.testCase.request}"`);
            console.log(`  Error: ${result.error}`);
        }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Results: ${passCount} passed, ${failCount} failed`);
}
