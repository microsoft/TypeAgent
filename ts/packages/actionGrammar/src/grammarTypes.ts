// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ValueNode } from "./grammarRuleParser.js";

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
export type GrammarRulesJson = GrammarRuleJson[];
export type GrammarJson = GrammarRulesJson[];
