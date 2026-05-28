// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar collision scanner — shared engine used by the in-shell
 * `@grammar collisions` command and the standalone CLI.
 *
 * Given a list of pre-loaded agent grammars, the scanner:
 * 1. Compiles each grammar to an NFA (with a `tailCall` strip-and-retry
 *    fallback for grammars whose optimizer applied tail-factoring — that
 *    is an AST-only optimization the NFA compiler refuses).
 * 2. Runs `findGrammarOverlap` pairwise across every cross-schema pair.
 * 3. For each detected overlap, also runs the witness through the AST
 *    matcher against the *original* (un-stripped) grammar so the report
 *    can show what the runtime dispatcher would actually do with that
 *    input — far more actionable than the rule pattern alone when the
 *    top-level rule is a single dispatching `<rules>` reference.
 *
 * Output is structured for downstream tooling: schema metadata, per-pair
 * collision records keyed by canonical `"schemaA|schemaB"`, plus a list of
 * skipped schemas with reasons.  Both consumers (HTML renderer in the
 * dispatcher; JSON dump in the CLI) work directly off this result.
 */

import {
    type Grammar,
    type GrammarPart,
    type GrammarRule,
    type DispatchModeBucket,
    type RulesPart,
    compileGrammarToNFA,
    matchGrammar,
} from "action-grammar";
import { findGrammarOverlap } from "./nfaIntersection.js";

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

export interface SchemaInput {
    schemaName: string;
    /** Optional human-friendly name (e.g. the agent's package name). */
    agentName?: string | undefined;
    /** Parsed grammar.  Caller is responsible for JSON parse / validation. */
    grammar: Grammar;
}

export interface SchemaScanInfo {
    schemaName: string;
    agentName?: string | undefined;
    rulesCount: number;
    /**
     * True when the NFA compile succeeded only after stripping `tailCall`
     * markers from the grammar.  Surfaced so callers can flag rules whose
     * action interpretation might differ between the optimizer and the
     * NFA path (the language they accept is the same; the bindings flow
     * is what `tailCall` changes).
     */
    compiledWithStripping: boolean;
}

export interface SchemaSkip {
    schemaName: string;
    reason: "compile-error";
    error: string;
}

export interface CollisionRecord {
    /** Canonical key — alphabetically smaller schema first. */
    schemaA: string;
    schemaB: string;
    /** Token sequence accepted by both grammars. */
    witness: string[];
    /** `witness.join(" ")` — convenience for filtering / display. */
    witnessText: string;
    /**
     * True when the witness contains synthetic `<TypeName>` placeholders
     * because at least one wildcard requires a custom entity type whose
     * accepted strings can't be enumerated by the scanner.  Witnesses of
     * this kind are evidence of *possible* overlap — manual review needed.
     */
    hasPlaceholders: boolean;
    /** Top-level alternative index in schema A's compiled grammar. */
    ruleIndexA?: number | undefined;
    ruleIndexB?: number | undefined;
    /** Pretty-printed rule pattern (e.g. `play $(track:string)`). */
    rulePatternA?: string | undefined;
    rulePatternB?: string | undefined;
    /**
     * The action object the AST matcher produces for this witness.
     * Undefined when the witness contains placeholders (the AST matcher
     * would correctly reject those at the entity-validation step).
     */
    matchA?: unknown;
    matchB?: unknown;
}

export interface CollisionScanResult {
    /** ISO-8601 timestamp at the start of the scan. */
    scannedAt: string;
    /** Schemas that compiled and participated in pairwise checks. */
    schemas: Record<string, SchemaScanInfo>;
    /** Schemas that failed to compile (with the error). */
    skipped: SchemaSkip[];
    /** Total `rulesCount` across all scanned schemas. */
    totalRules: number;
    /**
     * Detected collisions, keyed by canonical `"schemaA|schemaB"`
     * (alphabetical) so the result is stable across runs and easy to diff.
     */
    collisions: Record<string, CollisionRecord>;
}

export interface ScanOptions {
    /**
     * Optional per-step progress callback.  Two phases: compile (one call
     * per schema) and pairwise (one call per pair).  No-op by default.
     */
    onProgress?: (
        phase: "compile" | "pair",
        index: number,
        total: number,
        label: string,
    ) => void;
}

/**
 * Scan a list of pre-loaded grammars for cross-schema collisions and
 * return a structured, JSON-serializable report.  See module docstring
 * for the algorithm.
 */
export function scanGrammarCollisions(
    inputs: SchemaInput[],
    options?: ScanOptions,
): CollisionScanResult {
    const onProgress = options?.onProgress ?? (() => {});

    // ---- Phase 1: compile each grammar (with tailCall strip fallback) ----

    type Loaded = {
        schemaName: string;
        agentName?: string | undefined;
        /** Grammar handed to the NFA compiler (possibly tail-call-stripped). */
        compileGrammar: Grammar;
        /** Pre-strip grammar; AST matcher uses this so action values are accurate. */
        originalGrammar: Grammar;
        rules: GrammarRule[];
        nfa: ReturnType<typeof compileGrammarToNFA>;
        compiledWithStripping: boolean;
    };

    const loaded: Loaded[] = [];
    const skipped: SchemaSkip[] = [];

    for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        onProgress("compile", i + 1, inputs.length, input.schemaName);
        let nfa: ReturnType<typeof compileGrammarToNFA> | undefined;
        let compileGrammar: Grammar = input.grammar;
        let stripped = false;
        try {
            nfa = compileGrammarToNFA(compileGrammar, input.schemaName);
        } catch (err) {
            // tailCall markers are an AST-only optimizer artifact — strip
            // and retry.  If it still fails, the grammar is genuinely
            // incompatible with NFA compilation.
            const strippedGrammar = stripTailCalls(input.grammar);
            try {
                nfa = compileGrammarToNFA(strippedGrammar, input.schemaName);
                compileGrammar = strippedGrammar;
                stripped = true;
            } catch (err2) {
                skipped.push({
                    schemaName: input.schemaName,
                    reason: "compile-error",
                    error: errorMessage(err2 ?? err),
                });
                continue;
            }
        }
        loaded.push({
            schemaName: input.schemaName,
            agentName: input.agentName,
            compileGrammar,
            originalGrammar: input.grammar,
            rules: collectTopLevelRules(compileGrammar),
            nfa,
            compiledWithStripping: stripped,
        });
    }

    // ---- Phase 2: pairwise overlap ----

    // Sort by schema name so canonical keys (alphabetical pair) are
    // generated in deterministic order — keeps the JSON stable for diffs.
    loaded.sort((a, b) => a.schemaName.localeCompare(b.schemaName));

    const totalPairs = (loaded.length * (loaded.length - 1)) / 2;
    let pairIndex = 0;

    const collisions: Record<string, CollisionRecord> = {};
    for (let i = 0; i < loaded.length; i++) {
        for (let j = i + 1; j < loaded.length; j++) {
            pairIndex++;
            onProgress(
                "pair",
                pairIndex,
                totalPairs,
                `${loaded[i].schemaName} × ${loaded[j].schemaName}`,
            );
            const overlap = findGrammarOverlap(loaded[i].nfa, loaded[j].nfa);
            if (!overlap) continue;
            const witnessText = overlap.witness.join(" ");
            const ruleA =
                overlap.ruleIndexA !== undefined
                    ? loaded[i].rules[overlap.ruleIndexA]
                    : undefined;
            const ruleB =
                overlap.ruleIndexB !== undefined
                    ? loaded[j].rules[overlap.ruleIndexB]
                    : undefined;
            // Run the witness through each grammar's AST matcher (handles
            // tailCall natively, no strip needed) for the action-value
            // preview.  Skip when placeholders are present — the matcher
            // would reject them at runtime entity validation.
            let matchA: unknown;
            let matchB: unknown;
            if (!overlap.hasPlaceholders) {
                matchA = matchGrammar(loaded[i].originalGrammar, witnessText)[0]
                    ?.match;
                matchB = matchGrammar(loaded[j].originalGrammar, witnessText)[0]
                    ?.match;
            }
            const key = `${loaded[i].schemaName}|${loaded[j].schemaName}`;
            collisions[key] = {
                schemaA: loaded[i].schemaName,
                schemaB: loaded[j].schemaName,
                witness: overlap.witness,
                witnessText,
                hasPlaceholders: overlap.hasPlaceholders,
                ruleIndexA: overlap.ruleIndexA,
                ruleIndexB: overlap.ruleIndexB,
                rulePatternA: ruleA
                    ? formatRulePartsText(ruleA.parts)
                    : undefined,
                rulePatternB: ruleB
                    ? formatRulePartsText(ruleB.parts)
                    : undefined,
                matchA,
                matchB,
            };
        }
    }

    // ---- Build the schemas index ----

    const schemas: Record<string, SchemaScanInfo> = {};
    let totalRules = 0;
    for (const l of loaded) {
        schemas[l.schemaName] = {
            schemaName: l.schemaName,
            agentName: l.agentName,
            rulesCount: l.rules.length,
            compiledWithStripping: l.compiledWithStripping,
        };
        totalRules += l.rules.length;
    }

    return {
        scannedAt: new Date().toISOString(),
        schemas,
        skipped,
        totalRules,
        collisions,
    };
}

// ---------------------------------------------------------------------------
// Plain-text rule pattern formatter (shared with the dispatcher renderer
// and emitted into the JSON for downstream tooling that doesn't want to
// re-walk GrammarParts).
// ---------------------------------------------------------------------------

/**
 * Render a `GrammarPart` sequence as a compact human-readable pattern,
 * e.g. `play $(track:string)`.  Doesn't try to round-trip back to `.agr`
 * source — the goal is "enough to identify the rule at a glance."
 */
export function formatRulePartsText(parts: GrammarPart[]): string {
    return parts.map(formatPartText).join(" ");
}

function formatPartText(part: GrammarPart): string {
    switch (part.type) {
        case "string":
            return part.value.join(" ");
        case "wildcard": {
            const ty = part.typeName ? `:${part.typeName}` : "";
            return `$(${part.variable}${ty})${part.optional ? "?" : ""}`;
        }
        case "number":
            return `$(${part.variable}:number)${part.optional ? "?" : ""}`;
        case "phraseSet":
            return `<${part.matcherName}>`;
        case "rules": {
            const opt = (part.optional ? "?" : "") + (part.repeat ? "*" : "");
            return `<rules>${opt}`;
        }
        default:
            return "?";
    }
}

/**
 * Flatten a grammar's top-level alternatives + dispatch buckets into a
 * single ordered list, matching the iteration order the NFA compiler uses
 * to assign `ruleIndex`es.  Callers pass an `overlap.ruleIndexA` into the
 * resulting array to look up the colliding rule.
 */
export function collectTopLevelRules(grammar: Grammar): GrammarRule[] {
    const rules: GrammarRule[] = [...grammar.alternatives];
    if (grammar.dispatch) {
        for (const bucket of grammar.dispatch) {
            for (const [, bucketRules] of bucket.tokenMap) {
                for (const r of bucketRules) {
                    rules.push(r);
                }
            }
        }
    }
    return rules;
}

// ---------------------------------------------------------------------------
// Tail-call stripping — preprocessing step for grammars optimized with the
// tail-factoring pass.  The NFA compiler refuses `RulesPart.tailCall: true`
// (it's an AST-matcher-only optimization).  Stripping the marker preserves
// the language the grammar accepts; only the optimizer's bindings-flow
// shortcut is lost, which doesn't affect collision detection at all.
// ---------------------------------------------------------------------------

/**
 * Action-value placeholder injected when stripping a tail-call marker
 * leaves a multi-part rule with `value === undefined`.  The compiler's
 * structural check requires a value expression on multi-part rules; the
 * placeholder satisfies that check without changing the NFA's accepted
 * language.  Action values evaluated downstream from this scanner's
 * compile path will see this placeholder, but the scanner only uses the
 * NFA for *language overlap* — it asks the AST matcher (against the
 * un-stripped grammar) whenever it needs an actual action value.
 */
const TAILCALL_PLACEHOLDER_VALUE = {
    type: "literal" as const,
    value: true,
};

/**
 * Recursively remove `tailCall: true` markers from every `RulesPart` in
 * the grammar.  Returns a fresh grammar; the input is untouched.
 */
export function stripTailCalls(grammar: Grammar): Grammar {
    return {
        ...grammar,
        alternatives: grammar.alternatives.map(stripRule),
        dispatch: grammar.dispatch?.map(stripBucket),
    };
}

function stripBucket(b: DispatchModeBucket): DispatchModeBucket {
    const newMap = new Map<string, GrammarRule[]>();
    for (const [k, rules] of b.tokenMap) {
        newMap.set(k, rules.map(stripRule));
    }
    return { ...b, tokenMap: newMap };
}

function stripRule(rule: GrammarRule): GrammarRule {
    let hadTailCall = false;
    const newParts = rule.parts.map((p) => {
        if (p.type !== "rules") return p;
        if (p.tailCall) hadTailCall = true;
        return stripRulesPart(p);
    });
    let value = rule.value;
    if (hadTailCall && value === undefined && newParts.length > 1) {
        value = TAILCALL_PLACEHOLDER_VALUE;
    }
    return { ...rule, parts: newParts, value };
}

function stripRulesPart(part: RulesPart): RulesPart {
    const { tailCall: _drop, ...rest } = part;
    return {
        ...rest,
        alternatives: part.alternatives.map(stripRule),
        dispatch: part.dispatch?.map(stripBucket),
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}
