// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { matchGrammar } from "@typeagent/action-grammar";
import type { TraceCallback, TraceEvent } from "@typeagent/action-grammar";
import type {
    LoadedGrammar,
    CoverageReport,
    RuleCoverage,
    PartCoverage,
    PartId,
} from "./types.js";
import { MissingDebugInfoError, hasDebugInfo } from "./types.js";

/**
 * Run a corpus of inputs against a grammar and return per-rule /
 * per-part hit counts. Requires `debugInfo` on the grammar; throws
 * `MissingDebugInfoError` otherwise.
 */
export function computeCoverage(
    g: LoadedGrammar,
    inputs: readonly string[],
): CoverageReport {
    if (!hasDebugInfo(g)) {
        throw new MissingDebugInfoError(g.source);
    }
    const debugInfo = g.debugInfo;

    // Accumulators
    const partHits = new Map<PartId, number>();
    const unmatchedInputs: Array<{ input: string; reason?: string }> = [];

    for (const input of inputs) {
        const events: TraceEvent[] = [];
        const trace: TraceCallback = (event) => {
            events.push(event);
        };
        const results = matchGrammar(g.grammar, input, { trace });

        if (results.length === 0) {
            unmatchedInputs.push({ input });
            continue;
        }

        // Count part hits from partMatched events
        for (const event of events) {
            if (event.kind === "partMatched") {
                partHits.set(event.part, (partHits.get(event.part) ?? 0) + 1);
            }
        }
    }

    // Build per-rule coverage entries using debugInfo.partRules
    // for authoritative part-to-rule ownership (recorded at compile time).
    const perRule: RuleCoverage[] = [];
    for (const [ruleId, location] of debugInfo.rules) {
        // Collect all parts belonging to this rule
        const parts: PartCoverage[] = [];
        for (const [partId, ownerRuleId] of debugInfo.partRules) {
            if (ownerRuleId === ruleId) {
                const loc = debugInfo.parts.get(partId);
                parts.push({
                    id: partId,
                    ...(loc ? { location: loc } : {}),
                    hits: partHits.get(partId) ?? 0,
                });
            }
        }

        // Rule hit count = sum of part hits
        const ruleHitCount = parts.reduce((sum, p) => sum + p.hits, 0);

        perRule.push({ id: ruleId, location, hits: ruleHitCount, parts });
    }

    // Totals
    const totalRules = perRule.length;
    const totalParts = perRule.reduce((sum, r) => sum + r.parts.length, 0);
    const totalRuleHits = perRule.filter((r) => r.hits > 0).length;
    const totalPartHits = perRule.reduce(
        (sum, r) => sum + r.parts.filter((p) => p.hits > 0).length,
        0,
    );

    return {
        grammarHash: debugInfo.grammarHash,
        totals: {
            rules: totalRules,
            parts: totalParts,
            ruleHits: totalRuleHits,
            partHits: totalPartHits,
        },
        perRule,
        unmatchedInputs,
    };
}
