// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Grammar,
    GrammarPart,
    GrammarRule,
    StringPart,
} from "./grammarTypes.js";
import { Rule, RuleDefinition } from "./grammarRuleParser.js";

type DefinitionMap = Map<
    string,
    { rules: Rule[]; pos: number | undefined; grammarRules?: GrammarRule[] }
>;

type GrammarCompileResult = {
    grammar: Grammar;
    errors: GrammarCompileError[];
    warnings: GrammarCompileError[];
};

export type GrammarCompileError = {
    message: string;
    definition?: string | undefined;
    pos?: number | undefined;
};

type CompileContext = {
    ruleDefMap: DefinitionMap;
    currentDefinition?: string | undefined;
    errors: GrammarCompileError[];
    warnings: GrammarCompileError[];
};

export function compileGrammar(
    definitions: RuleDefinition[],
    start: string,
): GrammarCompileResult {
    const ruleDefMap: DefinitionMap = new Map();
    const context: CompileContext = {
        ruleDefMap,
        errors: [],
        warnings: [],
    };

    for (const def of definitions) {
        const existing = ruleDefMap.get(def.name);
        if (existing === undefined) {
            ruleDefMap.set(def.name, { rules: [...def.rules], pos: def.pos });
        } else {
            existing.rules.push(...def.rules);
        }
    }
    const grammar = { rules: createGrammarRules(context, start) };

    for (const [name, record] of ruleDefMap.entries()) {
        if (record.grammarRules === undefined) {
            context.warnings.push({
                message: `Rule '<${name}>' is defined but never used.`,
                pos: record.pos,
            });
        }
    }
    return {
        grammar,
        errors: context.errors,
        warnings: context.warnings,
    };
}

const emptyRecord = { rules: [], pos: undefined, grammarRules: [] };
function createGrammarRules(
    context: CompileContext,
    name: string,
    pos?: number,
): GrammarRule[] {
    const record = context.ruleDefMap.get(name);
    if (record === undefined) {
        context.errors.push({
            message: `Missing rule definition for '<${name}>'`,
            definition: context.currentDefinition,
            pos,
        });
        context.ruleDefMap.set(name, emptyRecord);
        return emptyRecord.grammarRules;
    }
    if (record.grammarRules === undefined) {
        record.grammarRules = [];
        const prev = context.currentDefinition;
        context.currentDefinition = name;
        for (const r of record.rules) {
            record.grammarRules.push(createGrammarRule(context, r));
        }
        context.currentDefinition = prev;
    }
    return record.grammarRules;
}

function createGrammarRule(context: CompileContext, rule: Rule): GrammarRule {
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
                const { name, typeName, ruleReference, ruleRefPos } = expr;
                if (ruleReference) {
                    parts.push({
                        type: "rules",
                        rules: createGrammarRules(
                            context,
                            typeName,
                            ruleRefPos,
                        ),
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
                    rules: createGrammarRules(context, expr.name, expr.pos),
                    name: expr.name,
                });
                break;
            case "rules": {
                const { rules, optional } = expr;
                parts.push({
                    type: "rules",
                    rules: rules.map((r) => createGrammarRule(context, r)),
                    optional,
                });

                break;
            }
            default:
                throw new Error(
                    `Internal Error: Unknown expression type ${(expr as any).type}`,
                );
        }
    }

    return {
        parts,
        value,
    };
}
