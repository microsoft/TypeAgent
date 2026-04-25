// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * SpacingMode after compilation — "auto" is folded to undefined so it never
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

/** ValueNode without comment annotations — used in compiled grammar output (.ag.json). */
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
     * named by this variable — same string the implicit-default path
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

export type RulesPart = {
    type: "rules";

    rules: GrammarRule[];
    name?: string | undefined; // For debugging

    variable?: string | undefined;
    optional?: boolean | undefined;
    repeat?: boolean | undefined; // Kleene star: zero or more occurrences
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
 * - string / phraseSet: optimizer-introduced captures only — no `.agr` source syntax.
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
    rules: GrammarRule[];
    entities?: string[] | undefined; // Entity types this grammar depends on (e.g. ["Ordinal", "CalendarDate"])
    checkedVariables?: Set<string> | undefined; // Variable names with validation (checked_wildcard paramSpec)
};

/**
 * Grammar Types - in serialized
 */
export type StringPartJson = {
    type: "string";
    value: string[];
    /** Optional capture variable — see `StringPart.variable`. */
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
    index: number;
    variable?: string | undefined;
    optional?: boolean | undefined;
    repeat?: boolean | undefined;
};

export type PhraseSetPartJson = {
    type: "phraseSet";
    matcherName: string;
    /** Optional capture variable — see `PhraseSetPart.variable`. */
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
export type GrammarJson = GrammarRulesJson[];
