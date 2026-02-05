// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Grammar,
    GrammarPart,
    GrammarRule,
    StringPart,
} from "./grammarTypes.js";
import { Rule, RuleDefinition, ImportStatement } from "./grammarRuleParser.js";

type DefinitionMap = Map<
    string,
    {
        rules: Rule[];
        pos: number | undefined;
        grammarRules?: GrammarRule[];
        hasValue: boolean;
    }
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
    importedRuleNames: Set<string>; // Rule names imported from .agr files
    importedTypeNames: Set<string>; // Type names imported from .ts files
    currentDefinition?: string | undefined;
    errors: GrammarCompileError[];
    warnings: GrammarCompileError[];
};

export function compileGrammar(
    definitions: RuleDefinition[],
    start: string,
    imports?: ImportStatement[],
): GrammarCompileResult {
    const ruleDefMap: DefinitionMap = new Map();

    // Build separate sets of imported rule names and type names
    const importedRuleNames = new Set<string>();
    const importedTypeNames = new Set<string>();
    if (imports) {
        for (const importStmt of imports) {
            // Determine if this is a type import (.ts) or grammar import (.agr)
            const isTypeImport = importStmt.source.endsWith(".ts");
            const targetSet = isTypeImport
                ? importedTypeNames
                : importedRuleNames;

            if (importStmt.names === "*") {
                // For wildcard imports, we can't know all names at compile time
                // They will be validated at runtime instead
                // Mark with a special sentinel to indicate wildcard import
                targetSet.add("*");
            } else {
                for (const name of importStmt.names) {
                    targetSet.add(name);
                }
            }
        }
    }

    const context: CompileContext = {
        ruleDefMap,
        importedRuleNames,
        importedTypeNames,
        errors: [],
        warnings: [],
    };

    for (const def of definitions) {
        const existing = ruleDefMap.get(def.name);
        if (existing === undefined) {
            ruleDefMap.set(def.name, {
                rules: [...def.rules],
                pos: def.pos,
                // Set this to true to allow recursion to assume that it has value.
                hasValue: true,
            });
        } else {
            existing.rules.push(...def.rules);
        }
    }
    const grammar = { rules: createNamedGrammarRules(context, start) };

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

const emptyRecord = {
    rules: [],
    pos: undefined,
    grammarRules: [],
    hasValue: true, // Pretend to have value to avoid cascading errors
};
function createNamedGrammarRules(
    context: CompileContext,
    name: string,
    pos?: number,
    refVar?: string,
): GrammarRule[] {
    const record = context.ruleDefMap.get(name);
    if (record === undefined) {
        // Check if this rule name is imported from a grammar file
        const isImported =
            context.importedRuleNames.has(name) ||
            context.importedRuleNames.has("*");

        if (!isImported) {
            context.errors.push({
                message: `Missing rule definition for '<${name}>'`,
                definition: context.currentDefinition,
                pos,
            });
        }
        context.ruleDefMap.set(name, emptyRecord);
        return emptyRecord.grammarRules;
    }
    if (record.grammarRules === undefined) {
        const prev = context.currentDefinition;
        context.currentDefinition = name;
        record.grammarRules = [];
        record.hasValue = createGrammarRules(
            context,
            record.rules,
            record.grammarRules,
        );
        context.currentDefinition = prev;
    }

    if (refVar !== undefined && !record.hasValue) {
        context.errors.push({
            message: `Referenced rule '<${name}>' does not produce a value for variable '${refVar}'`,
            definition: context.currentDefinition,
            pos: record.pos,
        });
    }
    return record.grammarRules;
}

function createGrammarRules(
    context: CompileContext,
    rules: Rule[],
    grammarRules: GrammarRule[],
) {
    let hasValue = true;
    for (const r of rules) {
        const result = createGrammarRule(context, r);
        grammarRules.push(result.grammarRule);
        hasValue = hasValue && result.hasValue;
    }
    return hasValue;
}

function createGrammarRule(
    context: CompileContext,
    rule: Rule,
): { grammarRule: GrammarRule; hasValue: boolean } {
    const { expressions, value } = rule;
    const parts: GrammarPart[] = [];
    let variableCount = 0;
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
                variableCount++;
                const { name, typeName, ruleReference, ruleRefPos } = expr;
                if (ruleReference) {
                    const rules = createNamedGrammarRules(
                        context,
                        typeName,
                        ruleRefPos,
                        name,
                    );
                    parts.push({
                        type: "rules",
                        rules,
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
                    // Validate type name references
                    // Built-in types: string, wildcard
                    // REVIEW: word built-in type?
                    const isBuiltInType =
                        typeName === "string" ||
                        typeName === "wildcard" ||
                        typeName === "word";
                    if (!isBuiltInType) {
                        const isImportedType =
                            context.importedTypeNames.has(typeName) ||
                            context.importedTypeNames.has("*");

                        // If type imports exist, validate that the type is either built-in or imported
                        if (!isImportedType) {
                            context.errors.push({
                                message: `Undefined type '${typeName}' in variable '${name}'`,
                                definition: context.currentDefinition,
                                pos: ruleRefPos,
                            });
                        }
                    }

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
                    rules: createNamedGrammarRules(
                        context,
                        expr.name,
                        expr.pos,
                    ),
                    name: expr.name,
                });
                break;
            case "rules": {
                const { rules, optional } = expr;
                const grammarRules: GrammarRule[] = [];
                createGrammarRules(context, rules, grammarRules);
                parts.push({
                    type: "rules",
                    rules: grammarRules,
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
        grammarRule: {
            parts,
            value,
        },
        hasValue: value !== undefined || variableCount === 1,
    };
}
