// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ValueNode } from "./grammarRuleParser.js";

/**
 * In memory types
 */
export type StringPart = {
    type: "string";

    value: string[];

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
};

export type GrammarPart =
    | StringPart
    | VarStringPart
    | VarNumberPart
    | RulesPart;
export type GrammarRule = {
    parts: GrammarPart[];
    value?: ValueNode | undefined;
};

export type Grammar = {
    rules: GrammarRule[];
};

/**
 * Serialized types
 */
export type StringPartJson = {
    type: "string";
    value: string[];
};

export type VarStringPartJson = {
    type: "wildcard";
    variable: string;
    typeName: string;
};

export type VarNumberPartJson = {
    type: "number";
    variable: string;
};

export type RulePartJson = {
    type: "rules";
    name?: string | undefined;
    index: number;
    variable?: string | undefined;
    optional?: boolean | undefined;
};

export type GrammarPartJson =
    | StringPartJson
    | VarStringPartJson
    | VarNumberPartJson
    | RulePartJson;

export type GrammarRuleJson = {
    parts: GrammarPartJson[];
    value?: ValueNode | undefined;
};
export type GrammarRules = GrammarRuleJson[];
export type GrammarJson = GrammarRules[];
