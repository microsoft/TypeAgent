// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CollisionDetectionResult,
    PatternValidationResult,
    RefinementResult,
} from "./types.mjs";
import {
    runQueryWithTimeout,
    DEFAULT_VALIDATION_QUERY_TIMEOUT_MS,
} from "./queryWithTimeout.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:validation:refiner");

const REFINEMENT_PROMPT = `You are helping refine grammar patterns that have issues.

Action: {{actionName}}
Description: {{description}}

Problems with current patterns:
{{problems}}

Original patterns:
{{originalPatterns}}

Generate improved patterns that:
1. Avoid the collisions mentioned
2. Maintain high commonness scores (4-5/5)
3. Are clear and unambiguous
4. Match how users naturally speak

Return a JSON array of refined patterns:
[
  {
    "original": "original pattern",
    "refined": "improved pattern",
    "reason": "why this is better",
    "expectedScore": 4
  }
]`;

export interface PatternRefinerConfig {
    model?: string;
    maxIterations?: number;
    /** Hard timeout for each refinement LLM call (ms). */
    timeoutMs?: number;
}

export class PatternRefiner {
    private config: Required<PatternRefinerConfig>;

    constructor(config?: PatternRefinerConfig) {
        this.config = {
            model: config?.model ?? "claude-sonnet-4-20250514",
            maxIterations: config?.maxIterations ?? 2,
            timeoutMs: config?.timeoutMs ?? DEFAULT_VALIDATION_QUERY_TIMEOUT_MS,
        };
    }

    async refinePatterns(
        originalPatterns: string[],
        actionName: string,
        actionDescription: string,
        qualityIssues: PatternValidationResult[],
        collisionIssues: CollisionDetectionResult,
    ): Promise<string[]> {
        if (qualityIssues.length === 0 && !collisionIssues.hasCollisions) {
            return originalPatterns;
        }

        const problemsDesc = this.buildProblemsDescription(
            qualityIssues,
            collisionIssues,
        );

        try {
            const refinements = await this.generateRefinements(
                originalPatterns,
                actionName,
                actionDescription,
                problemsDesc,
            );

            return refinements.map((r) => r.refinedPattern);
        } catch (error) {
            debug(`Error refining patterns: ${error}`);
            return originalPatterns;
        }
    }

    private buildProblemsDescription(
        qualityIssues: PatternValidationResult[],
        collisionIssues: CollisionDetectionResult,
    ): string {
        const problems: string[] = [];

        const lowQuality = qualityIssues.filter((p) => p.commonnessScore < 3);
        if (lowQuality.length > 0) {
            problems.push("Low quality patterns (score < 3):");
            for (const issue of lowQuality) {
                problems.push(
                    `  - "${issue.pattern}": ${issue.reasoning} (score: ${issue.commonnessScore})`,
                );
            }
        }

        if (collisionIssues.hasCollisions) {
            problems.push("\nCollisions detected:");
            for (const collision of collisionIssues.collisions) {
                problems.push(
                    `  - "${collision.testUtterance}" collides with ${collision.collidingAgent}.${collision.collidingAction}`,
                );
            }
        }

        return problems.join("\n");
    }

    private async generateRefinements(
        originalPatterns: string[],
        actionName: string,
        actionDescription: string,
        problemsDesc: string,
    ): Promise<RefinementResult[]> {
        const prompt = REFINEMENT_PROMPT.replace("{{actionName}}", actionName)
            .replace("{{description}}", actionDescription)
            .replace("{{problems}}", problemsDesc)
            .replace(
                "{{originalPatterns}}",
                originalPatterns.map((p, i) => `${i + 1}. "${p}"`).join("\n"),
            );

        const responseText = await runQueryWithTimeout(
            prompt,
            { model: this.config.model },
            this.config.timeoutMs,
        );

        return this.parseRefinements(responseText, originalPatterns);
    }

    private parseRefinements(
        responseContent: string | Array<{ text?: string }>,
        originalPatterns: string[],
    ): RefinementResult[] {
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
                debug("No JSON array found in refinement response");
                return this.createFallbackRefinements(originalPatterns);
            }

            const refinements = JSON.parse(jsonMatch[0]);

            return refinements.map((r: any) => ({
                originalPattern: r.original,
                refinedPattern: r.refined,
                improvementReason: r.reason,
                newScore: r.expectedScore || 4,
            }));
        } catch (error) {
            debug(`Error parsing refinements: ${error}`);
            return this.createFallbackRefinements(originalPatterns);
        }
    }

    private createFallbackRefinements(
        originalPatterns: string[],
    ): RefinementResult[] {
        return originalPatterns.map((pattern) => ({
            originalPattern: pattern,
            refinedPattern: pattern,
            improvementReason: "Unable to refine pattern",
            newScore: 3,
        }));
    }
}
