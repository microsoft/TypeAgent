// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar generation module for creating Action Grammar rules from schemas and examples
 */

export {
    ClaudeGrammarGenerator,
    GrammarAnalysis,
    ParameterMapping,
    Conversion,
    RequestAnalysis,
    Sentence,
    Token,
} from "./grammarGenerator.js";

export {
    SchemaToGrammarGenerator,
    SchemaGrammarConfig,
    SchemaGrammarResult,
} from "./schemaToGrammarGenerator.js";

export {
    loadSchemaInfo,
    SchemaInfo,
    ActionInfo,
    ParameterValidationInfo,
    ConverterInfo,
    getWildcardType,
    shouldUseTypedWildcard,
} from "./schemaReader.js";

export { GrammarTestCase, GrammarTestResult } from "./testTypes.js";

import {
    ClaudeGrammarGenerator,
    GrammarAnalysis,
} from "./grammarGenerator.js";
import { loadSchemaInfo } from "./schemaReader.js";
import { GrammarTestCase } from "./testTypes.js";

/**
 * Cache population API for agentServer integration
 */

/**
 * Request to add a new grammar rule to the cache based on a user request/action pair
 */
export interface CachePopulationRequest {
    // The natural language request from the user
    request: string;
    // The schema name (agent name) this action belongs to
    schemaName: string;
    // The action that was confirmed by the user
    action: {
        actionName: string;
        parameters: Record<string, any>;
    };
    // Path to the .pas.json schema file for validation info
    schemaPath: string;
}

/**
 * Result of attempting to add a grammar rule to the cache
 */
export interface CachePopulationResult {
    // Whether the grammar rule was successfully generated and added
    success: boolean;
    // The generated grammar rule text (if successful)
    generatedRule?: string;
    // Reason for rejection (if not successful)
    rejectionReason?: string;
    // The grammar analysis performed
    analysis?: GrammarAnalysis;
    // Warning messages (e.g., duplicate patterns, ambiguous rules)
    warnings?: string[];
}

/**
 * Generate and add a grammar rule to the cache from a request/action pair
 * This is called by agentServer when Claude confirms a user action should be cached
 *
 * @param request The cache population request
 * @param model The Claude model to use for analysis (default: claude-sonnet-4-20250514)
 * @returns Result indicating success or failure with details
 */
export async function populateCache(
    request: CachePopulationRequest,
    model: string = "claude-sonnet-4-20250514",
): Promise<CachePopulationResult> {
    try {
        // Load schema information
        const schemaInfo = loadSchemaInfo(request.schemaPath);

        // Create test case from request
        const testCase: GrammarTestCase = {
            request: request.request,
            schemaName: request.schemaName,
            action: request.action,
        };

        // Generate grammar rule using Claude
        const generator = new ClaudeGrammarGenerator(model);
        const analysis = await generator.generateGrammar(testCase, schemaInfo);

        // Check if grammar should be generated
        if (!analysis.shouldGenerateGrammar) {
            return {
                success: false,
                rejectionReason: analysis.rejectionReason || "Unknown reason",
                analysis,
            };
        }

        // Format as grammar rule
        const grammarRule = generator.formatAsGrammarRule(testCase, analysis);

        return {
            success: true,
            generatedRule: grammarRule,
            analysis,
            warnings: [],
        };
    } catch (error) {
        return {
            success: false,
            rejectionReason: `Error generating grammar: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
