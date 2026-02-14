// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Grammar,
    GrammarPart,
    GrammarRule,
    StringPart,
} from "./grammarTypes.js";
import {
    Rule,
    RuleDefinition,
    ImportStatement,
    parseGrammarRules,
} from "./grammarRuleParser.js";

export type FileUtils = {
    resolvePath: (name: string, ref?: string) => string;
    displayPath: (fullPath: string) => string;
    readContent: (fullPath: string) => string;
};

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
    displayPath: string;
    definition?: string | undefined;
    pos?: number | undefined;
};

type CompileContext = {
    grammarFileMap: Map<string, CompileContext>;
    displayPath: string;
    ruleDefMap: DefinitionMap;
    importedRuleMap: Map<string, CompileContext>; // Rule names imported from .agr files
    importedTypeNames: Set<string>; // Type names imported from .ts files
    currentDefinition?: string | undefined;
    errors: Omit<GrammarCompileError, "displayPath">[];
    warnings: Omit<GrammarCompileError, "displayPath">[];
};

function createImportCompileContext(
    importUtils: FileUtils,
    grammarFileMap: Map<string, CompileContext>,
    referencingFileName: string,
    importStmt: ImportStatement,
): CompileContext {
    const fullPath = importUtils.resolvePath(
        importStmt.source,
        referencingFileName,
    );
    if (grammarFileMap.has(fullPath)) {
        return grammarFileMap.get(fullPath)!;
    }
    const content = importUtils.readContent(fullPath);
    const displayPath = importUtils.displayPath(fullPath);
    const result = parseGrammarRules(displayPath, content);
    const importContext = createCompileContext(
        grammarFileMap,
        displayPath,
        fullPath,
        importUtils,
        result.definitions,
        result.imports,
    );
    return importContext;
}

function createCompileContext(
    grammarFileMap: Map<string, CompileContext>,
    displayPath: string,
    fullPath: string,
    fileUtils: FileUtils | undefined,
    definitions: RuleDefinition[],
    imports?: ImportStatement[],
): CompileContext {
    const ruleDefMap: DefinitionMap = new Map();

    // Build separate sets of imported rule names and type names
    const importedRuleMap = new Map<string, CompileContext>();
    const importedTypeNames = new Set<string>();
    if (imports) {
        for (const importStmt of imports) {
            // Determine if this is a type import (.ts) or grammar import (.agr)
            const isGrammarImport = importStmt.source.endsWith(".agr");
            if (isGrammarImport) {
                if (fileUtils === undefined) {
                    throw new Error(`Grammar file imports are not supported.`);
                }
                const importContext = createImportCompileContext(
                    fileUtils,
                    grammarFileMap,
                    fullPath,
                    importStmt,
                );
                importedRuleMap.set(importStmt.source, importContext);

                const ruleNames =
                    importStmt.names === "*"
                        ? importContext.ruleDefMap.keys()
                        : importStmt.names;

                for (const ruleName of ruleNames) {
                    importedRuleMap.set(ruleName, importContext);
                }
            } else {
                if (importStmt.names === "*") {
                    // For wildcard imports, we can't know all names at compile time
                    // They will be validated at runtime instead
                    // Mark with a special sentinel to indicate wildcard import
                    importedTypeNames.add("*");
                } else {
                    for (const name of importStmt.names) {
                        importedTypeNames.add(name);
                    }
                }
            }
        }
    }

    const context: CompileContext = {
        grammarFileMap,
        displayPath,
        ruleDefMap,
        importedRuleMap,
        importedTypeNames,
        errors: [],
        warnings: [],
    };

    for (const def of definitions) {
        if (importedRuleMap.has(def.name)) {
            context.errors.push({
                message: `Rule '<${def.name}>' cannot be defined because it is imported from another grammar file.`,
                definition: def.name,
                pos: def.pos,
            });
        }
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

    grammarFileMap.set(fullPath, context);
    return context;
}

export function compileGrammar(
    relativePath: string,
    fullPath: string,
    fileUtils: FileUtils | undefined,
    definitions: RuleDefinition[],
    start: string,
    imports?: ImportStatement[],
): GrammarCompileResult {
    const grammarFileMap = new Map<string, CompileContext>();
    const context = createCompileContext(
        grammarFileMap,
        relativePath,
        fullPath,
        fileUtils,
        definitions,
        imports,
    );

    const grammar = { rules: createNamedGrammarRules(context, start) };

    for (const [name, record] of context.ruleDefMap.entries()) {
        if (record.grammarRules === undefined) {
            context.warnings.push({
                message: `Rule '<${name}>' is defined but never used.`,
                pos: record.pos,
            });
        }
    }

    const errors: GrammarCompileError[] = [];
    const warnings: GrammarCompileError[] = [];
    for (const [, compileContext] of context.grammarFileMap) {
        errors.push(
            ...compileContext.errors.map((e) => ({
                ...e,
                displayPath: compileContext.displayPath,
            })),
        );
        warnings.push(
            ...compileContext.warnings.map((w) => ({
                ...w,
                displayPath: compileContext.displayPath,
            })),
        );
    }

    return {
        grammar,
        errors,
        warnings,
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
    referencePosition?: number,
    referenceVariable?: string,
    referenceContext: CompileContext = context,
): GrammarRule[] {
    const record = context.ruleDefMap.get(name);
    if (record === undefined) {
        // Check if this rule name is imported from a grammar file
        const importedContext = context.importedRuleMap.get(name);
        if (importedContext === undefined) {
            referenceContext.errors.push({
                message: `Missing rule definition for '<${name}>'`,
                definition: referenceContext.currentDefinition,
                pos: referencePosition,
            });
            context.ruleDefMap.set(name, emptyRecord);
            return emptyRecord.grammarRules;
        }
        return createNamedGrammarRules(
            importedContext,
            name,
            referencePosition,
            referenceVariable,
            referenceContext,
        );
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

    if (referenceVariable !== undefined && !record.hasValue) {
        referenceContext.errors.push({
            message: `Referenced rule '<${name}>' does not produce a value for variable '${referenceVariable}'`,
            definition: referenceContext.currentDefinition,
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
                    // All non-built-in types must be explicitly imported
                    // Built-in types: string, wildcard, word, number
                    const isBuiltInType =
                        typeName === "string" ||
                        typeName === "wildcard" ||
                        typeName === "word";
                    if (!isBuiltInType) {
                        const isImportedType =
                            context.importedTypeNames.has(typeName) ||
                            context.importedTypeNames.has("*");

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
