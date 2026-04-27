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

/**
 * Broad-coverage defaults for the fuzz generator.  Every feature
 * group is exercised so a caller who passes `DEFAULT_FEATURES` (or
 * runs the CLI with no `--features`) gets a representative sweep
 * across part kinds, value expressions, spacing, and quantifier
 * groups.  Literals are weighted 2x to keep them dominant since they
 * are the cheap, always-valid baseline.
 *
 * For a minimum-coverage baseline (only literals + rule refs) use
 * {@link MINIMAL_FEATURES}.
 */
export const DEFAULT_FEATURES: FuzzFeatureFlags = {
    partKinds: {
        literal: 2,
        ruleRef: 1,
        wildcard: 1,
        number: 1,
    },
    values: {
        attachProb: 0.5,
    },
    spacing: {
        altProb: 0.2,
        ruleProb: 0.2,
        modes: {
            required: 1,
            optional: 1,
            none: 1,
            auto: 1,
        },
    },
    groups: {
        optionalProb: 0.2,
        repeatProb: 0.2,
    },
};

/**
 * Minimum-coverage feature set: only literals and rule references are
 * enabled, every probability is 0.  Useful for narrow regression
 * checks or as a starting point for callers that want to enable a
 * single dimension at a time.
 */
export const MINIMAL_FEATURES: FuzzFeatureFlags = {
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

export function clamp01(x: number): number {
    if (!(x > 0)) return 0;
    if (x > 1) return 1;
    return x;
}

/**
 * Weighted pick from `(item, weight)` entries.  Negative weights are
 * treated as 0.  Returns `undefined` if all weights are <= 0.
 */
export function weightedPick<T>(
    rng: () => number,
    entries: ReadonlyArray<readonly [T, number]>,
): T | undefined {
    let total = 0;
    let lastPositive: T | undefined;
    for (const [item, w] of entries) {
        if (w > 0) {
            total += w;
            lastPositive = item;
        }
    }
    if (total <= 0) return undefined;
    let r = rng() * total;
    for (const [item, w] of entries) {
        if (w <= 0) continue;
        r -= w;
        if (r < 0) return item;
    }
    // Floating-point fall-through: by construction `r` should reach
    // <0 above, but rounding can leave it at exactly 0 on the last
    // entry.  Return the last positive-weight item in that case.
    return lastPositive;
}

// ── Feature field descriptors ─────────────────────────────────────────────────

/**
 * Single source of truth for the {@link FuzzFeatureFlags} schema.
 * Each descriptor knows its canonical dotted path and how to read /
 * write its slot.  All other tables (CLI parser, diagnostic
 * summary, zero-out helper) derive from this list.
 */
export type FeatureFieldDescriptor = {
    /** Canonical dotted path, e.g. `"partKinds.wildcard"`. */
    readonly path: string;
    /** Read the field's current value. */
    readonly get: (f: FuzzFeatureFlags) => number;
    /** Write a value into the field. */
    readonly set: (f: FuzzFeatureFlags, value: number) => void;
};

export const FEATURE_FIELDS: readonly FeatureFieldDescriptor[] = [
    {
        path: "partKinds.literal",
        get: (f) => f.partKinds.literal,
        set: (f, v) => {
            f.partKinds.literal = v;
        },
    },
    {
        path: "partKinds.ruleRef",
        get: (f) => f.partKinds.ruleRef,
        set: (f, v) => {
            f.partKinds.ruleRef = v;
        },
    },
    {
        path: "partKinds.wildcard",
        get: (f) => f.partKinds.wildcard,
        set: (f, v) => {
            f.partKinds.wildcard = v;
        },
    },
    {
        path: "partKinds.number",
        get: (f) => f.partKinds.number,
        set: (f, v) => {
            f.partKinds.number = v;
        },
    },
    {
        path: "values.attachProb",
        get: (f) => f.values.attachProb,
        set: (f, v) => {
            f.values.attachProb = v;
        },
    },
    {
        path: "spacing.altProb",
        get: (f) => f.spacing.altProb,
        set: (f, v) => {
            f.spacing.altProb = v;
        },
    },
    {
        path: "spacing.ruleProb",
        get: (f) => f.spacing.ruleProb,
        set: (f, v) => {
            f.spacing.ruleProb = v;
        },
    },
    {
        path: "spacing.modes.required",
        get: (f) => f.spacing.modes.required,
        set: (f, v) => {
            f.spacing.modes.required = v;
        },
    },
    {
        path: "spacing.modes.optional",
        get: (f) => f.spacing.modes.optional,
        set: (f, v) => {
            f.spacing.modes.optional = v;
        },
    },
    {
        path: "spacing.modes.none",
        get: (f) => f.spacing.modes.none,
        set: (f, v) => {
            f.spacing.modes.none = v;
        },
    },
    {
        path: "spacing.modes.auto",
        get: (f) => f.spacing.modes.auto,
        set: (f, v) => {
            f.spacing.modes.auto = v;
        },
    },
    {
        path: "groups.optionalProb",
        get: (f) => f.groups.optionalProb,
        set: (f, v) => {
            f.groups.optionalProb = v;
        },
    },
    {
        path: "groups.repeatProb",
        get: (f) => f.groups.repeatProb,
        set: (f, v) => {
            f.groups.repeatProb = v;
        },
    },
];

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

/**
 * Pick a spacing mode by weight.  Returns `undefined` if every mode
 * weight is `0` so the caller can skip the annotation entirely
 * (rather than silently falling back to a uniform pick).
 */
export function pickSpacingMode(
    rng: () => number,
    weights: SpacingModeWeights,
): SpacingMode | undefined {
    const entries: ReadonlyArray<readonly [SpacingMode, number]> = [
        ["required", weights.required],
        ["optional", weights.optional],
        ["none", weights.none],
        ["auto", weights.auto],
    ];
    return weightedPick(rng, entries);
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

    // Hoist clamped probabilities out of the inner loop.
    const optionalProb = clamp01(features.groups.optionalProb);
    const repeatProb = clamp01(features.groups.repeatProb);
    const valueAttachProb = clamp01(features.values.attachProb);
    const altSpacingProb = clamp01(features.spacing.altProb);
    const ruleSpacingProb = clamp01(features.spacing.ruleProb);

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
                let captureVar: string | undefined;
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
                        captureVar = wc.varName;
                        break;
                    }
                    case "number": {
                        const np = buildNumberPart(rng, varCounter);
                        innerText = np.text;
                        innerMatch = np.matchTokens;
                        captureVar = np.varName;
                        break;
                    }
                }

                // Optionally wrap the part in an optional / repeat
                // group.  The two probabilities are rolled
                // independently and combined into a single quantifier.
                //
                // Captures inside a quantifier group are not visible
                // to the alternate's value expression (they would be
                // optional or aggregated), so we keep capture parts
                // unwrapped.  This decouples the `groups.*Prob` and
                // `values.attachProb` dimensions: every capture stays
                // exposed regardless of group rolls.
                const canWrap = captureVar === undefined;
                const optional = canWrap && rng() < optionalProb;
                const repeat = canWrap && rng() < repeatProb;
                let partText = innerText;
                let repCount = 1;
                if (optional && repeat) {
                    partText = `(${innerText})*`;
                    // `*` matches 0..N: emit 0..2 copies.
                    repCount = intInRange(rng, 0, 2);
                } else if (optional) {
                    partText = `(${innerText})?`;
                    // `?` matches 0..1.
                    repCount = intInRange(rng, 0, 1);
                } else if (repeat) {
                    partText = `(${innerText})+`;
                    // `+` matches 1..N: emit 1..3 copies.
                    repCount = intInRange(rng, 1, 3);
                }

                if (captureVar !== undefined) {
                    altBoundVars.push(captureVar);
                }

                partTexts.push(partText);
                // Replicate the inner expansion `repCount` times to
                // exercise multi-rep semantics for `+` and `*` (and
                // zero-rep elision for `?` and `*`).
                for (let r = 0; r < repCount; r++)
                    partMatch.push(...innerMatch);
            }

            // Build value expression for this alternative if enabled.
            // `features.values.attachProb` is the per-alternate attach
            // probability (only eligible when captures exist).
            let valueText = "";
            if (altBoundVars.length > 0 && rng() < valueAttachProb) {
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

            // Per-alternate spacing annotation.  If every mode weight
            // is 0 the picker returns undefined and we skip the
            // annotation rather than fall back to uniform.
            let spacingText = "";
            if (rng() < altSpacingProb) {
                const mode = pickSpacingMode(rng, features.spacing.modes);
                if (mode !== undefined) {
                    spacingText = spacingAnnotation(mode);
                }
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
        // Rule-level spacing annotation.  Skip when every mode weight
        // is 0 (see per-alternate annotation above).
        let ruleSpacing = "";
        if (rng() < ruleSpacingProb) {
            const mode = pickSpacingMode(rng, features.spacing.modes);
            if (mode !== undefined) {
                ruleSpacing = spacingAnnotation(mode);
            }
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
