// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Rule, RuleDefinition, ValueNode } from "./grammarParser.js";

type StringPart = {
    type: "string";

    value: string[];

    /* TODO: cache the regexp?
    regexp?: RegExp;
    regexpWithPendingWildcards?: RegExp;
    */
};

type VarStringPart = {
    type: "wildcard";
    variable: string;
    optional?: boolean | undefined;

    typeName: string; // Do we need this?
};

type VarNumberPart = {
    type: "number";
    variable: string;
    optional?: boolean | undefined;
};

type RulesPart = {
    type: "rules";

    rules: GrammarRule[];
    name?: string; // Do we need this?

    variable?: string;
    optional?: boolean | undefined;
};

type GrammarPart = StringPart | VarStringPart | VarNumberPart | RulesPart;
export type GrammarRule = {
    parts: GrammarPart[];
    value?: ValueNode | undefined;
};

export type Grammar = {
    rules: GrammarRule[];
};

type DefinitionMap = Map<
    string,
    { rules: Rule[]; grammarRules?: GrammarRule[] }
>;

export function compileGrammar(definitions: RuleDefinition[]): Grammar {
    const ruleDefMap: DefinitionMap = new Map();
    for (const def of definitions) {
        const existing = ruleDefMap.get(def.name);
        if (existing === undefined) {
            ruleDefMap.set(def.name, { rules: [...def.rules] });
        } else {
            existing.rules.push(...def.rules);
        }
    }
    return { rules: createGrammarRules(ruleDefMap, "Start") };
}

function createGrammarRules(
    ruleDefMap: DefinitionMap,
    name: string,
): GrammarRule[] {
    const record = ruleDefMap.get(name);
    if (record === undefined) {
        throw new Error(`Missing rule definition for '<${name}>'`);
    }
    if (record.grammarRules === undefined) {
        record.grammarRules = [];
        for (const r of record.rules) {
            record.grammarRules.push(createGrammarRule(ruleDefMap, r));
        }
    }
    return record.grammarRules;
}

function createGrammarRule(ruleDefMap: DefinitionMap, rule: Rule): GrammarRule {
    const { expressions, value } = rule;
    const parts: GrammarPart[] = [];
    for (const expr of expressions) {
        switch (expr.type) {
            case "string": {
                const part: StringPart = {
                    type: "string",
                    value: expr.value,
                };
                // TODO: create regexp
                parts.push(part);
                break;
            }
            case "variable": {
                const { name, typeName, ruleReference } = expr;
                if (ruleReference) {
                    const rules = ruleDefMap.get(typeName);
                    if (rules === undefined) {
                        throw new Error(`No rule named ${typeName}`);
                    }
                    parts.push({
                        type: "rules",
                        rules: createGrammarRules(ruleDefMap, typeName),
                        variable: name,
                        name: typeName,
                        optional: expr.optional,
                    });
                } else if (typeName === "number") {
                    parts.push({
                        type: "number",
                        variable: name,
                        optional: expr.optional,
                    });
                } else {
                    parts.push({
                        type: "wildcard",
                        variable: name,
                        optional: expr.optional,
                        typeName,
                    });
                }
                break;
            }
            case "ruleReference":
                parts.push({
                    type: "rules",
                    rules: createGrammarRules(ruleDefMap, expr.name),
                    name: expr.name,
                });
                break;
            case "rules": {
                const { rules, optional } = expr;
                parts.push({
                    type: "rules",
                    rules: rules.map((r) => createGrammarRule(ruleDefMap, r)),
                    optional,
                });

                break;
            }
            default:
                throw new Error(
                    `Unknown expression type ${(expr as any).type}`,
                );
        }
    }

    return {
        parts,
        value,
    };
}
