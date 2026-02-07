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
    constructor(private planLibrary: PlanLibrary) {}

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

        // Step 1: Get candidate plans from library (keyword-based)
        const candidates = await this.planLibrary.findMatchingPlans(request);

        if (candidates.length === 0) {
            debug("No candidate plans found");
            return null;
        }

        debug(`Found ${candidates.length} candidate plans`);

        // Step 2: If only one candidate, validate it
        if (candidates.length === 1) {
            const validated = await this.validateMatch(request, candidates[0]);

            if (validated && validated.confidence >= minConfidence) {
                debug(
                    `Single candidate validated: ${candidates[0].planId} (confidence: ${validated.confidence})`,
                );
                return validated;
            }

            debug(
                `Single candidate rejected (confidence: ${validated?.confidence || 0})`,
            );
            return null;
        }

        // Step 3: If multiple candidates, rank them
        const rankedMatches = await this.rankCandidates(request, candidates);

        // Return best match if it meets confidence threshold
        const bestMatch = rankedMatches[0];
        if (bestMatch && bestMatch.confidence >= minConfidence) {
            debug(
                `Best match: ${bestMatch.plan.planId} (confidence: ${bestMatch.confidence})`,
            );
            return bestMatch;
        }

        debug(
            `No match meets confidence threshold (best: ${bestMatch?.confidence || 0})`,
        );
        return null;
    }

    /**
     * Validate if a plan is a good match for the request
     */
    private async validateMatch(
        request: string,
        plan: WorkflowPlan,
    ): Promise<PlanMatchResult | null> {
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
     * Rank multiple candidate plans
     */
    private async rankCandidates(
        request: string,
        candidates: WorkflowPlan[],
    ): Promise<PlanMatchResult[]> {
        const results: PlanMatchResult[] = [];

        // Validate each candidate in parallel
        const validations = await Promise.all(
            candidates.map((plan) => this.validateMatch(request, plan)),
        );

        // Collect valid matches
        for (const validation of validations) {
            if (validation) {
                results.push(validation);
            }
        }

        // Sort by confidence (descending)
        results.sort((a, b) => b.confidence - a.confidence);

        return results;
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
}
