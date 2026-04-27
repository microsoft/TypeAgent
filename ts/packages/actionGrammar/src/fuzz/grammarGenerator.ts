// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Composable random grammar builder for fuzz testing.
 *
 * Generates structurally valid `.agr` grammar text along with inputs
 * that are guaranteed to match (and a few that deliberately do not).
 *
 * Each grammar feature (wildcards, numbers, optional groups, spacing
 * modes, value expressions, ...) is toggled independently via
 * {@link FuzzFeatureFlags} so callers can explore specific dimensions.
 */

// ── PRNG ──────────────────────────────────────────────────────────────────────

/** Mulberry32: small, deterministic 32-bit PRNG. */
export function makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function pick<T>(rng: () => number, xs: readonly T[]): T {
    return xs[Math.floor(rng() * xs.length)];
}

export function intInRange(rng: () => number, lo: number, hi: number): number {
    return lo + Math.floor(rng() * (hi - lo + 1));
}

// ── Feature flags ─────────────────────────────────────────────────────────────

export type FuzzFeatureFlags = {
    /** Literal string tokens (always safe to enable). */
    literals: boolean;
    /** `<RuleName>` references (DAG-shaped, no cycles). */
    ruleRefs: boolean;
    /** `$(varN:string)` wildcard captures. */
    wildcards: boolean;
    /** `$(varN:number)` numeric captures. */
    numbers: boolean;
    /** `(...)?` optional groups. NOT YET IMPLEMENTED: accepted but ignored by the generator. */
    optionals: boolean;
    /** `()*` / `()+` repeat groups. NOT YET IMPLEMENTED: accepted but ignored by the generator. */
    repeats: boolean;
    /** Value expressions after `->` (object literals, binary ops, etc.). */
    values: boolean;
    /** Random `[spacing=required|optional|none|auto]` per rule/alternate. */
    spacingModes: boolean;
};

export const DEFAULT_FEATURES: FuzzFeatureFlags = {
    literals: true,
    ruleRefs: true,
    wildcards: false,
    numbers: false,
    optionals: false,
    repeats: false,
    values: false,
    spacingModes: false,
};

// ── Generation config ─────────────────────────────────────────────────────────

export type GeneratorConfig = {
    maxRules: number;
    maxAlts: number;
    maxParts: number;
    words: readonly string[];
};

export const DEFAULT_GENERATOR_CONFIG: GeneratorConfig = {
    maxRules: 4,
    maxAlts: 4,
    maxParts: 4,
    words: ["a", "b", "c", "d", "e"],
};

// ── Grammar output ────────────────────────────────────────────────────────────

export type GeneratedGrammar = {
    /** Full `.agr` source text. */
    text: string;
    /**
     * Pre-computed test inputs: a matching expansion, a non-matching
     * token, and a truncated prefix.  Not all entries are expected to
     * match; the set is designed for equivalence checking.
     */
    testInputs: string[];
    /** Whether the grammar uses value expressions (needs enableValueExpressions). */
    usesValueExpressions: boolean;
    /** Whether the grammar needs startValueRequired=false. */
    startValueRequired: boolean;
};

// ── Spacing helpers ───────────────────────────────────────────────────────────

const SPACING_MODES = ["required", "optional", "none", "auto"] as const;
type SpacingMode = (typeof SPACING_MODES)[number];

function spacingAnnotation(mode: SpacingMode): string {
    return ` [spacing=${mode}]`;
}

// ── Internal state while building a single grammar ────────────────────────────

type RuleState = {
    /** Accumulated `.agr` lines for this rule's alternatives. */
    altTexts: string[];
    /** Tokens of the first alternative's expansion (for matching input). */
    firstAltMatch: string[];
    /** Variable names bound by wildcard/number captures in this rule. */
    boundVars: string[];
    /** True if any alternative produces a value via `->`. */
    hasValue: boolean;
};

// ── Part builders ─────────────────────────────────────────────────────────────

function buildLiteralPart(
    rng: () => number,
    words: readonly string[],
): { text: string; matchTokens: string[] } {
    const w = pick(rng, words);
    return { text: w, matchTokens: [w] };
}

function buildWildcardPart(
    rng: () => number,
    varCounter: { n: number },
    words: readonly string[],
): { text: string; matchTokens: string[]; varName: string } {
    const name = `v${varCounter.n++}`;
    // The matching input fills the wildcard slot with a random word.
    const fillWord = pick(rng, words);
    return {
        text: `$(${name}:string)`,
        matchTokens: [fillWord],
        varName: name,
    };
}

function buildNumberPart(
    rng: () => number,
    varCounter: { n: number },
): {
    text: string;
    matchTokens: string[];
    varName: string;
} {
    const name = `n${varCounter.n++}`;
    // Matching input uses a random small integer so that repeated
    // number parts can receive the same value, exercising value-binding
    // edge cases.
    const num = String(intInRange(rng, 1, 99));
    return {
        text: `$(${name}:number)`,
        matchTokens: [num],
        varName: name,
    };
}

// ── Value expression builder ──────────────────────────────────────────────────

/**
 * Build a random value expression referencing the given bound variables.
 * Stays within the safe subset: object literals, variable refs, binary
 * `+` / `===`, ternary, template literals.  No method calls.
 */
function buildValueExpr(rng: () => number, boundVars: string[]): string {
    if (boundVars.length === 0) {
        // No variables to reference: emit a literal.
        return `"fixed"`;
    }

    const kind = intInRange(rng, 0, 5);
    switch (kind) {
        case 0: {
            // Simple variable reference.
            return pick(rng, boundVars);
        }
        case 1: {
            // Object literal: { actionName: "act", parameters: { v0, v1 } }
            const props = boundVars.map((v) => `${v}`).join(", ");
            return `{ actionName: "act", parameters: { ${props} } }`;
        }
        case 2: {
            // Binary ===
            const v = pick(rng, boundVars);
            return `${v} === "a"`;
        }
        case 3: {
            // Ternary
            const v = pick(rng, boundVars);
            return `${v} === "a" ? "yes" : "no"`;
        }
        case 4: {
            // Template literal
            const v = pick(rng, boundVars);
            return `\`hello \${${v}}\``;
        }
        case 5:
        default: {
            // Array literal
            const elems = boundVars.slice(0, 3).join(", ");
            return `[${elems}]`;
        }
    }
}

// ── Top-level grammar builder ─────────────────────────────────────────────────

export function buildRandomGrammar(
    rng: () => number,
    features: FuzzFeatureFlags,
    config: GeneratorConfig = DEFAULT_GENERATOR_CONFIG,
): GeneratedGrammar {
    const { maxRules, maxAlts, maxParts, words } = config;
    const ruleCount = intInRange(rng, 1, maxRules);
    const ruleName = (i: number) => `R${i}`;

    const varCounter = { n: 0 };
    let usesValueExpressions = false;

    // Build rules in reverse so rule i can reference rules > i.
    const ruleStates: RuleState[] = new Array(ruleCount);

    for (let i = ruleCount - 1; i >= 0; i--) {
        const altCount = intInRange(rng, 1, maxAlts);
        const state: RuleState = {
            altTexts: [],
            firstAltMatch: [],
            boundVars: [],
            hasValue: false,
        };

        for (let a = 0; a < altCount; a++) {
            const partCount = intInRange(rng, 1, maxParts);
            const partTexts: string[] = [];
            const partMatch: string[] = [];
            const altBoundVars: string[] = [];

            for (let p = 0; p < partCount; p++) {
                const partKind = choosePartKind(rng, features, i, ruleCount);

                switch (partKind) {
                    case "literal": {
                        const lit = buildLiteralPart(rng, words);
                        partTexts.push(lit.text);
                        partMatch.push(...lit.matchTokens);
                        break;
                    }
                    case "ruleRef": {
                        const target = intInRange(rng, i + 1, ruleCount - 1);
                        partTexts.push(`<${ruleName(target)}>`);
                        partMatch.push(...ruleStates[target].firstAltMatch);
                        break;
                    }
                    case "wildcard": {
                        const wc = buildWildcardPart(rng, varCounter, words);
                        partTexts.push(wc.text);
                        partMatch.push(...wc.matchTokens);
                        altBoundVars.push(wc.varName);
                        break;
                    }
                    case "number": {
                        const np = buildNumberPart(rng, varCounter);
                        partTexts.push(np.text);
                        partMatch.push(...np.matchTokens);
                        altBoundVars.push(np.varName);
                        break;
                    }
                }
            }

            // Build value expression for this alternative if enabled.
            let valueText = "";
            if (features.values && altBoundVars.length > 0 && rng() < 0.7) {
                const expr = buildValueExpr(rng, altBoundVars);
                valueText = ` -> ${expr}`;
                state.hasValue = true;
                // Check if the expression uses operators/templates that
                // require enableValueExpressions.
                if (
                    expr.includes("===") ||
                    expr.includes("?") ||
                    expr.includes("`")
                ) {
                    usesValueExpressions = true;
                }
            }

            // Per-alternate spacing annotation.
            let spacingText = "";
            if (features.spacingModes && rng() < 0.3) {
                const mode = pick(rng, SPACING_MODES);
                spacingText = spacingAnnotation(mode);
            }

            state.altTexts.push(
                `${spacingText}${partTexts.join(" ")}${valueText}`,
            );
            if (a === 0) {
                state.firstAltMatch = partMatch;
                state.boundVars = altBoundVars;
            }
        }

        ruleStates[i] = state;
    }

    // Build rule definition lines.
    const lines: string[] = [];
    for (let i = ruleCount - 1; i >= 0; i--) {
        const state = ruleStates[i];
        // Rule-level spacing annotation.
        let ruleSpacing = "";
        if (features.spacingModes && rng() < 0.4) {
            ruleSpacing = spacingAnnotation(pick(rng, SPACING_MODES));
        }
        lines.push(
            `<${ruleName(i)}>${ruleSpacing} = ${state.altTexts.join(" | ")};`,
        );
    }
    // Reverse so <R0> is defined first (cosmetic).
    lines.reverse();

    // Anchor the start symbol to <R0>.  The Start rule wraps R0 and
    // can't see R0's inner variables; R0's alternatives already carry
    // their own value expressions, so Start never needs one.
    const text = `<Start> = <R0>;\n${lines.join("\n")}`;

    // Matching input: the first-alternative expansion of <R0>.
    const matching = ruleStates[0].firstAltMatch.join(" ");
    // A definitely-non-matching input (token outside vocabulary).
    const nonMatching = "zzz";
    // A truncated input.
    const truncated = ruleStates[0].firstAltMatch.slice(0, -1).join(" ") || "x";

    return {
        text,
        testInputs: [matching, nonMatching, truncated],
        usesValueExpressions,
        // When inner rules produce values, the Start wrapper doesn't have
        // its own value expression, so set startValueRequired to false.
        startValueRequired: false,
    };
}

// ── Part kind selection ───────────────────────────────────────────────────────

type PartKind = "literal" | "ruleRef" | "wildcard" | "number";

function choosePartKind(
    rng: () => number,
    features: FuzzFeatureFlags,
    ruleIndex: number,
    ruleCount: number,
): PartKind {
    const candidates: PartKind[] = [];

    // Literals are always a candidate when enabled (and always the fallback).
    if (features.literals) candidates.push("literal");
    // Rule refs only when there's a forward rule available.
    if (features.ruleRefs && ruleIndex + 1 < ruleCount)
        candidates.push("ruleRef");
    if (features.wildcards) candidates.push("wildcard");
    if (features.numbers) candidates.push("number");

    // Fallback: if nothing else is available, emit a literal.
    if (candidates.length === 0) return "literal";

    return pick(rng, candidates);
}

// ── Random input generator ────────────────────────────────────────────────────

/**
 * Generate extra random inputs from the vocabulary to widen coverage
 * beyond the pre-computed matching/non-matching/truncated set.
 */
export function generateExtraInputs(
    rng: () => number,
    count: number,
    words: readonly string[],
): string[] {
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
        const len = intInRange(rng, 1, 5);
        const tokens: string[] = [];
        for (let t = 0; t < len; t++) tokens.push(pick(rng, words));
        result.push(tokens.join(" "));
    }
    return result;
}
