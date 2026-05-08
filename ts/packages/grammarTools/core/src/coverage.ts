// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { matchGrammar } from "action-grammar";
import type { TraceCallback, TraceEvent } from "action-grammar";
import type {
    LoadedGrammar,
    CoverageReport,
    RuleCoverage,
    PartCoverage,
    GrammarDebugInfo,
    RuleId,
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

    // Build a mapping from PartId -> owning RuleId using source positions.
    const partOwner = buildPartOwnerMap(debugInfo);

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

    // Build per-rule coverage entries from debugInfo
    const perRule: RuleCoverage[] = [];
    for (const [ruleId, location] of debugInfo.rules) {
        // Collect parts belonging to this rule
        const parts: PartCoverage[] = [];
        for (const [partId, partLoc] of debugInfo.parts) {
            if (partOwner.get(partId) === ruleId) {
                parts.push({
                    id: partId,
                    location: partLoc,
                    hits: partHits.get(partId) ?? 0,
                });
            }
        }

        // Rule hit count = sum of part hits (or count of matched parts)
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

/**
 * Map each PartId to its owning RuleId by comparing source offsets.
 * A part belongs to the rule whose source offset is the largest
 * offset <= the part's offset.
 */
function buildPartOwnerMap(debugInfo: GrammarDebugInfo): Map<PartId, RuleId> {
    // Sort rules by source offset (ascending)
    const sortedRules: Array<{ id: RuleId; offset: number }> = [];
    for (const [id, loc] of debugInfo.rules) {
        sortedRules.push({ id, offset: loc.range.start.offset });
    }
    sortedRules.sort((a, b) => a.offset - b.offset);

    const result = new Map<PartId, RuleId>();
    for (const [partId, partLoc] of debugInfo.parts) {
        const partOffset = partLoc.range.start.offset;
        // Find the rule with the largest offset <= partOffset
        let owner: RuleId | undefined;
        for (const rule of sortedRules) {
            if (rule.offset <= partOffset) {
                owner = rule.id;
            } else {
                break;
            }
        }
        if (owner !== undefined) {
            result.set(partId, owner);
        }
    }
    return result;
}
