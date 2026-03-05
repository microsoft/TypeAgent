// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Controls how flex-space separator positions between tokens are matched at runtime.
 *   "required" – at least one whitespace/punctuation character must be present.
 *   "optional" – zero or more separator characters allowed; tokens may be adjacent
 *                but spaces are permitted.
 *   "none"     – no separator characters allowed between tokens; whitespace or
 *                punctuation is only permitted if it is part of the next token itself.
 *   undefined  – auto (default): a separator is required only when both adjacent
 *                characters belong to scripts that normally use word spaces (e.g.
 *                Latin, Cyrillic). Scripts such as CJK do not require one.
 *
 * Note: the grammar source keyword "auto" is stored as undefined internally.
 */
export type SpacingMode = "required" | "optional" | "none" | "auto" | undefined;
// "auto" = explicit [spacing=auto] annotation (same runtime behavior as undefined).
// undefined = no annotation at all (inherit default).

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
    spacingMode?: SpacingMode; // undefined = auto (default)
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
    spacingMode?: SpacingMode; // undefined = auto (default)
};
export type GrammarRulesJson = GrammarRuleJson[];
export type GrammarJson = GrammarRulesJson[];
