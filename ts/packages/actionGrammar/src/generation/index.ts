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
    ScenarioBasedGrammarGenerator,
    ScenarioGeneratorOptions,
    ScenarioGrammarConfig,
    ScenarioGrammarResult,
} from "./scenarioBasedGenerator.js";

export {
    ScenarioTemplate,
    PrefixSuffixPatterns,
    musicPlayerScenarios,
    calendarScenarios,
    listScenarios,
    englishPrefixSuffixPatterns,
    frenchPrefixSuffixPatterns,
    getScenariosForAgent,
    getPrefixSuffixPatterns,
} from "./scenarioTemplates.js";

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

import { ClaudeGrammarGenerator, GrammarAnalysis } from "./grammarGenerator.js";
import { loadSchemaInfo } from "./schemaReader.js";
import { GrammarTestCase } from "./testTypes.js";

/**
 * Check if a parameter value appears in the normalized request text.
 * Short values (< 6 chars) are assumed to be in the request to avoid
 * false rejections for things like years, IDs, short names.
 */
function isValueInRequest(paramValue: any, normalizedRequest: string): boolean {
    if (typeof paramValue === "string") {
        if (paramValue.length < 6) return true;
        const normalizedValue = paramValue
            .toLowerCase()
            .replace(/[^\w\s]/g, " ");
        return normalizedRequest.includes(normalizedValue);
    } else if (Array.isArray(paramValue)) {
        for (const item of paramValue) {
            if (typeof item === "string" && item.length >= 6) {
                const normalizedItem = item
                    .toLowerCase()
                    .replace(/[^\w\s]/g, " ");
                if (!normalizedRequest.includes(normalizedItem)) {
                    return false;
                }
            }
        }
        return true;
    }
    return true; // Non-string, non-array values (numbers, booleans) are fine
}

/**
 * Convert plural parameter names to singular for grammar variable names
 * e.g., "artists" -> "artist"
 */
function getSingularVariableName(paramName: string): string {
    if (paramName.endsWith("s") && paramName.length > 1) {
        return paramName.slice(0, -1);
    }
    return paramName;
}

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
    // Checked variable names (parameters with checked_wildcard paramSpec)
    checkedVariables?: Set<string>;
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

        // Validate that parameter values appear in the request.
        // If a value was inferred by the LLM (not in the request), strip it
        // from the action if it's optional in the schema; reject if required.
        const normalizedRequest = request.request
            .toLowerCase()
            .replace(/[^\w\s]/g, " ");
        const actionInfo = schemaInfo.actions.get(request.action.actionName);
        const strippedParams: string[] = [];
        for (const [paramName, paramValue] of Object.entries(
            request.action.parameters,
        )) {
            const isInRequest = isValueInRequest(paramValue, normalizedRequest);
            if (!isInRequest) {
                const paramInfo = actionInfo?.parameters.get(paramName);
                if (paramInfo?.optional) {
                    // Optional parameter inferred by LLM — strip it
                    strippedParams.push(paramName);
                } else {
                    // Required parameter not in request — reject
                    return {
                        success: false,
                        rejectionReason: `Required parameter '${paramName}' value "${paramValue}" not found in request (possible LLM correction - don't cache)`,
                    };
                }
            }
        }
        // Remove inferred optional parameters from the action
        for (const paramName of strippedParams) {
            delete request.action.parameters[paramName];
        }

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
        const grammarRule = generator.formatAsGrammarRule(
            testCase,
            analysis,
            schemaInfo,
        );

        // Extract checked variables from the action parameters
        const checkedVariables = new Set<string>();
        if (actionInfo) {
            for (const [paramName, paramInfo] of actionInfo.parameters) {
                if (paramInfo.paramSpec === "checked_wildcard") {
                    // Handle array parameters (convert plural to singular)
                    const varName = Array.isArray(
                        testCase.action.parameters[paramName],
                    )
                        ? getSingularVariableName(paramName)
                        : paramName;
                    checkedVariables.add(varName);
                }
            }
        }

        const result: CachePopulationResult = {
            success: true,
            generatedRule: grammarRule,
            analysis,
            warnings: [],
        };
        if (checkedVariables.size > 0) {
            result.checkedVariables = checkedVariables;
        }
        return result;
    } catch (error) {
        return {
            success: false,
            rejectionReason: `Error generating grammar: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
