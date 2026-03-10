// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * SpacingMode after compilation — "auto" is folded to undefined so it never
 * appears in compiled grammar output (.ag.json) or at match time.
 */
export type CompiledSpacingMode = "required" | "optional" | "none" | undefined;

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
// Note: CompiledObjectValueNode uses an unordered dict for values because
// property order is irrelevant at match time.  The parser-time ObjectValueNode
// (in grammarRuleParser.ts) uses an ordered ObjectProperty[] array instead so
// it can preserve per-property comments and original source order for
// round-trip fidelity.
export type CompiledObjectValueNode = {
    type: "object";
    value: { [key: string]: CompiledValueNode | null };
};
export type CompiledArrayValueNode = {
    type: "array";
    value: CompiledValueNode[];
};

/** ValueNode without comment annotations — used in compiled grammar output (.ag.json). */
export type CompiledValueNode =
    | CompiledLiteralValueNode
    | CompiledVariableValueNode
    | CompiledObjectValueNode
    | CompiledArrayValueNode;

/**
 * Grammar Types - in memory
 */
export type StringPart = {
    type: "string";
    value: string[];
    optional?: undefined; // TODO: support optional string parts
    variable?: undefined;

    /* TODO: cache the regexp?
    regexp?: RegExp;
    regexpWithPendingWildcards?: RegExp;
    */
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
    variable?: undefined;
    optional?: undefined;
};

export type GrammarPart =
    | StringPart
    | VarStringPart
    | VarNumberPart
    | RulesPart
    | PhraseSetPart;
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
