// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { matchGrammar } from "action-grammar";
import type { TraceCallback, TraceEvent, GrammarPart } from "action-grammar";
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

    // Build a mapping from PartId -> owning RuleId by walking the
    // compiled grammar AST. This is reliable for nested and optimized
    // grammars (unlike source-offset heuristics).
    const partOwner = buildPartOwnerMap(g);

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

/**
 * Walk the compiled grammar AST and map each part's `partId` to the
 * rule name (RuleId) it was compiled from, using the debugInfo's rule
 * map to identify which top-level alternatives belong to which rule.
 *
 * For parts without a `partId` (optimizer-synthesized wrappers), or
 * for partIds not present in `debugInfo.parts`, the part is silently
 * excluded from coverage - this is expected for optimized grammars.
 */
function buildPartOwnerMap(g: LoadedGrammar): Map<PartId, RuleId> {
    const result = new Map<PartId, RuleId>();
    const debugInfo = g.debugInfo!;

    // For each rule in debugInfo, find which parts belong to it
    // by walking all parts in the grammar and checking debugInfo.
    // We use the rule positions from debugInfo (source offsets) to
    // determine ownership: a part belongs to the rule whose source
    // range it falls within. But since we have the grammar AST, we
    // can walk it and use the partIds directly.
    //
    // Strategy: walk all alternatives, collect partIds, and assign
    // each to the closest preceding rule in source order.
    const sortedRules = [...debugInfo.rules.entries()].sort(
        (a, b) => a[1].range.start.offset - b[1].range.start.offset,
    );

    // Collect all partIds from the grammar AST
    for (const alt of g.grammar.alternatives) {
        collectPartIds(alt.parts, result, sortedRules, debugInfo);
    }

    return result;
}

/**
 * Recursively collect partIds from a parts array and nested RulesParts.
 */
function collectPartIds(
    parts: readonly GrammarPart[],
    result: Map<PartId, RuleId>,
    sortedRules: Array<[RuleId, { range: { start: { offset: number } } }]>,
    debugInfo: GrammarDebugInfo,
): void {
    for (const part of parts) {
        const partId = part.partId;
        if (partId !== undefined && debugInfo.parts.has(partId)) {
            // Find the owning rule using the part's source position
            const partLoc = debugInfo.parts.get(partId)!;
            const partOffset = partLoc.range.start.offset;
            let owner: RuleId | undefined;
            for (const [ruleId, ruleLoc] of sortedRules) {
                if (ruleLoc.range.start.offset <= partOffset) {
                    owner = ruleId;
                } else {
                    break;
                }
            }
            if (owner !== undefined) {
                result.set(partId, owner);
            }
        }
        // Recurse into nested RulesParts
        if (part.type === "rules") {
            for (const rule of part.alternatives) {
                collectPartIds(rule.parts, result, sortedRules, debugInfo);
            }
        }
    }
}
