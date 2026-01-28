// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Test case for grammar generation
 */
export interface GrammarTestCase {
    request: string;
    schemaName: string;
    action: {
        actionName: string;
        parameters: Record<string, any>;
    };
}

/**
 * Result of running a grammar generation test
 */
export interface GrammarTestResult {
    testCase: GrammarTestCase;
    success: boolean;
    generatedGrammar?: string;
    error?: string;
    warnings?: string[];
}
