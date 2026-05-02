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
    /**
     * Weight for literals drawn from a per-rule "shared prefix" pool.
     * When picked, the generator emits a literal from a small pool
     * shared across the alternatives of the current rule, biasing
     * toward common leading literals across alternates.  Stresses
     * `factorCommonPrefixes` and the `dispatchifyAlternations` pass
     * which both rely on observing identical leading parts in
     * sibling alternatives.  At weight 0 the shared pool is never
     * sampled and behavior matches plain `literal` tokens.
     */
    sharedPrefix: number;
    /**
     * Weight for `$(varN:<RuleName>)` nested rule captures.  Like
     * `ruleRef` (DAG-shaped, no cycles) but binds a variable to the
     * inner rule's value (or implicit-default text), making the
     * variable visible to the surrounding alternate's value
     * expression.  Exercises the `RulesPart.variable` capture path,
     * which is otherwise reachable only through the inliner's
     * synthesized captures.
     */
    nestedRuleRef: number;
};

/**
 * Knobs controlling which vocabulary pool literal-bearing tokens
 * draw from.  The base `words` pool is always available; when a
 * `nonBoundaryWords` pool is configured on {@link GeneratorConfig}
 * the generator can also draw tokens that don't begin with a
 * word-boundary character.  These cases exercise the dispatch
 * pass's eligibility logic - non-boundary keys disqualify the
 * `auto` (undefined) spacing-mode partition.
 */
export type VocabularyFeatures = {
    /**
     * Probability in `[0, 1]` per literal slot of drawing from the
     * `nonBoundaryWords` pool instead of the default `words` pool.
     * Has no effect if `GeneratorConfig.nonBoundaryWords` is empty
     * or undefined.
     */
    nonBoundaryProb: number;
    /**
     * Probability in `[0, 1]` per *character* of a literal token of
     * being rewritten as an escape sequence (identity `\\c`, hex
     * `\\xHH`, unicode `\\uHHHH`, or unicode brace `\\u{HH}`).  The
     * matched input is unchanged - escapes are pure source-syntax
     * sugar.  Stresses the parser's `<EscapeSequence>` paths and the
     * writer's escape preservation.  Has no effect at 0.
     */
    escapeProb: number;
    /**
     * Probability in `[0, 1]` per literal slot of embedding a
     * separator character (punctuation or an escaped space `\\ `)
     * inside the literal.  Separator chars are normally consumed by
     * the matcher's flex-space logic; when they appear *inside* a
     * literal they must be matched as part of the token, not as a
     * separator.  This is a known bug-risk surface (the entire
     * `grammarMatcherKeywordSpacePunct.spec.ts` suite covers
     * hand-written cases).  Drawn from
     * {@link SEPARATOR_LITERAL_CHARS}.  Has no effect at 0.
     */
    separatorInLiteralProb: number;
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
    /**
     * Probability in `[0, 1]` of forcing every alternate within a
     * rule to share the same spacing-mode annotation (picked once at
     * rule scope and stamped on each alt).  When fired, overrides
     * the per-alternate roll for that rule.  Stresses
     * `dispatchifyAlternations`, which only buckets alternatives
     * sharing a spacing-mode partition - random per-alt
     * annotations almost never collide on the same mode in a small
     * grammar.
     */
    alignWithinRuleProb: number;
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
    /**
     * Probability per part of being wrapped in a bare `(...)` group
     * with no quantifier.  Produces a single-alternative `RulesPart`
     * around the inner part, exercising `inlineSingleAlternatives`
     * and the variable-leakage / value-substitution branches inside
     * `tryInlineRulesPart`.  Capture parts are skipped (the
     * surrounding wrapper would shift their visibility to the
     * alternate's value expression) so this composes cleanly with
     * `partKinds.wildcard` / `partKinds.number`.
     */
    singleAltGroupProb: number;
};

/**
 * Knobs controlling injection of `//` line and `/* ... *\/` block
 * comments at flex-space positions (between parts within an
 * alternate, between alternates, and before rule definitions).
 * Comments are pure parser-only fluff: they never change matching
 * behavior, so they primarily exercise the parser's comment
 * attachment and the writer's comment-preserving round-trip.
 */
export type CommentFeatures = {
    /**
     * Probability per flex-space slot of injecting a `//` line
     * comment.  Rolled independently from `blockProb`.
     */
    lineProb: number;
    /**
     * Probability per flex-space slot of injecting a `/* ... *\/`
     * block comment.  Rolled independently from `lineProb`.
     */
    blockProb: number;
};

/**
 * Knobs producing AST shapes that target specific optimizer passes.
 * Each is a probability in `[0, 1]`.
 */
export type ShapeFeatures = {
    /**
     * Probability per generated rule of being forced to a single
     * alternative (overrides the random `altCount` roll).  When the
     * rule is then referenced from another rule's parts, the
     * referencing site holds a `RulesPart` with one member - the
     * exact precondition for `inlineSingleAlternatives`.
     */
    singleAltRuleProb: number;
    /**
     * Probability per `ruleRef` slot of reusing a rule already
     * referenced earlier in the current rule (when any).  Increases
     * `RulesPart` reference counts on shared `GrammarRule[]` arrays,
     * stressing the `countRulesArrayRefs` path of the inliner (which
     * refuses to inline a body shared by more than one reference).
     */
    ruleRefReuseProb: number;
    /**
     * Probability per multi-alternate rule of being shaped for
     * `tailFactoring`: forces a shared leading literal across alts
     * and suppresses any value attachment on those alts.  Together
     * these create the "factorable fork in tail position of a
     * value-less parent rule" shape that turns into a `tailCall`
     * `RulesPart`.
     */
    tailFriendlyAltProb: number;
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
    /** Vocabulary-pool selection knobs. */
    vocabulary: VocabularyFeatures;
    /** AST-shape biases targeting specific optimizer passes. */
    shapes: ShapeFeatures;
    /** Comment injection at flex-space positions. */
    comments: CommentFeatures;
};

/**
 * Broad-coverage defaults for the fuzz generator.
 *
 * Decision rubric for whether a new knob should default-on here:
 *   default-on iff the knob is matcher-invariant OR cheap
 *   parser/writer-only stress AND a small probability (<= 0.1)
 *   does not materially shift the AST shape distribution that any
 *   single optimizer pass keys on.  Anything that converts whole
 *   rules into the factor / dispatch / inline-eligible shape, or
 *   that depends on a separately-configured pool, belongs in a
 *   targeted `fuzzDescribe` block instead so a regression points
 *   at the right pass.
 *
 * Mixes the four core part kinds with low-rate background
 * activity in dimensions whose outputs are matcher-invariant or
 * cheap parser/writer stress:
 *
 *   - `comments.lineProb` / `comments.blockProb` exercise the
 *     parser's comment attachment and the writer's round-trip
 *     without changing matching behavior.
 *   - `vocabulary.escapeProb` rewrites literal characters as escape
 *     sequences (matched text unchanged).
 *   - `vocabulary.separatorInLiteralProb` embeds punctuation /
 *     escaped-space inside literals - a known bug-risk surface
 *     (see the regression in `grammarOptimizerDispatch.spec.ts`
 *     for the dispatch-bucket-key bug this knob found in
 *     `classifyDispatchMember`).
 *   - `spacing.alignWithinRuleProb` makes
 *     `dispatchifyAlternations` actually fire in the broad pass
 *     by giving multiple alts of a rule a shared spacing-mode
 *     partition (which random per-alt rolls almost never produce
 *     across 4 modes in a small grammar).
 *
 * Knobs that change the AST shape profile noticeably stay at 0
 * here so the broad-pass output remains a recognizable random
 * grammar; targeted `fuzzDescribe` blocks turn those on
 * individually so a regression points at the right pass.  Per-knob
 * reasons (why even a small nonzero is worse than 0):
 *
 *   - `partKinds.sharedPrefix` and `shapes.tailFriendlyAltProb`
 *     force every alt of a rule to share a leading literal.  Each
 *     fired roll converts a whole rule into the
 *     factor/dispatch-eligible shape, so the broad pass would
 *     spend a fraction of its budget exercising the same passes
 *     the dedicated blocks already cover - and a regression in
 *     `factorCommonPrefixes` or `dispatchifyAlternations` would
 *     surface ambiguously across both surfaces.
 *   - `partKinds.nestedRuleRef` requires a value-producing forward
 *     target; it degrades silently to a plain ruleRef when none
 *     exists, so the *actual* rate depends on which rule slot rolls
 *     it.  At nonzero the broad pass mostly produces unobservable
 *     no-ops, with rare bursts of capture-chain activity that the
 *     `partKinds.nestedRuleRef` block already covers cleanly.
 *   - `vocabulary.nonBoundaryProb` is double-gated: it has no
 *     effect unless `GeneratorConfig.nonBoundaryWords` is also
 *     configured (the default config has none).  Setting it nonzero
 *     here would be a silent no-op for the default CLI run, and
 *     for callers that *do* configure the pool it would override
 *     their intent.  Left to the targeted block that wires both
 *     ends.
 *   - `groups.singleAltGroupProb` wraps individual parts in
 *     `(...)`.  Even at 0.05, with ~4 parts × 4 alts × ~4 rules
 *     per grammar, the inliner runs on most grammars - making the
 *     "did inlining change behavior" question harder to attribute
 *     when an unrelated pass regresses.
 *   - `shapes.singleAltRuleProb` forces whole rules to one alt.
 *     At even 0.05 a meaningful fraction of generated grammars
 *     get a forced single-alt rule, materially shifting the
 *     reference-count distribution that `inlineSingleAlternatives`
 *     keys on - again better isolated.
 *   - `shapes.ruleRefReuseProb` increases shared-array refcounts,
 *     which *suppresses* inlining.  Mixing this into the broad
 *     pass would silently lower inliner activity in baseline runs
 *     for reasons unrelated to the pass under test.
 *
 * Literals are weighted 2x to keep them dominant since they are the
 * cheap, always-valid baseline.
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
        sharedPrefix: 0,
        nestedRuleRef: 0,
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
        alignWithinRuleProb: 0.1,
    },
    groups: {
        optionalProb: 0.2,
        repeatProb: 0.2,
        singleAltGroupProb: 0,
    },
    vocabulary: {
        nonBoundaryProb: 0,
        escapeProb: 0.05,
        separatorInLiteralProb: 0.05,
    },
    shapes: {
        singleAltRuleProb: 0,
        ruleRefReuseProb: 0,
        tailFriendlyAltProb: 0,
    },
    comments: {
        lineProb: 0.05,
        blockProb: 0.05,
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
        sharedPrefix: 0,
        nestedRuleRef: 0,
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
        alignWithinRuleProb: 0,
    },
    groups: {
        optionalProb: 0,
        repeatProb: 0,
        singleAltGroupProb: 0,
    },
    vocabulary: {
        nonBoundaryProb: 0,
        escapeProb: 0,
        separatorInLiteralProb: 0,
    },
    shapes: {
        singleAltRuleProb: 0,
        ruleRefReuseProb: 0,
        tailFriendlyAltProb: 0,
    },
    comments: {
        lineProb: 0,
        blockProb: 0,
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
    {
        path: "partKinds.sharedPrefix",
        get: (f) => f.partKinds.sharedPrefix,
        set: (f, v) => {
            f.partKinds.sharedPrefix = v;
        },
    },
    {
        path: "vocabulary.nonBoundaryProb",
        get: (f) => f.vocabulary.nonBoundaryProb,
        set: (f, v) => {
            f.vocabulary.nonBoundaryProb = v;
        },
    },
    {
        path: "spacing.alignWithinRuleProb",
        get: (f) => f.spacing.alignWithinRuleProb,
        set: (f, v) => {
            f.spacing.alignWithinRuleProb = v;
        },
    },
    {
        path: "groups.singleAltGroupProb",
        get: (f) => f.groups.singleAltGroupProb,
        set: (f, v) => {
            f.groups.singleAltGroupProb = v;
        },
    },
    {
        path: "shapes.singleAltRuleProb",
        get: (f) => f.shapes.singleAltRuleProb,
        set: (f, v) => {
            f.shapes.singleAltRuleProb = v;
        },
    },
    {
        path: "shapes.ruleRefReuseProb",
        get: (f) => f.shapes.ruleRefReuseProb,
        set: (f, v) => {
            f.shapes.ruleRefReuseProb = v;
        },
    },
    {
        path: "shapes.tailFriendlyAltProb",
        get: (f) => f.shapes.tailFriendlyAltProb,
        set: (f, v) => {
            f.shapes.tailFriendlyAltProb = v;
        },
    },
    {
        path: "partKinds.nestedRuleRef",
        get: (f) => f.partKinds.nestedRuleRef,
        set: (f, v) => {
            f.partKinds.nestedRuleRef = v;
        },
    },
    {
        path: "vocabulary.escapeProb",
        get: (f) => f.vocabulary.escapeProb,
        set: (f, v) => {
            f.vocabulary.escapeProb = v;
        },
    },
    {
        path: "vocabulary.separatorInLiteralProb",
        get: (f) => f.vocabulary.separatorInLiteralProb,
        set: (f, v) => {
            f.vocabulary.separatorInLiteralProb = v;
        },
    },
    {
        path: "comments.lineProb",
        get: (f) => f.comments.lineProb,
        set: (f, v) => {
            f.comments.lineProb = v;
        },
    },
    {
        path: "comments.blockProb",
        get: (f) => f.comments.blockProb,
        set: (f, v) => {
            f.comments.blockProb = v;
        },
    },
];

// ── Generation config ─────────────────────────────────────────────────────────

export type GeneratorConfig = {
    maxRules: number;
    maxAlts: number;
    maxParts: number;
    words: readonly string[];
    /**
     * Optional secondary literal pool whose tokens are biased toward
     * non-word-boundary leading characters (e.g. punctuation, digits)
     * so the dispatch optimizer's eligibility check (which requires
     * word-boundary-script characters in the `auto` partition) is
     * exercised on disqualifying inputs.  Drawn from when
     * `vocabulary.nonBoundaryProb > 0`.
     */
    nonBoundaryWords?: readonly string[];
    /**
     * Pool of literals to draw from when emitting a `partKinds.sharedPrefix`
     * token.  Kept small so multiple alternatives in a rule are
     * likely to roll the same word, producing a shared leading
     * literal across alternates that the prefix-factoring pass can
     * collapse.  Defaults to the first two words of `words`.
     */
    sharedPrefixWords?: readonly string[];
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
    /**
     * True iff *every* alternative attaches an explicit value
     * expression.  The compiler's `nestedRuleRef` check requires
     * every alternate of a captured rule to produce a value, so
     * the generator only treats this rule as a value-producing
     * `nestedRuleRef` target when the predicate holds for all alts
     * (not just any alt).
     */
    hasValue: boolean;
};

// ── Escape encoding ──────────────────────────────────────────────────────────

/**
 * Characters that have a non-identity meaning inside an `\\<char>`
 * escape (`\\n` is newline, `\\x` starts a hex escape, etc.).  When
 * escape-encoding a character that happens to be one of these, we
 * must use a hex/unicode escape instead of the identity form so the
 * resulting literal still matches the original character.
 */
const ESCAPE_RESERVED = new Set(["0", "n", "r", "v", "t", "b", "f", "u", "x"]);

/**
 * Rewrite a single character as one of the four escape sequence forms
 * accepted by the parser.  All four decode back to `c`, so the
 * matched literal is unchanged - only the source-text representation
 * changes.  Identity escape (`\\<c>`) is skipped for characters that
 * have a special escape meaning so we don't accidentally turn `n`
 * into a newline.
 */
function encodeEscapedChar(rng: () => number, c: string): string {
    const cp = c.codePointAt(0)!;
    const reserved = ESCAPE_RESERVED.has(c);
    // Pick a form by weighted roll.  Identity escape disabled when
    // the char is reserved; the others are always safe for ASCII.
    const formCount = reserved ? 3 : 4;
    const form = intInRange(rng, 0, formCount - 1);
    switch (reserved ? form + 1 : form) {
        case 0:
            return `\\${c}`;
        case 1:
            return `\\x${cp.toString(16).padStart(2, "0").toUpperCase()}`;
        case 2:
            return `\\u${cp.toString(16).padStart(4, "0").toUpperCase()}`;
        case 3:
        default:
            return `\\u{${cp.toString(16).toUpperCase()}}`;
    }
}

/**
 * Maybe rewrite each character of `word` as an escape sequence, with
 * `prob` probability per character.  Returns the original string when
 * `prob <= 0`.
 */
function maybeEscapeWord(
    rng: () => number,
    word: string,
    prob: number,
): string {
    if (prob <= 0) return word;
    let out = "";
    for (const c of word) {
        if (rng() < prob) {
            out += encodeEscapedChar(rng, c);
        } else {
            out += c;
        }
    }
    return out;
}

// ── Part builders ─────────────────────────────────────────────────────────────

/**
 * Separator characters that can be embedded inside a literal token
 * to stress the matcher's flex-space disambiguation.  Each entry is
 * a `[sourceText, matchedText]` pair: `sourceText` is what gets
 * spliced into the `.agr` literal (with backslash escape where
 * required), `matchedText` is what the input must contain.
 *
 * Two distinct bug-risk surfaces are covered:
 *   - Punctuation (`,`, `.`, `:`, `!`, `?`, `=`, `@`, `#`, `%`, `&`,
 *     `'`, `"`, `+`): characters that are normally consumed by the
 *     flex-space regex but here must be matched as part of the
 *     literal.
 *   - Escaped space (`\ `): forces the matcher to recognize a
 *     space character as part of the token, not a separator.
 *
 * Grammar-special chars (`|`, `(`, `)`, `<`, `>`, `$`, `-`, `;`,
 * `{`, `}`, `[`, `]`, `\`) and comment starters (`/`) are
 * excluded - they require backslash escapes that the parser handles
 * via the broader `escapeProb` knob, not via embedded-separator
 * semantics.
 */
const SEPARATOR_LITERAL_CHARS: ReadonlyArray<readonly [string, string]> = [
    [",", ","],
    [".", "."],
    [":", ":"],
    ["!", "!"],
    ["?", "?"],
    ["=", "="],
    ["@", "@"],
    ["#", "#"],
    ["%", "%"],
    ["&", "&"],
    ["'", "'"],
    ['"', '"'],
    ["+", "+"],
    // Escaped space: source `\ ` decodes to a single space char that
    // is treated as part of the literal (not a flex-space).
    ["\\ ", " "],
];

/**
 * Maybe splice a separator character into the middle of a base word.
 * Returns `{ source, matched }` where `source` is the literal text
 * to emit in the `.agr` file (may contain a backslash escape) and
 * `matched` is the corresponding input substring.  Returns the
 * original word unchanged when `prob <= 0` or the dice don't fire.
 */
function maybeEmbedSeparator(
    rng: () => number,
    word: string,
    prob: number,
): { source: string; matched: string } {
    if (prob <= 0 || rng() >= prob) {
        return { source: word, matched: word };
    }
    const [sourceChar, matchedChar] = pick(rng, SEPARATOR_LITERAL_CHARS);
    // Splice into the middle of the word so neither end is a
    // separator (boundary cases are interesting but trickier to
    // make match deterministically; skip for now).
    const splitAt = Math.max(
        1,
        Math.min(word.length - 1, intInRange(rng, 1, word.length - 1)),
    );
    const left = word.slice(0, splitAt);
    const right = word.slice(splitAt);
    return {
        source: left + sourceChar + right,
        matched: left + matchedChar + right,
    };
}

function buildLiteralPart(
    rng: () => number,
    words: readonly string[],
    escapeProb: number,
    separatorInLiteralProb: number,
): { text: string; matchTokens: string[] } {
    const w = pick(rng, words);
    // Embed-separator first so escape encoding can later operate on
    // any non-special characters of the resulting source string.
    const embedded = maybeEmbedSeparator(rng, w, separatorInLiteralProb);
    // Only escape-encode when no separator was embedded - the embed
    // path already produces a literal whose source != matched, and
    // re-running escape encoding on a backslash-escape (e.g. `\ `)
    // would corrupt it.
    const text =
        embedded.source === embedded.matched
            ? maybeEscapeWord(rng, embedded.source, escapeProb)
            : embedded.source;
    return { text, matchTokens: [embedded.matched] };
}

/**
 * Pick a literal pool for a slot, honoring
 * `vocabulary.nonBoundaryProb` when a non-boundary pool is configured.
 */
function pickLiteralPool(
    rng: () => number,
    config: GeneratorConfig,
    features: FuzzFeatureFlags,
): readonly string[] {
    const nb = config.nonBoundaryWords;
    if (
        nb &&
        nb.length > 0 &&
        rng() < clamp01(features.vocabulary.nonBoundaryProb)
    ) {
        return nb;
    }
    return config.words;
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
 * Build-result for a generated value expression.  `usesExpressions`
 * is true when the expression includes any operator or syntax that
 * requires `enableValueExpressions=true` (i.e. anything beyond
 * literals, variable references, plain object/array literals, and
 * spread inside an object).
 */
type ValueExprResult = {
    text: string;
    usesExpressions: boolean;
};

const SAFE_STR_LITERALS: readonly string[] = ["a", "b", "x", "y", "yes", "no"];

/** Random small integer literal text. */
function intLit(rng: () => number): string {
    return String(intInRange(rng, 0, 9));
}

/** Random short string literal text (already quoted). */
function strLit(rng: () => number): string {
    return JSON.stringify(pick(rng, SAFE_STR_LITERALS));
}

const BASIC_BINOPS = ["+", "-", "*", "/", "%"] as const;
const COMPARE_BINOPS = ["===", "!==", "<", ">", "<=", ">="] as const;
const LOGICAL_BINOPS = ["&&", "||", "??"] as const;
const UNARY_OPS = ["-", "!", "typeof"] as const;

/**
 * Build a "primary" sub-expression: a leaf or simple value with no
 * binary/ternary structure.  Stays evaluable: variable references,
 * literals, inline object/array literals.  Used as operand for
 * arithmetic / comparison / template substitution so we don't depend
 * on the runtime type of any bound variable.
 */
function buildPrimary(
    rng: () => number,
    boundVars: readonly string[],
): ValueExprResult {
    const choices: number = boundVars.length > 0 ? 5 : 4;
    switch (intInRange(rng, 0, choices - 1)) {
        case 0:
            return { text: intLit(rng), usesExpressions: false };
        case 1:
            return { text: strLit(rng), usesExpressions: false };
        case 2:
            return {
                text: pick(rng, ["true", "false"]),
                usesExpressions: false,
            };
        case 3:
            return { text: "null", usesExpressions: false };
        case 4:
        default:
            // Variable reference - guaranteed available by branch above.
            return { text: pick(rng, boundVars), usesExpressions: false };
    }
}

/**
 * Build a numeric-only primary so arithmetic operators are safe at
 * runtime regardless of how a variable is bound.
 */
function numericPrimary(rng: () => number): string {
    return intLit(rng);
}

/**
 * Build a value expression with breadth across the full operator
 * table.  Returns the source text plus a flag indicating whether the
 * expression uses any feature that requires
 * `enableValueExpressions=true` (so the harness can select the right
 * load options).
 *
 * All produced expressions are runtime-safe:
 *   - arithmetic operates on numeric literals
 *   - member / optional access reads from inline object / array
 *     literals built in the same expression
 *   - no method calls on bound variables (their runtime type is
 *     opaque)
 */
function buildValueExpr(
    rng: () => number,
    boundVars: readonly string[],
): ValueExprResult {
    if (boundVars.length === 0) {
        // No variables to reference: emit a literal.  Still randomize
        // across literal kinds to widen basic-mode coverage.
        return buildPrimary(rng, boundVars);
    }

    const kind = intInRange(rng, 0, 14);
    switch (kind) {
        case 0: {
            // Simple variable reference.
            return {
                text: pick(rng, boundVars),
                usesExpressions: false,
            };
        }
        case 1: {
            // Object literal with shorthand and a fixed key.
            const props = boundVars.map((v) => `${v}`).join(", ");
            return {
                text: `{ actionName: "act", parameters: { ${props} } }`,
                usesExpressions: false,
            };
        }
        case 2: {
            // Array literal of bound vars.
            const elems = boundVars.slice(0, 3).join(", ");
            return { text: `[${elems}]`, usesExpressions: false };
        }
        case 3: {
            // Object with spread.  Spread of a variable into an
            // object literal is allowed in basic mode.
            const v = pick(rng, boundVars);
            return {
                text: `{ k: 1, ...${v} }`,
                usesExpressions: false,
            };
        }
        case 4: {
            // Numeric arithmetic chain: `1 + 2 * 3 - 4`.
            const a = numericPrimary(rng);
            const b = numericPrimary(rng);
            const c = numericPrimary(rng);
            const op1 = pick(rng, BASIC_BINOPS);
            const op2 = pick(rng, BASIC_BINOPS);
            // Avoid `/ 0` and `% 0`.
            const safeC = (op2 === "/" || op2 === "%") && c === "0" ? "1" : c;
            return {
                text: `${a} ${op1} ${b} ${op2} ${safeC}`,
                usesExpressions: true,
            };
        }
        case 5: {
            // Parenthesized precedence stress.
            const a = numericPrimary(rng);
            const b = numericPrimary(rng);
            const c = numericPrimary(rng);
            return {
                text: `(${a} + ${b}) * ${c}`,
                usesExpressions: true,
            };
        }
        case 6: {
            // Equality / comparison.
            const v = pick(rng, boundVars);
            const op = pick(rng, COMPARE_BINOPS);
            const rhs = strLit(rng);
            return { text: `${v} ${op} ${rhs}`, usesExpressions: true };
        }
        case 7: {
            // Logical short-circuit chain.
            const v = pick(rng, boundVars);
            const op = pick(rng, LOGICAL_BINOPS);
            return {
                text: `${v} ${op} ${strLit(rng)}`,
                usesExpressions: true,
            };
        }
        case 8: {
            // Unary operator.
            const op = pick(rng, UNARY_OPS);
            const v = pick(rng, boundVars);
            return { text: `${op} ${v}`, usesExpressions: true };
        }
        case 9: {
            // Ternary with comparison test.
            const v = pick(rng, boundVars);
            return {
                text: `${v} === "a" ? "yes" : "no"`,
                usesExpressions: true,
            };
        }
        case 10: {
            // Member access on inline object literal.
            const v = pick(rng, boundVars);
            return {
                text: `({ k: ${v} }).k`,
                usesExpressions: true,
            };
        }
        case 11: {
            // Computed member access on inline array literal.
            const v = pick(rng, boundVars);
            return {
                text: `[${v}, "z"][0]`,
                usesExpressions: true,
            };
        }
        case 12: {
            // Optional chaining on inline object - chain target is a
            // literal so no runtime undefined surprises.
            const v = pick(rng, boundVars);
            return {
                text: `({ k: ${v} })?.k`,
                usesExpressions: true,
            };
        }
        case 13: {
            // Template literal with multiple substitutions.
            const v1 = pick(rng, boundVars);
            const v2 = pick(rng, boundVars);
            return {
                text: `\`x=\${${v1}} y=\${${v2}}\``,
                usesExpressions: true,
            };
        }
        case 14:
        default: {
            // Array spread.
            const v = pick(rng, boundVars);
            return {
                text: `[1, ...[${v}], 2]`,
                usesExpressions: true,
            };
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
    const singleAltGroupProb = clamp01(features.groups.singleAltGroupProb);
    const valueAttachProb = clamp01(features.values.attachProb);
    const altSpacingProb = clamp01(features.spacing.altProb);
    const ruleSpacingProb = clamp01(features.spacing.ruleProb);
    const alignWithinRuleProb = clamp01(features.spacing.alignWithinRuleProb);
    const singleAltRuleProb = clamp01(features.shapes.singleAltRuleProb);
    const ruleRefReuseProb = clamp01(features.shapes.ruleRefReuseProb);
    const tailFriendlyAltProb = clamp01(features.shapes.tailFriendlyAltProb);
    const escapeProb = clamp01(features.vocabulary.escapeProb);
    const separatorInLiteralProb = clamp01(
        features.vocabulary.separatorInLiteralProb,
    );
    const lineCommentProb = clamp01(features.comments.lineProb);
    const blockCommentProb = clamp01(features.comments.blockProb);

    // Maybe build a comment string to inject at a flex-space slot.
    // Returns the empty string when no comment fired (so callers can
    // append unconditionally).  Multiple comments per slot are not
    // emitted: at most one of (line, block) per call.  Block comments
    // are preferred when both fire so a stray line comment doesn't
    // force a newline through unrelated parts.
    const maybeComment = (): string => {
        const block = blockCommentProb > 0 && rng() < blockCommentProb;
        if (block) {
            return ` /* c${intInRange(rng, 0, 99)} */ `;
        }
        const line = lineCommentProb > 0 && rng() < lineCommentProb;
        if (line) {
            return ` // c${intInRange(rng, 0, 99)}\n`;
        }
        return "";
    };

    // Per-rule shared-prefix word pool.  Kept small (default: first
    // two words) so multiple alternatives are likely to roll the
    // same word, producing a literal common to all alts that the
    // prefix-factoring pass can collapse.
    const sharedPrefixPool: readonly string[] =
        config.sharedPrefixWords && config.sharedPrefixWords.length > 0
            ? config.sharedPrefixWords
            : words.slice(0, Math.min(2, words.length));

    // Build rules in reverse so rule i can reference rules > i.
    const ruleStates: RuleState[] = new Array(ruleCount);

    for (let i = ruleCount - 1; i >= 0; i--) {
        // Roll alt count, optionally forcing 1 to feed
        // `inlineSingleAlternatives`.
        const altCount =
            rng() < singleAltRuleProb ? 1 : intInRange(rng, 1, maxAlts);
        const state: RuleState = {
            altTexts: [],
            firstAltMatch: [],
            boundVars: [],
            hasValue: false,
        };

        // Per-rule decisions made up-front so all alternates see them.
        //
        //   - `tailFriendlyAlt`: shape this rule to feed `tailFactoring`
        //     by forcing a shared leading literal across alts AND
        //     suppressing all value attachments (parent rule must have
        //     no value of its own for tail factoring to fire).
        //   - `forceSharedPrefixLiteral`: a single literal that every
        //     alternate of this rule will emit as its first token
        //     (selected from the shared-prefix pool).
        //   - `ruleAlignedSpacingMode`: if `alignWithinRuleProb`
        //     fires, every alternate gets stamped with this mode
        //     instead of rolling the per-alt annotation.
        const tailFriendlyAlt =
            altCount >= 2 &&
            sharedPrefixPool.length > 0 &&
            rng() < tailFriendlyAltProb;
        const forceSharedPrefixLiteral: string | undefined = tailFriendlyAlt
            ? pick(rng, sharedPrefixPool)
            : undefined;
        const ruleAlignedSpacingMode: SpacingMode | undefined =
            rng() < alignWithinRuleProb
                ? pickSpacingMode(rng, features.spacing.modes)
                : undefined;

        // Track rule references emitted in this rule so the
        // `ruleRefReuse` knob can replay an earlier target.
        const usedRuleRefs: number[] = [];

        // Count alternatives that successfully attach an explicit
        // value expression.  A rule "produces a value" (and is thus
        // safe to capture via `nestedRuleRef`) only when every
        // alternative has its own value, so we mark `state.hasValue`
        // at the end based on this count rather than on the first
        // attached alt.
        let altsWithValue = 0;

        for (let a = 0; a < altCount; a++) {
            const partCount = intInRange(rng, 1, maxParts);
            const partTexts: string[] = [];
            const partMatch: string[] = [];
            const altBoundVars: string[] = [];

            for (let p = 0; p < partCount; p++) {
                // First-position override: when this rule is shaped
                // for tail factoring or sharedPrefix is rolled into
                // position 0, emit a literal from the shared pool so
                // every alt of this rule shares a leading token.
                let partKind: PartKind;
                if (p === 0 && forceSharedPrefixLiteral !== undefined) {
                    partKind = "sharedPrefix";
                } else {
                    partKind = choosePartKind(
                        rng,
                        features,
                        i,
                        ruleCount,
                        p === 0,
                    );
                }

                let innerText: string;
                let innerMatch: string[];
                let captureVar: string | undefined;
                switch (partKind) {
                    case "literal": {
                        const pool = pickLiteralPool(rng, config, features);
                        const lit = buildLiteralPart(
                            rng,
                            pool,
                            escapeProb,
                            separatorInLiteralProb,
                        );
                        innerText = lit.text;
                        innerMatch = lit.matchTokens;
                        break;
                    }
                    case "sharedPrefix": {
                        const w =
                            forceSharedPrefixLiteral ??
                            pick(rng, sharedPrefixPool);
                        // Shared-prefix literals must be byte-identical
                        // across alternates for the prefix-factoring
                        // pass to fire, so escape encoding (which would
                        // randomize per-alternate) is intentionally not
                        // applied here.
                        innerText = w;
                        innerMatch = [w];
                        break;
                    }
                    case "ruleRef": {
                        // Reuse-an-earlier-target roll: when there is
                        // any previous reference in this rule and the
                        // probability fires, replay one of them.  Otherwise
                        // pick a fresh forward target.
                        let target: number;
                        if (
                            usedRuleRefs.length > 0 &&
                            rng() < ruleRefReuseProb
                        ) {
                            target = pick(rng, usedRuleRefs);
                        } else {
                            target = intInRange(rng, i + 1, ruleCount - 1);
                            usedRuleRefs.push(target);
                        }
                        innerText = `<${ruleName(target)}>`;
                        innerMatch = ruleStates[target].firstAltMatch;
                        break;
                    }
                    case "nestedRuleRef": {
                        // Like ruleRef, but binds the inner rule's
                        // value (or implicit-default text) to a
                        // capture variable.  Exercises the
                        // `RulesPart.variable` capture path.
                        //
                        // The target rule MUST produce a value (the
                        // compiler enforces this for nested rule
                        // captures), so we filter against the already-
                        // built `ruleStates` and degrade to a plain
                        // (no-capture) ruleRef when no eligible target
                        // exists.
                        const eligible: number[] = [];
                        for (let t = i + 1; t < ruleCount; t++) {
                            if (ruleStates[t].hasValue) eligible.push(t);
                        }
                        if (eligible.length === 0) {
                            // No value-producing target: emit a plain
                            // ruleRef instead.  Pick any forward target
                            // exactly as the `ruleRef` branch does.
                            const target = intInRange(
                                rng,
                                i + 1,
                                ruleCount - 1,
                            );
                            usedRuleRefs.push(target);
                            innerText = `<${ruleName(target)}>`;
                            innerMatch = ruleStates[target].firstAltMatch;
                            break;
                        }
                        const target = pick(rng, eligible);
                        usedRuleRefs.push(target);
                        const name = `r${varCounter.n++}`;
                        innerText = `$(${name}:<${ruleName(target)}>)`;
                        innerMatch = ruleStates[target].firstAltMatch;
                        captureVar = name;
                        break;
                    }
                    case "wildcard": {
                        const pool = pickLiteralPool(rng, config, features);
                        const wc = buildWildcardPart(rng, varCounter, pool);
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

                // Bare `(part)` group with no quantifier: only
                // applied when no other quantifier ran.  Forces a
                // single-alt RulesPart wrapper around the part,
                // exercising the inliner.  Skipped on captures so
                // visibility semantics remain unchanged (matches the
                // canWrap convention above).
                if (
                    canWrap &&
                    !optional &&
                    !repeat &&
                    rng() < singleAltGroupProb
                ) {
                    partText = `(${innerText})`;
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
            // probability (only eligible when captures exist).  When
            // shaping for tail factoring, the parent rule MUST have no
            // value of its own - suppress all value attachments for
            // this rule.
            let valueText = "";
            if (
                !tailFriendlyAlt &&
                altBoundVars.length > 0 &&
                rng() < valueAttachProb
            ) {
                const expr = buildValueExpr(rng, altBoundVars);
                valueText = ` -> ${expr.text}`;
                altsWithValue++;
                if (expr.usesExpressions) {
                    usesValueExpressions = true;
                }
            }

            // Per-alternate spacing annotation.  When the rule has a
            // pre-picked aligned mode, stamp it on every alternate
            // unconditionally.  Otherwise roll the per-alt
            // probability.  If every mode weight is 0 the picker
            // returns undefined and we skip the annotation rather
            // than fall back to uniform.
            let spacingText = "";
            if (ruleAlignedSpacingMode !== undefined) {
                spacingText = spacingAnnotation(ruleAlignedSpacingMode);
            } else if (rng() < altSpacingProb) {
                const mode = pickSpacingMode(rng, features.spacing.modes);
                if (mode !== undefined) {
                    spacingText = spacingAnnotation(mode);
                }
            }

            // Join parts with single-space flex-space separators.
            // When comments are enabled, sprinkle them between parts
            // (each gap is independently rolled).  Comments are pure
            // parser-only fluff: matching input is unchanged.
            let altBody: string;
            if (lineCommentProb > 0 || blockCommentProb > 0) {
                altBody = "";
                for (let pi = 0; pi < partTexts.length; pi++) {
                    if (pi > 0) altBody += " " + maybeComment();
                    altBody += partTexts[pi];
                }
            } else {
                altBody = partTexts.join(" ");
            }

            state.altTexts.push(`${spacingText}${altBody}${valueText}`);
            if (a === 0) {
                state.firstAltMatch = partMatch;
                state.boundVars = altBoundVars;
            }
        }

        // Only mark the rule as value-producing when every alternative
        // attached an explicit value expression.  Otherwise a
        // `nestedRuleRef` capture targeting this rule would hit the
        // compiler's "referenced rule does not produce a value" check
        // for the value-less alternates.
        state.hasValue = altCount > 0 && altsWithValue === altCount;

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
        // Join alternates with `|`; sprinkle comments in the gaps when
        // enabled.
        let altsJoined: string;
        if (
            state.altTexts.length > 1 &&
            (lineCommentProb > 0 || blockCommentProb > 0)
        ) {
            altsJoined = state.altTexts[0];
            for (let ai = 1; ai < state.altTexts.length; ai++) {
                altsJoined += maybeComment() + " | " + state.altTexts[ai];
            }
        } else {
            altsJoined = state.altTexts.join(" | ");
        }
        // Optional leading comment line attached to the rule itself.
        const leadingComment = maybeComment();
        const rulePrefix = leadingComment ? leadingComment : "";
        lines.push(
            `${rulePrefix}<${ruleName(i)}>${ruleSpacing} = ${altsJoined};`,
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

type PartKind =
    | "literal"
    | "ruleRef"
    | "wildcard"
    | "number"
    | "sharedPrefix"
    | "nestedRuleRef";

function choosePartKind(
    rng: () => number,
    features: FuzzFeatureFlags,
    ruleIndex: number,
    ruleCount: number,
    isFirstSlot: boolean,
): PartKind {
    // ruleRef / nestedRuleRef require a forward rule to point at;
    // otherwise force their weight to 0.  `sharedPrefix` is only
    // useful at the first slot of an alternative (later positions
    // wouldn't share with a sibling's first part) - zero its weight
    // elsewhere.
    const ruleRefAvailable = ruleIndex + 1 < ruleCount;
    const kinds = features.partKinds;
    const entries: ReadonlyArray<readonly [PartKind, number]> = [
        ["literal", kinds.literal],
        ["ruleRef", ruleRefAvailable ? kinds.ruleRef : 0],
        ["wildcard", kinds.wildcard],
        ["number", kinds.number],
        ["sharedPrefix", isFirstSlot ? kinds.sharedPrefix : 0],
        ["nestedRuleRef", ruleRefAvailable ? kinds.nestedRuleRef : 0],
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
