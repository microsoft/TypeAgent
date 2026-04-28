// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * SpacingMode after compilation - "auto" is folded to undefined so it never
 * appears in compiled grammar output (.ag.json) or at match time.
 */
export type CompiledSpacingMode = "required" | "optional" | "none" | undefined;

// ── Operator unions (value expressions) ───────────────────────────────────────

export type BinaryValueExprOp =
    // Arithmetic
    | "+"
    | "-"
    | "*"
    | "/"
    | "%"
    // Comparison
    | "==="
    | "!=="
    | "<"
    | ">"
    | "<="
    | ">="
    // Logical
    | "&&"
    | "||"
    // Nullish coalescing
    | "??";

export type UnaryValueExprOp = "-" | "!" | "typeof";

// ── Operator precedence table (value expressions) ────────────────────────────
// Higher number = tighter binding.  Shared between the writer (for
// parenthesization) and validated by round-trip tests against the parser.

export const BINARY_PRECEDENCE: Record<BinaryValueExprOp, number> = {
    "??": 1,
    "||": 2,
    "&&": 3,
    "===": 4,
    "!==": 4,
    "<": 5,
    ">": 5,
    "<=": 5,
    ">=": 5,
    "+": 6,
    "-": 6,
    "*": 7,
    "/": 7,
    "%": 7,
};

// ── Compiled value node types ─────────────────────────────────────────────────
// ValueNode variants *without* comment annotations.  GrammarRule and
// GrammarRuleJson use these so parser comment fields are never serialized into
// .ag.json files.  grammarRuleParser.ts imports the base types below and
// augments them with leadingComments / trailingComments for parse-time use.

export type CompiledLiteralValueNode = {
    type: "literal";
    value: boolean | string | number;
};
export type CompiledVariableValueNode = {
    type: "variable";
    name: string;
};
// A named property in a compiled object: { key: value }.
// null value = shorthand: { x } means { x: x }.
export type CompiledObjectPropertyElement = {
    type: "property";
    key: string;
    value: CompiledValueNode | null;
};
// A spread element in a compiled object: { ...expr }.
export type CompiledObjectSpreadElement = {
    type: "spread";
    argument: CompiledValueNode;
};
export type CompiledObjectElement =
    | CompiledObjectPropertyElement
    | CompiledObjectSpreadElement;

// CompiledObjectValueNode uses an ordered array of elements because spread
// elements interleave with named properties and override semantics depend on
// source order.  The parser-time ObjectValueNode (in grammarRuleParser.ts)
// augments the elements with comment fields for round-trip fidelity.
export type CompiledObjectValueNode = {
    type: "object";
    value: CompiledObjectElement[];
};
export type CompiledArrayValueNode = {
    type: "array";
    value: CompiledValueNode[];
};

// ── Compiled value expression nodes ───────────────────────────────────────────
// These are the serializable (comment-free) node types used at match time
// and in .ag.json output.  The parser-time variants (in grammarValueExprParser.ts)
// augment them with leadingComments / trailingComments.

export type CompiledBinaryValueExprNode = {
    type: "binaryExpression";
    operator: BinaryValueExprOp;
    left: CompiledValueNode;
    right: CompiledValueNode;
};

export type CompiledUnaryValueExprNode = {
    type: "unaryExpression";
    operator: UnaryValueExprOp;
    operand: CompiledValueNode;
};

export type CompiledConditionalValueExprNode = {
    type: "conditionalExpression";
    test: CompiledValueNode;
    consequent: CompiledValueNode;
    alternate: CompiledValueNode;
};

export type CompiledMemberValueExprNode = {
    type: "memberExpression";
    object: CompiledValueNode;
    /** For computed access (`obj[expr]`), property is a node; for dot access, it's a string. */
    property: string | CompiledValueNode;
    computed: boolean;
    optional: boolean; // `?.` optional chaining
};

export type CompiledCallValueExprNode = {
    type: "callExpression";
    callee: CompiledValueNode;
    arguments: CompiledValueNode[];
    optional?: boolean; // `?.()` optional call
};

export type CompiledSpreadValueExprNode = {
    type: "spreadElement";
    argument: CompiledValueNode;
};

export type CompiledTemplateLiteralValueExprNode = {
    type: "templateLiteral";
    /** Static string parts (quasis). Length is expressions.length + 1. */
    quasis: string[];
    expressions: CompiledValueNode[];
};

export type CompiledValueExprNode =
    | CompiledBinaryValueExprNode
    | CompiledUnaryValueExprNode
    | CompiledConditionalValueExprNode
    | CompiledMemberValueExprNode
    | CompiledCallValueExprNode
    | CompiledSpreadValueExprNode
    | CompiledTemplateLiteralValueExprNode;

/** ValueNode without comment annotations - used in compiled grammar output (.ag.json). */
export type CompiledValueNode =
    | CompiledLiteralValueNode
    | CompiledVariableValueNode
    | CompiledObjectValueNode
    | CompiledArrayValueNode
    | CompiledValueExprNode;

/**
 * Grammar Types - in memory
 */
export type StringPartRegExpEntry = {
    /** RegExp with global flag ("iug") for wildcard scanning */
    global: RegExp;
    /** RegExp with sticky flag ("iuy") for anchored matching */
    sticky: RegExp;
};

export type StringPart = {
    type: "string";
    value: string[];
    optional?: undefined; // TODO: support optional string parts
    /**
     * Optional capture variable.  When set, the matcher writes the
     * joined matched tokens (`value.join(" ")`) into the slot/value
     * named by this variable - same string the implicit-default path
     * computes for a single-StringPart rule with no value expression,
     * just routed to a named slot instead of the anonymous default.
     *
     * Currently introduced only by the optimizer's inliner pass; not
     * exposed in `.agr` source syntax.
     */
    variable?: string | undefined;

    /**
     * Cache of compiled RegExp objects.  There are exactly 4
     * {@link CompiledSpacingMode} values \u00d7 2 leading-spacing
     * variants = 8 possible (spacingMode, leadingIsNone) keys for
     * a given StringPart, so the cache is a fixed 8-slot sparse
     * tuple indexed directly by `(modeIndex << 1) | leadingIsNone`
     * (see `getStringPartRegExp`).  Allocating an 8-slot array
     * lazily avoids the per-call template-string + Map.get
     * allocation that the previous string-keyed Map incurred on
     * every match attempt.
     */
    regexpCache?: Array<StringPartRegExpEntry | undefined>;
};

export type VarStringPart = {
    type: "wildcard";
    variable: string;
    optional?: boolean | undefined;

    typeName: string; // Not needed at runtime?
};

export type VarNumberPart = {
    type: "number";
    variable: string;
    optional?: boolean | undefined;
};

/**
 * One per-spacing-mode bucket table within a dispatched `RulesPart`.
 * See `RulesPart.dispatch` for the full contract; in brief: the
 * matcher peeks once with `spacingMode` as `tokenMode` and looks the
 * peeked token up in `tokenMap` to find candidate rules.
 */
export type DispatchModeBucket = {
    spacingMode: CompiledSpacingMode;
    tokenMap: Map<string, GrammarRule[]>;
};

/**
 * Alternation part.  Holds `rules.length` alternatives that are tried
 * in order.  When the optional `dispatch` field is set, the matcher
 * peeks one token at entry and tries the matching bucket members
 * (per `dispatch[*].tokenMap`) before falling back to `rules`; when
 * `dispatch` is absent, the matcher iterates `rules` linearly.
 *
 * **Dual role of `rules`.**  In a non-dispatched part, `rules` holds
 * the full alternation.  In a dispatched part, `rules` holds only
 * the *fallback subset* - members that could not be assigned to any
 * dispatch bucket (wildcard / number / phraseSet / nested-rule first
 * parts, members in `optional`/`none` spacing modes, etc.) plus any
 * member whose first token is unknown.  Bucket members live solely
 * inside `dispatch[*].tokenMap.values()`; each `GrammarRule` object
 * is referenced from exactly one slot.
 */
export type RulesPart = {
    type: "rules";

    alternatives: GrammarRule[];
    /**
     * Optimizer-only first-token dispatch table.  When set, the
     * matcher peeks one input token at entry and looks it up across
     * each per-mode `tokenMap` to filter candidate alternatives.
     * The peeked token is *not* consumed: each suffix rule retains
     * its full original `parts` (including its leading `StringPart`),
     * and the matcher re-matches that token via the suffix rule's
     * normal `StringPart` regex.  Dispatch's only role is to cull
     * members whose first token cannot match the peeked input -
     * turning what would otherwise be a linear scan over N
     * alternatives into an O(1) hash lookup that yields a small
     * bucket.
     *
     * Per-mode bucketing.  A dispatch may carry buckets for more
     * than one spacing mode at once: the optimizer partitions the
     * original alternation's members by each rule's own
     * `spacingMode` and builds a separate `tokenMap` per
     * dispatch-eligible mode (`required` and/or `undefined`/auto).
     * At match time the matcher peeks once per `dispatch` entry
     * (passing that entry's `spacingMode` as `tokenMode` to
     * `peekNextToken`) and unions any hits.
     *
     * Eligibility (computed by `dispatchifyAlternations`):
     *   - A member with `spacingMode === "required"` always
     *     dispatches into the `required` bucket.
     *   - A member with `spacingMode === undefined` (auto)
     *     dispatches into the auto bucket; its bucket key is the
     *     leading word-boundary-script prefix of its first literal
     *     token (or the leading code point when that prefix is
     *     empty).  The matcher applies the same prefix logic on
     *     the input side.
     *   - Members with `spacingMode === "optional"` or `"none"` are
     *     never dispatch-eligible (peek-by-separator would mismatch
     *     keys against unseparated input).  They land in `rules`
     *     (the fallback subset) and are tried after the bucket
     *     hits at match time.
     *
     * Invariants enforced by `tryDispatchifyRulesPart`:
     *   - `dispatch.length >= 1`
     *   - every entry's `tokenMap` is non-empty
     *   - every entry's `spacingMode` is `"required"` or `undefined`
     *   - entries have distinct `spacingMode` values
     *   - entries appear in member-source order of first appearance
     *
     * Canonical shapes: total bucket count >= 2, OR total bucket
     * count == 1 with non-empty `rules` (fallback subset).  Other
     * shapes are semantically valid - the matcher handles them
     * correctly - but offer no filtering benefit over the
     * non-dispatched form.  `grammarDeserializer.ts` logs a `debug`
     * advisory when it sees one.
     *
     * Not exposed in `.agr` source.  The NFA/DFA compile path walks
     * `dispatch` plus `rules` to recover the full effective member
     * list (the NFA already does global first-token dispatch via
     * `buildFirstTokenIndex`, so `dispatch` is redundant there).
     */
    dispatch?: DispatchModeBucket[] | undefined;
    name?: string | undefined; // For debugging

    variable?: string | undefined;
    optional?: boolean | undefined;
    repeat?: boolean | undefined; // Kleene star: zero or more occurrences

    /**
     * Optimizer-only flag marking this `RulesPart` as a true *tail call*.
     * When set, the matcher does not push a parent frame on entry - the
     * selected member's value flows up directly as the containing
     * (parent) rule's value, and the child's bindings cons onto the
     * parent's `valueIds` chain (so member value-exprs see prefix
     * bindings).
     *
     * Required structural constraints, validated by
     * `validateGrammar`:
     *   - This part is the LAST entry in its containing rule's `parts`.
     *   - The containing rule has `value === undefined`.
     *   - `repeat`, `optional`, and `variable` are all forbidden here.
     *   - Effective member count >= 2 (sum of bucket sizes plus
     *     `rules.length`).  A single-rule tail `RulesPart` is
     *     pointless: the lone member's value would just flow up to
     *     the parent, which is equivalent to inlining the member's
     *     parts directly into the parent (since tail already shares
     *     scope with the parent).  The factorer only emits tail
     *     wrappers at multi-member forks.
     *   - Each member rule individually produces a value (explicit
     *     `value` or implicit-default-eligible).
     *   - `spacingMode` of every member equals the containing rule's
     *     spacingMode (boundary semantics must match - see the
     *     equivalent check in the inliner).
     *
     * Not exposed in `.agr` source syntax; introduced only by the
     * factorer's prefix-factoring pass.  Named `tailCall` (not just
     * `tail`) so it doesn't read as "this part is at the end of the
     * parts list" - the flag means "matcher should treat this as a
     * tail call".
     */
    tailCall?: boolean | undefined;
};

export type PhraseSetPart = {
    type: "phraseSet";
    /** Name of the phrase-set matcher (e.g. "Polite", "Greeting") */
    matcherName: string;
    /**
     * Optional capture variable.  When set, the matcher writes the
     * actual matched phrase (its tokens joined with a single space)
     * into the slot/value named by this variable.
     *
     * Currently introduced only by the optimizer's inliner pass; not
     * exposed in `.agr` source syntax.
     */
    variable?: string | undefined;
    optional?: undefined;
};

export type GrammarPart =
    | StringPart
    | VarStringPart
    | VarNumberPart
    | RulesPart
    | PhraseSetPart;

/**
 * GrammarPart kinds that can carry an optional capture `variable`.
 * Centralized so adding a future capture-bearing part type only needs
 * one edit here plus the predicate / accessor below.
 *
 * - wildcard / number: source-level captures (`$(name:string)`, `$(n:number)`).
 * - rules:             nested rule capture (`$(x:<Inner>)`).
 * - string / phraseSet: optimizer-introduced captures only - no `.agr` source syntax.
 */
export type CaptureBearingPart =
    | VarStringPart
    | VarNumberPart
    | RulesPart
    | StringPart
    | PhraseSetPart;

/** Type guard: does this part kind support a capture `variable`? */
export function isCaptureBearingPart(
    part: GrammarPart,
): part is CaptureBearingPart {
    switch (part.type) {
        case "wildcard":
        case "number":
        case "rules":
        case "string":
        case "phraseSet":
            return true;
        default:
            return false;
    }
}

/**
 * Return the capture-variable name for any GrammarPart kind that
 * supports one.  Returns `undefined` when the part either doesn't
 * support captures or carries no binding.
 */
export function getCapturedVariableName(part: GrammarPart): string | undefined {
    return isCaptureBearingPart(part) ? part.variable : undefined;
}
export type GrammarRule = {
    parts: GrammarPart[];
    value?: CompiledValueNode | undefined;
    spacingMode?: CompiledSpacingMode | undefined; // undefined = auto (default)
};

export type Grammar = {
    alternatives: GrammarRule[];
    /**
     * Optimizer-only first-token dispatch index over the top-level
     * alternation.  Mirrors `RulesPart.dispatch` but lives at the
     * grammar level so the optimizer doesn't need to synthesize a
     * wrapper rule (which would impose a single uniform
     * `spacingMode` on the wrapper that is wrong for top-level
     * alternations mixing modes; see `dispatchifyAlternations`).
     *
     * When set, `rules` is the *fallback subset* (members not
     * assigned to any bucket); when unset, `rules` is the full
     * top-level alternation.
     */
    dispatch?: DispatchModeBucket[] | undefined;
    entities?: string[] | undefined; // Entity types this grammar depends on (e.g. ["Ordinal", "CalendarDate"])
    checkedVariables?: Set<string> | undefined; // Variable names with validation (checked_wildcard paramSpec)
};

/**
 * Grammar Types - in serialized
 */
export type StringPartJson = {
    type: "string";
    value: string[];
    /** Optional capture variable - see `StringPart.variable`. */
    variable?: string | undefined;
};

export type VarStringPartJson = {
    type: "wildcard";
    variable: string;
    typeName: string;
    optional?: boolean | undefined;
};

export type VarNumberPartJson = {
    type: "number";
    variable: string;
    optional?: boolean | undefined;
};

export type RulePartJson = {
    type: "rules";
    name?: string | undefined;
    /**
     * Index into the shared `GrammarRulesJson` table.  In a
     * non-dispatched part this is the full alternation; in a
     * dispatched part it is the *fallback subset* (members not
     * assigned to any bucket).  Suffix arrays dedup with named-rule
     * arrays via the existing identity-sharing mechanism.
     *
     * Omitted entirely when the alternatives array is empty (the
     * common case for a dispatched part with no fallback): the
     * deserializer substitutes a frozen shared empty array.  This
     * avoids both an `[]` pool slot *and* a per-site `"index": N`
     * field for that case.
     */
    index?: number;
    /**
     * Optimizer-only first-token dispatch index.  See `RulesPart.dispatch`.
     * Stored as an index into the shared `GrammarJson.dispatches`
     * pool so two `RulesPart`s that shared a `DispatchModeBucket[]`
     * identity in the in-memory AST (e.g. multiple references to a
     * named rule whose body was dispatched) point at a single
     * serialized entry, and the deserializer can restore that
     * identity sharing.  Each `tokenMap` entry's index is a
     * `GrammarRulesJson` index in the same shared `GrammarJson`
     * table that the outer `index` references.
     */
    dispatch?: number;
    variable?: string | undefined;
    optional?: boolean | undefined;
    repeat?: boolean | undefined;
    /** See `RulesPart.tailCall`. */
    tailCall?: boolean | undefined;
};

export type PhraseSetPartJson = {
    type: "phraseSet";
    matcherName: string;
    /** Optional capture variable - see `PhraseSetPart.variable`. */
    variable?: string | undefined;
};

export type GrammarPartJson =
    | StringPartJson
    | VarStringPartJson
    | VarNumberPartJson
    | RulePartJson
    | PhraseSetPartJson;

export type GrammarRuleJson = {
    parts: GrammarPartJson[];
    value?: CompiledValueNode | undefined;
    spacingMode?: CompiledSpacingMode | undefined; // undefined = auto (default)
};
export type GrammarRulesJson = GrammarRuleJson[];

/**
 * Serialized form of a single in-memory `DispatchModeBucket[]`
 * (the value carried by `RulesPart.dispatch` / `Grammar.dispatch`).
 * Each entry's `tokenMap` is `[lowercased-token, rulesArrayIndex][]`
 * - Maps don't survive JSON round-trip directly, and the indices
 * point into the shared `GrammarJson.rules` table.
 */
export type DispatchJson = Array<{
    spacingMode?: CompiledSpacingMode | undefined;
    /** [lowercased-token, rulesArrayIndex][] */
    tokenMap: Array<[string, number]>;
}>;

/**
 * Serialized grammar shape.  Slot 0 of `rules` is the top-level
 * alternation (or, when `dispatch` is set, the fallback subset).
 * `dispatches` is a shared pool of dispatch tables; both
 * `RulePartJson.dispatch` and the top-level `dispatch` field below
 * are indices into this pool, so a `DispatchModeBucket[]` shared
 * across multiple in-memory `RulesPart`s (or hoisted from a named
 * rule that's referenced from multiple sites) serializes once.
 * Absent when no dispatch tables exist anywhere in the grammar.
 */
export type GrammarJson = {
    rules: GrammarRulesJson[];
    dispatches?: DispatchJson[];
    /** Index into `dispatches` for the top-level dispatch table. */
    dispatch?: number;
};
