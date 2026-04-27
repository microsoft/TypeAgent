// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Composable random grammar builder for fuzz testing.
 *
 * Generates structurally valid `.agr` grammar text along with inputs
 * that are guaranteed to match (and a few that deliberately do not).
 *
 * Generation is controlled by {@link FuzzFeatureFlags}, a record
 * grouped by **area of impact** (part kinds, value expressions,
 * spacing, groups).  Within each group, fields named `*Prob` are
 * probabilities in `[0, 1]`; other numeric fields are relative
 * weights for a weighted random pick.
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

/**
 * Knobs that bias which kind of part the generator emits in each
 * token slot of an alternative.  Values are **relative weights** for
 * a weighted random pick.  `0` disables a kind; equal positive values
 * yield uniform selection; larger values bias toward that kind
 * (e.g. `wildcard: 5` with the others at `1` picks wildcards ~5x as
 * often).  `literal` is the safe fallback when no other kind is
 * available in a position.
 */
export type PartKindWeights = {
    /** Weight for literal string tokens. */
    literal: number;
    /** Weight for `<RuleName>` references (DAG-shaped, no cycles). */
    ruleRef: number;
    /** Weight for `$(varN:string)` wildcard captures. */
    wildcard: number;
    /** Weight for `$(varN:number)` numeric captures. */
    number: number;
};

/**
 * Knobs controlling `-> value` expressions on alternates.
 */
export type ValueFeatures = {
    /**
     * Probability in `[0, 1]` of attaching a `-> value` expression
     * to an alternate that has at least one capture.  Clamped.
     */
    attachProb: number;
};

/**
 * Relative weights for which `[spacing=...]` mode to pick when an
 * annotation is attached.  Same semantics as {@link PartKindWeights}.
 * If all four are 0, modes are picked uniformly.
 */
export type SpacingModeWeights = {
    required: number;
    optional: number;
    none: number;
    auto: number;
};

/**
 * Knobs controlling `[spacing=...]` annotations on alternates and
 * rules.  Probabilities are independent: `altProb` is checked once
 * per alternate; `ruleProb` once per rule.
 */
export type SpacingFeatures = {
    /** Probability per alternate of attaching a spacing annotation. */
    altProb: number;
    /** Probability per rule of attaching a spacing annotation. */
    ruleProb: number;
    /** Relative weights for the spacing mode that gets picked. */
    modes: SpacingModeWeights;
};

/**
 * Knobs for optional / repeat groups around individual parts.
 *
 * For each emitted part, the generator independently rolls
 * `optionalProb` and `repeatProb`; the combination determines the
 * quantifier wrapped around the part text:
 *
 *   - neither: bare part (no group)
 *   - optional only: `(part)?`
 *   - repeat only:   `(part)+`
 *   - both:          `(part)*`
 *
 * The matching input always emits the inner expansion exactly once,
 * which satisfies all three quantifier forms.
 */
export type GroupFeatures = {
    /** Probability per part of being wrapped in an optional group. */
    optionalProb: number;
    /** Probability per part of being wrapped in a repeat group. */
    repeatProb: number;
};

/**
 * Composable feature configuration for the random grammar generator.
 *
 * Knobs are grouped by **area of impact** so callers can tell at a
 * glance which dimension they are tuning.  Within each group:
 *
 *   - Fields named `*Prob` are probabilities in `[0, 1]` (clamped).
 *   - Other numeric fields are relative weights for a weighted random
 *     pick (`0` disables; equal positive values are uniform).
 */
export type FuzzFeatureFlags = {
    /** Which kind of part to emit in each token slot. */
    partKinds: PartKindWeights;
    /** `-> value` expressions on alternates. */
    values: ValueFeatures;
    /** `[spacing=...]` annotations and which modes to pick. */
    spacing: SpacingFeatures;
    /** Optional / repeat group quantifiers around individual parts. */
    groups: GroupFeatures;
};

export const DEFAULT_FEATURES: FuzzFeatureFlags = {
    partKinds: {
        literal: 1,
        ruleRef: 1,
        wildcard: 0,
        number: 0,
    },
    values: {
        attachProb: 0,
    },
    spacing: {
        altProb: 0,
        ruleProb: 0,
        modes: {
            required: 1,
            optional: 1,
            none: 1,
            auto: 1,
        },
    },
    groups: {
        optionalProb: 0,
        repeatProb: 0,
    },
};

function clamp01(x: number): number {
    if (!(x > 0)) return 0;
    if (x > 1) return 1;
    return x;
}

/**
 * Weighted pick from `(item, weight)` entries.  Negative weights are
 * treated as 0.  Returns `undefined` if all weights are <= 0.
 */
function weightedPick<T>(
    rng: () => number,
    entries: ReadonlyArray<readonly [T, number]>,
): T | undefined {
    let total = 0;
    for (const [, w] of entries) {
        if (w > 0) total += w;
    }
    if (total <= 0) return undefined;
    let r = rng() * total;
    for (const [item, w] of entries) {
        if (w <= 0) continue;
        r -= w;
        if (r < 0) return item;
    }
    // Numeric edge case: return the last positive-weight item.
    for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i][1] > 0) return entries[i][0];
    }
    return undefined;
}

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
function pickSpacingMode(
    rng: () => number,
    weights: SpacingModeWeights,
): SpacingMode {
    const entries: ReadonlyArray<readonly [SpacingMode, number]> = [
        ["required", weights.required],
        ["optional", weights.optional],
        ["none", weights.none],
        ["auto", weights.auto],
    ];
    // Fall back to uniform if all weights are 0.
    return weightedPick(rng, entries) ?? pick(rng, SPACING_MODES);
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

                let innerText: string;
                let innerMatch: string[];
                switch (partKind) {
                    case "literal": {
                        const lit = buildLiteralPart(rng, words);
                        innerText = lit.text;
                        innerMatch = lit.matchTokens;
                        break;
                    }
                    case "ruleRef": {
                        const target = intInRange(rng, i + 1, ruleCount - 1);
                        innerText = `<${ruleName(target)}>`;
                        innerMatch = ruleStates[target].firstAltMatch;
                        break;
                    }
                    case "wildcard": {
                        const wc = buildWildcardPart(rng, varCounter, words);
                        innerText = wc.text;
                        innerMatch = wc.matchTokens;
                        altBoundVars.push(wc.varName);
                        break;
                    }
                    case "number": {
                        const np = buildNumberPart(rng, varCounter);
                        innerText = np.text;
                        innerMatch = np.matchTokens;
                        altBoundVars.push(np.varName);
                        break;
                    }
                }

                // Optionally wrap the part in an optional / repeat
                // group.  The two probabilities are rolled
                // independently and combined into a single quantifier.
                const optional = rng() < clamp01(features.groups.optionalProb);
                const repeat = rng() < clamp01(features.groups.repeatProb);
                let partText = innerText;
                if (optional && repeat) partText = `(${innerText})*`;
                else if (optional) partText = `(${innerText})?`;
                else if (repeat) partText = `(${innerText})+`;

                partTexts.push(partText);
                // The matching input includes the inner expansion
                // exactly once: this satisfies `?` (present), `+`
                // (one repetition), and `*` (one repetition) alike.
                partMatch.push(...innerMatch);
            }

            // Build value expression for this alternative if enabled.
            // `features.values.attachProb` is the per-alternate attach
            // probability (only eligible when captures exist).
            let valueText = "";
            if (
                altBoundVars.length > 0 &&
                rng() < clamp01(features.values.attachProb)
            ) {
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
            if (rng() < clamp01(features.spacing.altProb)) {
                const mode = pickSpacingMode(rng, features.spacing.modes);
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
        if (rng() < clamp01(features.spacing.ruleProb)) {
            ruleSpacing = spacingAnnotation(
                pickSpacingMode(rng, features.spacing.modes),
            );
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
    // ruleRef requires a forward rule to point at; otherwise force its
    // weight to 0.  Other kinds are always available.
    const ruleRefAvailable = ruleIndex + 1 < ruleCount;
    const kinds = features.partKinds;
    const entries: ReadonlyArray<readonly [PartKind, number]> = [
        ["literal", kinds.literal],
        ["ruleRef", ruleRefAvailable ? kinds.ruleRef : 0],
        ["wildcard", kinds.wildcard],
        ["number", kinds.number],
    ];
    // Fallback to literal if no kind has positive weight in this slot.
    return weightedPick(rng, entries) ?? "literal";
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
