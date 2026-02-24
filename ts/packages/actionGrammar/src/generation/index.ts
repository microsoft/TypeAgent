// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar generation module for creating Action Grammar rules from schemas and examples
 */

import { Cardinal } from "../builtInEntities.js";

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
import { loadGrammarRulesNoThrow } from "../grammarLoader.js";
import { compileGrammarToNFA } from "../nfaCompiler.js";
import { matchGrammarWithNFA, tokenizeRequest } from "../nfaMatcher.js";
import { globalPhraseSetRegistry } from "../builtInPhraseMatchers.js";

/**
 * Apply phrasesToAdd from a GrammarAnalysis to the global phrase-set registry.
 * Idempotent — silently ignores duplicates and unknown matcher names.
 */
function applyPhrasesToAdd(analysis: GrammarAnalysis): void {
    if (!analysis.phrasesToAdd) return;
    for (const { matcherName, phrase } of analysis.phrasesToAdd) {
        globalPhraseSetRegistry.addPhrase(matcherName, phrase);
    }
}

/**
 * Check if a parameter value appears in the normalized request text.
 * Short values (< 6 chars) are assumed to be in the request to avoid
 * false rejections for things like years, IDs, short names.
 */
/**
 * Check whether all significant keywords (≥ 4 chars) in `value` appear
 * individually in `normalizedRequest`. Used as a fallback for multi-word
 * string values (e.g. search queries) where the LLM may rearrange words
 * from the request rather than quoting them verbatim.
 */
function allKeywordsInRequest(
    value: string,
    normalizedRequest: string,
): boolean {
    const keywords = value
        .split(/\s+/)
        .map((w) => w.replace(/[^\w]/g, ""))
        .filter((w) => w.length >= 4);
    if (keywords.length === 0) return true;
    return keywords.every((kw) => normalizedRequest.includes(kw));
}

function isValueInRequest(paramValue: any, normalizedRequest: string): boolean {
    if (typeof paramValue === "string") {
        if (paramValue.length < 6) return true;
        const normalizedValue = paramValue
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .trim();
        // Contiguous substring match (exact phrasing)
        if (normalizedRequest.includes(normalizedValue)) return true;
        // Fallback: all significant keywords present individually.
        // Handles search query params where the LLM assembles a query from
        // words scattered through the request (e.g. "punk rock The Ramones"
        // from "Find punk rock songs by The Ramones").
        return allKeywordsInRequest(normalizedValue, normalizedRequest);
    } else if (Array.isArray(paramValue)) {
        for (const item of paramValue) {
            if (typeof item === "string" && item.length >= 6) {
                const normalizedItem = item
                    .toLowerCase()
                    .replace(/[^\w\s]/g, " ")
                    .trim();
                if (
                    !normalizedRequest.includes(normalizedItem) &&
                    !allKeywordsInRequest(normalizedItem, normalizedRequest)
                ) {
                    return false;
                }
            }
        }
        return true;
    }
    if (typeof paramValue === "number") {
        // Check if the number appears as a digit token, a word-number, or a
        // multi-word phrase (e.g., "a couple" → 2) via the Cardinal converter.
        const tokens = normalizedRequest
            .split(/\s+/)
            .filter((t) => t.length > 0);
        const numStr = String(paramValue);
        // Literal digit match
        if (tokens.some((t) => t.replace(/[^\d]/g, "") === numStr)) {
            return true;
        }
        // Cardinal (word-number + multi-word phrase) match
        const MAX_CARDINAL_SPAN = 3;
        for (let start = 0; start < tokens.length; start++) {
            for (
                let len = 1;
                len <= Math.min(MAX_CARDINAL_SPAN, tokens.length - start);
                len++
            ) {
                const span = tokens.slice(start, start + len).join(" ");
                if (Cardinal.convert(span) === paramValue) {
                    return true;
                }
            }
        }
        return false;
    }
    return true; // Booleans and other non-string non-number values are fine
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
    // Last attempted grammar rule (populated even on round-trip rejection, for diagnostics)
    lastAttemptedRule?: string;
    // The grammar analysis performed
    analysis?: GrammarAnalysis;
    // Warning messages (e.g., duplicate patterns, ambiguous rules)
    warnings?: string[];
    // All phrase-set additions applied during generation (aggregated across all passes)
    appliedPhrasesToAdd?: Array<{ matcherName: string; phrase: string }>;
}

/**
 * Retry an async operation on transient connection errors with exponential backoff.
 * Only retries on errors whose message contains "Connection error" or "ECONNRESET"
 * or "ETIMEDOUT" — genuine API failures (non-retryable) are re-thrown immediately.
 */
async function retryOnConnectionError<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelayMs: number = 2000,
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const msg =
                err instanceof Error ? err.message : String(err);
            const isTransient =
                msg.includes("Connection error") ||
                msg.includes("ECONNRESET") ||
                msg.includes("ETIMEDOUT") ||
                msg.includes("ENOTFOUND") ||
                msg.includes("socket hang up") ||
                msg.includes("corrupted") || // .claude.json write collision under high concurrency
                msg.includes("not valid JSON") || // CLI startup failure (concurrent writes)
                msg.includes("Invalid API key"); // cascade from .claude.json corruption
            if (!isTransient) {
                throw err; // non-retryable — propagate immediately
            }
            lastError = err;
            if (attempt < maxAttempts - 1) {
                const delay = baseDelayMs * Math.pow(2, attempt);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
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
        const analysis = await retryOnConnectionError(() =>
            generator.generateGrammar(testCase, schemaInfo),
        );

        // Apply any new phrases the LLM wants to add to phrase-set matchers (idempotent)
        applyPhrasesToAdd(analysis);
        // Accumulate all phrasesToAdd across passes so callers can persist them
        const allPhrasesToAdd: Array<{ matcherName: string; phrase: string }> = [
            ...(analysis.phrasesToAdd ?? []),
        ];

        // Check if grammar should be generated
        if (!analysis.shouldGenerateGrammar) {
            return {
                success: false,
                rejectionReason: analysis.rejectionReason || "Unknown reason",
                analysis,
            };
        }

        // Format as grammar rule
        let grammarRule = generator.formatAsGrammarRule(
            testCase,
            analysis,
            schemaInfo,
        );

        // Round-trip verification: compile and test the rule against the original request.
        // If it fails, give Claude feedback and retry up to MAX_REFINEMENT_ATTEMPTS times.
        const MAX_REFINEMENT_ATTEMPTS = 2;
        const requestTokens = tokenizeRequest(request.request);
        let refinedAnalysis = analysis;
        for (let attempt = 0; attempt < MAX_REFINEMENT_ATTEMPTS; attempt++) {
            const g = loadGrammarRulesNoThrow("test", grammarRule, []);
            if (g) {
                const nfa = compileGrammarToNFA(g);
                const matched = matchGrammarWithNFA(g, nfa, request.request);
                if (matched.length > 0) {
                    break; // Rule matches — we're done
                }
            }
            // Rule failed to compile or didn't match — refine with feedback
            if (attempt === MAX_REFINEMENT_ATTEMPTS - 1) {
                // Last attempt failed — reject, but include the rule for diagnostics
                return {
                    success: false,
                    rejectionReason: `Generated rule does not match the original request after ${MAX_REFINEMENT_ATTEMPTS} attempts`,
                    lastAttemptedRule: grammarRule,
                    analysis: refinedAnalysis,
                };
            }
            refinedAnalysis = await retryOnConnectionError(() =>
                generator.refineGrammar(
                    testCase,
                    schemaInfo,
                    grammarRule,
                    requestTokens,
                ),
            );
            // Apply phrases from refinement pass too
            applyPhrasesToAdd(refinedAnalysis);
            if (refinedAnalysis.phrasesToAdd) {
                allPhrasesToAdd.push(...refinedAnalysis.phrasesToAdd);
            }
            if (!refinedAnalysis.shouldGenerateGrammar) {
                return {
                    success: false,
                    rejectionReason: refinedAnalysis.rejectionReason || "Rule refinement rejected",
                    analysis: refinedAnalysis,
                };
            }
            grammarRule = generator.formatAsGrammarRule(
                testCase,
                refinedAnalysis,
                schemaInfo,
            );
        }

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
            analysis: refinedAnalysis,
            warnings: [],
        };
        if (checkedVariables.size > 0) {
            result.checkedVariables = checkedVariables;
        }
        if (allPhrasesToAdd.length > 0) {
            result.appliedPhrasesToAdd = allPhrasesToAdd;
        }
        return result;
    } catch (error) {
        return {
            success: false,
            rejectionReason: `Error generating grammar: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
