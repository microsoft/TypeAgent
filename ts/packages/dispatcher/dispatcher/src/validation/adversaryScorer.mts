// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PatternValidationResult } from "./types.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:validation:adversary");

const ADVERSARY_PROMPT = `You are an adversary evaluating natural language patterns for a grammar-based agent system.

Score each pattern on COMMONNESS (1-5 scale):
- 5: Universal phrasing everyone uses (e.g., "list files", "show processes", "pause")
- 4: Very common variant (e.g., "display files", "get processes", "stop")
- 3: Reasonably common, worth including (e.g., "show me files", "what processes")
- 2: Unusual but possible (e.g., "present files", "enumerate processes")
- 1: Rare/literary/poetic (e.g., "my eyes seek files", "summon processes")

REJECT patterns that have:
- Metaphorical or poetic language
- Embedded scenario context (e.g., "while I'm driving...")
- Terse/ambiguous phrasings that could mean multiple things
- Embedded politeness (belongs in phrase-set matchers, not grammar)
- Unusual verb choices most users wouldn't say

For each pattern, provide:
1. Score (1-5)
2. Reasoning (one sentence)
3. Recommendation (accept/revise/reject)
4. Suggestions (if revise/reject) - alternative patterns that would score higher

Return a JSON array with this structure:
[
  {
    "pattern": "the pattern text",
    "score": 4,
    "reasoning": "Very common variant with clear intent",
    "recommendation": "accept",
    "suggestions": []
  }
]

Patterns to evaluate for action "{{actionName}}" ({{description}}):
{{patterns}}`;

export interface AdversaryScorerConfig {
    model?: string;
    concurrency?: number;
    batchSize?: number;
}

export class AdversaryScorer {
    private config: Required<AdversaryScorerConfig>;

    constructor(config?: AdversaryScorerConfig) {
        this.config = {
            model: config?.model ?? "claude-sonnet-4-20250514",
            concurrency: config?.concurrency ?? 8,
            batchSize: config?.batchSize ?? 10,
        };
    }

    async scorePatterns(
        patterns: string[],
        actionName: string,
        actionDescription: string,
    ): Promise<PatternValidationResult[]> {
        if (patterns.length === 0) {
            return [];
        }

        const results: PatternValidationResult[] = [];

        for (let i = 0; i < patterns.length; i += this.config.batchSize) {
            const batch = patterns.slice(i, i + this.config.batchSize);
            const batchResults = await this.scoreBatch(
                batch,
                actionName,
                actionDescription,
            );
            results.push(...batchResults);
        }

        return results;
    }

    private async scoreBatch(
        patterns: string[],
        actionName: string,
        actionDescription: string,
    ): Promise<PatternValidationResult[]> {
        const prompt = this.buildPrompt(
            patterns,
            actionName,
            actionDescription,
        );

        try {
            const queryInstance = query({
                prompt,
                options: { model: this.config.model },
            });

            let responseText = "";
            for await (const message of queryInstance) {
                if (message.type === "result") {
                    if (message.subtype === "success") {
                        responseText = message.result || "";
                        break;
                    }
                }
            }

            return this.parseResponse(responseText, patterns);
        } catch (error) {
            debug(`Error scoring patterns: ${error}`);
            return patterns.map((pattern) => ({
                pattern,
                commonnessScore: 3,
                reasoning: "Unable to score pattern due to error",
                recommendation: "revise" as const,
                suggestions: [],
            }));
        }
    }

    private buildPrompt(
        patterns: string[],
        actionName: string,
        actionDescription: string,
    ): string {
        const patternList = patterns
            .map((p, i) => `${i + 1}. "${p}"`)
            .join("\n");

        return ADVERSARY_PROMPT.replace("{{patterns}}", patternList)
            .replace("{{actionName}}", actionName)
            .replace("{{description}}", actionDescription);
    }

    private parseResponse(
        responseContent: string | Array<{ text?: string }>,
        patterns: string[],
    ): PatternValidationResult[] {
        try {
            let text: string;
            if (Array.isArray(responseContent)) {
                text =
                    responseContent
                        .filter((block) => block.text)
                        .map((block) => block.text)
                        .join("\n") || "";
            } else {
                text = responseContent;
            }

            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                debug("No JSON array found in response");
                return this.createFallbackResults(patterns);
            }

            const evaluations = JSON.parse(jsonMatch[0]);

            return evaluations.map((e: any) => ({
                pattern: e.pattern,
                commonnessScore: e.score,
                reasoning: e.reasoning,
                recommendation: this.mapRecommendation(e.recommendation),
                suggestions: e.suggestions || [],
            }));
        } catch (error) {
            debug(`Error parsing response: ${error}`);
            return this.createFallbackResults(patterns);
        }
    }

    private mapRecommendation(rec: string): "accept" | "revise" | "reject" {
        const lower = rec.toLowerCase();
        if (lower.includes("accept")) return "accept";
        if (lower.includes("reject")) return "reject";
        return "revise";
    }

    private createFallbackResults(
        patterns: string[],
    ): PatternValidationResult[] {
        return patterns.map((pattern) => ({
            pattern,
            commonnessScore: 3,
            reasoning: "Unable to parse scoring response",
            recommendation: "revise" as const,
            suggestions: [],
        }));
    }
}
