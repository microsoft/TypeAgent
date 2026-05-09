// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    GrammarValidationRequest,
    GrammarValidationResult,
} from "@typeagent/agent-sdk";
import type { AgentGrammarRegistry } from "action-grammar";
import type { AgentCache } from "agent-cache";
import { AdversaryScorer } from "./adversaryScorer.mjs";
import { CollisionDetector } from "./collisionDetector.mjs";
import { PatternRefiner } from "./patternRefiner.mjs";
import type { CollisionDetectionResult } from "./types.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:dispatcher:validation");

/**
 * Validate grammar patterns using the AgentGrammarRegistry.
 * 
 * NO STORE ADAPTERS NEEDED - registry already has dynamic grammars via getDynamicGrammar().
 * 
 * @param agentName Current agent name
 * @param request Validation request with patterns to test
 * @param registry AgentGrammarRegistry with ALL static + dynamic rules
 * @param agentCache Agent cache for model configuration
 * @returns Validation result with approval status, errors, suggestions
 */
export async function validateGrammarPatternsImpl(
    agentName: string,
    request: GrammarValidationRequest,
    registry: AgentGrammarRegistry,
    agentCache: AgentCache,
): Promise<GrammarValidationResult> {
    debug(
        `[${agentName}] Validating ${request.patterns.length} patterns for "${request.actionName}"`,
    );

    // 1. Score pattern quality with adversary
    const adversaryScorer = new AdversaryScorer();

    const qualityResults = await adversaryScorer.scorePatterns(
        request.patterns,
        request.actionName,
        request.description,
    );

    debug(
        `Quality scores: ${qualityResults.map((r) => r.commonnessScore).join(", ")}`,
    );

    // 2. Test for collisions using ONLY the registry
    const collisionDetector = new CollisionDetector({
        currentAgent: agentName,
        agentGrammarRegistry: registry,
    });

    const collisionResults = await collisionDetector.detectCollisions(
        request.patterns,
        request.actionName,
    );

    debug(
        `Collisions: ${collisionResults.hasCollisions ? collisionResults.collisions.length : 0}`,
    );

    // 3. Check if patterns meet quality threshold
    const hasLowQuality = qualityResults.some((r) => r.commonnessScore < 3);
    const hasCriticalCollisions = collisionResults.severity === "critical";

    // 4. If critical collisions, reject immediately
    if (hasCriticalCollisions) {
        const result: GrammarValidationResult = {
            approved: false,
            patterns: request.patterns,
            qualityScores: qualityResults.map((r) => ({
                pattern: r.pattern,
                score: r.commonnessScore,
                reasoning: r.reasoning,
            })),
            collisions: collisionResults.collisions.map((c) => ({
                pattern: c.pattern,
                collidingAgent: c.collidingAgent,
                collidingAction: c.collidingAction,
                testUtterance: c.testUtterance,
                severity: "critical" as const,
            })),
            errors: formatCollisionErrors(collisionResults),
            suggestions: formatCollisionSuggestions(collisionResults),
        };
        return result;
    }

    // 5. If low quality, try pattern refinement
    if (hasLowQuality) {
        debug("Attempting pattern refinement due to low quality");

        const refiner = new PatternRefiner();
        const refinedPatterns = await refiner.refinePatterns(
            request.patterns,
            request.actionName,
            request.description,
            qualityResults,
            collisionResults,
        );

        // Re-validate refined patterns
        const revalidatedQuality = await adversaryScorer.scorePatterns(
            refinedPatterns,
            request.actionName,
            request.description,
        );

        const revalidatedCollisions =
            await collisionDetector.detectCollisions(
                refinedPatterns,
                request.actionName,
            );

        const stillLowQuality = revalidatedQuality.some(
            (r) => r.commonnessScore < 3,
        );
        const stillHasCollisions =
            revalidatedCollisions.severity === "critical";

        if (stillLowQuality || stillHasCollisions) {
            const result: GrammarValidationResult = {
                approved: false,
                patterns: refinedPatterns,
                qualityScores: revalidatedQuality.map((r) => ({
                    pattern: r.pattern,
                    score: r.commonnessScore,
                    reasoning: r.reasoning,
                })),
                errors: [
                    "Patterns do not meet quality threshold after refinement",
                ],
                suggestions: ["Try more common phrasings"],
            };
            if (stillHasCollisions) {
                result.collisions = revalidatedCollisions.collisions.map((c) => ({
                    pattern: c.pattern,
                    collidingAgent: c.collidingAgent,
                    collidingAction: c.collidingAction,
                    testUtterance: c.testUtterance,
                    severity: "critical" as const,
                }));
            }
            return result;
        }

        // Refined patterns are good
        const result: GrammarValidationResult = {
            approved: true,
            patterns: refinedPatterns,
            qualityScores: revalidatedQuality.map((r) => ({
                pattern: r.pattern,
                score: r.commonnessScore,
                reasoning: r.reasoning,
            })),
        };
        if (revalidatedCollisions.hasCollisions) {
            result.collisions = revalidatedCollisions.collisions.map((c) => ({
                pattern: c.pattern,
                collidingAgent: c.collidingAgent,
                collidingAction: c.collidingAction,
                testUtterance: c.testUtterance,
                severity: revalidatedCollisions.severity,
            }));
            if (revalidatedCollisions.severity !== "critical") {
                result.warnings = [
                    `Minor collisions detected with: ${revalidatedCollisions.collisions.map((c) => c.collidingAgent).join(", ")}`,
                ];
            }
        }
        return result;
    }

    // 6. All patterns meet quality, no critical collisions
    const result: GrammarValidationResult = {
        approved: true,
        patterns: request.patterns,
        qualityScores: qualityResults.map((r) => ({
            pattern: r.pattern,
            score: r.commonnessScore,
            reasoning: r.reasoning,
        })),
    };
    if (collisionResults.hasCollisions) {
        result.collisions = collisionResults.collisions.map((c) => ({
            pattern: c.pattern,
            collidingAgent: c.collidingAgent,
            collidingAction: c.collidingAction,
            testUtterance: c.testUtterance,
            severity: collisionResults.severity,
        }));
        if (collisionResults.severity !== "critical") {
            result.warnings = [
                `Minor collisions detected with: ${collisionResults.collisions.map((c) => c.collidingAgent).join(", ")}`,
            ];
        }
    }
    return result;
}

function formatCollisionErrors(
    result: CollisionDetectionResult,
): string[] {
    return result.collisions.map(
        (c) =>
            `Pattern "${c.pattern}" collides with ${c.collidingAgent}.${c.collidingAction} (test: "${c.testUtterance}")`,
    );
}

function formatCollisionSuggestions(
    result: CollisionDetectionResult,
): string[] {
    const suggestions: string[] = [];
    const agentNames = new Set(result.collisions.map((c) => c.collidingAgent));

    for (const agent of agentNames) {
        suggestions.push(
            `Consider adding context to disambiguate from ${agent} agent`,
        );
    }

    return suggestions;
}
