// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WorkflowPlan } from "./types.js";
import { PlanLibrary } from "./planLibrary.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import registerDebug from "debug";

const debug = registerDebug("typeagent:reasoning:planning:matcher");

const MATCHING_MODEL = "claude-sonnet-4-5-20250929";

export interface PlanMatchResult {
    plan: WorkflowPlan;
    confidence: number; // 0-1 score
    reason: string;
}

/**
 * Matches user requests to saved workflow plans
 */
export class PlanMatcher {
    constructor(
        private planLibrary: PlanLibrary,
        private useLLMValidation: boolean = false, // Disable by default due to process spawning issues
    ) {}

    /**
     * Find the best matching plan for a user request
     * @param request User's request
     * @param minConfidence Minimum confidence threshold (0-1), default 0.7
     * @returns Best matching plan or null if no good match
     */
    async findBestMatch(
        request: string,
        minConfidence: number = 0.7,
    ): Promise<PlanMatchResult | null> {
        debug(`Finding matching plan for: "${request}"`);
        debug(`Minimum confidence threshold: ${minConfidence}`);

        // Step 1: Get candidate plans with scores from library
        const candidatesWithScores =
            await this.planLibrary.findMatchingPlansWithScores(request);

        if (candidatesWithScores.length === 0) {
            debug("No candidate plans found");
            return null;
        }

        debug(
            `Found ${candidatesWithScores.length} candidate plans for validation`,
        );

        // Step 2: Use ranking scores as confidence (unless LLM validation enabled)
        const matches: PlanMatchResult[] = [];

        for (const { plan, score } of candidatesWithScores) {
            if (this.useLLMValidation) {
                // Use LLM validation if enabled
                const validated = await this.validateMatch(request, plan);
                if (validated) {
                    matches.push(validated);
                }
            } else {
                // Use ranking score directly as confidence
                const confidence = score;
                debug(
                    `Using ranking score as confidence for ${plan.planId}: ${confidence.toFixed(3)}`,
                );

                if (confidence >= minConfidence) {
                    matches.push({
                        plan,
                        confidence,
                        reason: "Keyword-based match from ranking",
                    });
                } else {
                    debug(
                        `Plan ${plan.planId} below threshold: ${confidence.toFixed(3)} < ${minConfidence}`,
                    );
                }
            }
        }

        // Return best match
        if (matches.length > 0) {
            const bestMatch = matches[0];
            debug(
                `Best match: ${bestMatch.plan.planId} (confidence: ${bestMatch.confidence})`,
            );
            return bestMatch;
        }

        debug(`No match meets confidence threshold`);
        return null;
    }

    /**
     * Validate if a plan is a good match for the request
     */
    private async validateMatch(
        request: string,
        plan: WorkflowPlan,
    ): Promise<PlanMatchResult | null> {
        // Use keyword-based confidence if LLM validation is disabled
        if (!this.useLLMValidation) {
            debug(
                `Using keyword-based confidence for plan: ${plan.planId} (LLM validation disabled)`,
            );
            const confidence = await this.computeKeywordConfidence(
                request,
                plan,
            );
            return {
                plan,
                confidence,
                reason: "Keyword-based match",
            };
        }

        // LLM-based validation
        try {
            const prompt = this.buildValidationPrompt(request, plan);

            const queryInstance = query({
                prompt,
                options: {
                    model: MATCHING_MODEL,
                    maxTurns: 1,
                    maxThinkingTokens: 1000,
                    allowedTools: [],
                },
            });

            let result: string | undefined;

            for await (const message of queryInstance) {
                if (message.type === "assistant") {
                    for (const content of message.message.content) {
                        if (content.type === "text") {
                            result = content.text;
                        }
                    }
                } else if (message.type === "result") {
                    if (message.subtype === "success") {
                        result = message.result;
                    }
                }
            }

            if (!result) {
                return null;
            }

            // Extract JSON from markdown code blocks if present
            const jsonMatch = result.match(
                /```(?:json)?\s*(\{[\s\S]*?\})\s*```/,
            );
            const jsonText = jsonMatch ? jsonMatch[1] : result;

            const validation = JSON.parse(jsonText);

            if (validation.isMatch) {
                return {
                    plan,
                    confidence: validation.confidence,
                    reason: validation.reason,
                };
            }

            return null;
        } catch (error) {
            debug("Failed to validate match:", error);
            return null;
        }
    }

    /**
     * Build validation prompt
     */
    private buildValidationPrompt(request: string, plan: WorkflowPlan): string {
        return `Determine if the following workflow plan is a good match for the user's request.

# User Request
"${request}"

# Workflow Plan
Description: ${plan.description}
Intent: ${plan.intent}

Steps:
${plan.steps
    .map(
        (s, i) =>
            `${i + 1}. ${s.objective} (${s.action.schemaName}.${s.action.actionName})`,
    )
    .join("\n")}

Variables:
${plan.variables.map((v) => `- ${v.name}: ${v.description}`).join("\n")}

# Task
Analyze if this plan can accomplish the user's request. Consider:
1. Does the plan's intent match the request?
2. Can the plan's steps accomplish what the user wants?
3. Can the required variables be extracted from the request?
4. Is the plan's workflow appropriate for the request?

# Output Format
Return a JSON object:

{
  "isMatch": true/false,
  "confidence": 0.0-1.0,
  "reason": "Brief explanation of why it matches or doesn't match"
}

Analyze now:`;
    }

    /**
     * Compute similarity between two descriptions (0-1 score)
     * Uses simple keyword overlap for fast duplicate detection
     */
    async computeSimilarity(
        description1: string,
        description2: string,
    ): Promise<number> {
        // Normalize and extract keywords
        const extractKeywords = (text: string): Set<string> => {
            return new Set(
                text
                    .toLowerCase()
                    .replace(/[^\w\s]/g, " ") // Remove punctuation
                    .split(/\s+/)
                    .filter((w) => w.length > 3), // Filter out short words
            );
        };

        const keywords1 = extractKeywords(description1);
        const keywords2 = extractKeywords(description2);

        if (keywords1.size === 0 || keywords2.size === 0) {
            return 0;
        }

        // Compute Jaccard similarity
        const intersection = new Set(
            [...keywords1].filter((k) => keywords2.has(k)),
        );
        const union = new Set([...keywords1, ...keywords2]);

        return intersection.size / union.size;
    }

    /**
     * Compute keyword-based confidence for a plan match
     * Returns confidence score 0-1 based on keyword overlap
     */
    private async computeKeywordConfidence(
        request: string,
        plan: WorkflowPlan,
    ): Promise<number> {
        // Extract keywords from request and plan
        const extractKeywords = (text: string): Set<string> => {
            return new Set(
                text
                    .toLowerCase()
                    .replace(/[^\w\s]/g, " ")
                    .split(/\s+/)
                    .filter((w) => w.length > 3),
            );
        };

        const requestKeywords = extractKeywords(request);
        const planKeywords = extractKeywords(
            `${plan.description} ${plan.intent}`,
        );

        if (requestKeywords.size === 0 || planKeywords.size === 0) {
            return 0;
        }

        // Count matching keywords
        const matchingKeywords = [...requestKeywords].filter((k) =>
            planKeywords.has(k),
        );
        const matches = matchingKeywords.length;

        // Calculate confidence as percentage of request keywords that match
        // Higher weight for matching more of the user's intent
        const confidence = matches / requestKeywords.size;

        // Boost confidence if intent-related keywords match
        const intentKeywords = new Set([
            "search",
            "find",
            "list",
            "get",
            "add",
            "create",
            "delete",
            "update",
            "buy",
            "purchase",
            "shopping",
            "cart",
        ]);

        const intentMatches = [...requestKeywords].filter(
            (k) => intentKeywords.has(k) && planKeywords.has(k),
        ).length;

        // Add bonus for intent keyword matches (up to 0.2)
        const bonus = Math.min(intentMatches * 0.1, 0.2);

        const finalConfidence = Math.min(confidence + bonus, 1.0);

        debug(
            `Keyword confidence for ${plan.planId}: ${matches}/${requestKeywords.size} keywords match = ${confidence.toFixed(3)} + intent bonus ${bonus.toFixed(3)} = ${finalConfidence.toFixed(3)}`,
        );

        return finalConfidence;
    }
}
