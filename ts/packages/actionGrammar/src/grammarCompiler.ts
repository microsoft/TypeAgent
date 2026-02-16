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
    ValueNode,
} from "./grammarRuleParser.js";

export type FileLoader = {
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
    // Type names imported from .ts files that are actually used as variable types.
    // These should be treated as entity declarations for runtime validation.
    usedImportedTypes: string[];
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
    usedImportedTypes: Set<string>; // Imported .ts types actually referenced in variables
    currentDefinition?: string | undefined;
    errors: Omit<GrammarCompileError, "displayPath">[];
    warnings: Omit<GrammarCompileError, "displayPath">[];
};

function createImportCompileContext(
    fileLoader: FileLoader,
    grammarFileMap: Map<string, CompileContext>,
    referencingFileName: string,
    importStmt: ImportStatement,
): CompileContext {
    const fullPath = fileLoader.resolvePath(
        importStmt.source,
        referencingFileName,
    );
    if (grammarFileMap.has(fullPath)) {
        return grammarFileMap.get(fullPath)!;
    }
    const content = fileLoader.readContent(fullPath);
    const displayPath = fileLoader.displayPath(fullPath);
    const result = parseGrammarRules(displayPath, content);
    const importContext = createCompileContext(
        grammarFileMap,
        displayPath,
        fullPath,
        fileLoader,
        result.definitions,
        result.imports,
    );
    return importContext;
}

function createCompileContext(
    grammarFileMap: Map<string, CompileContext>,
    displayPath: string,
    fullPath: string,
    fileUtils: FileLoader | undefined,
    definitions: RuleDefinition[],
    imports?: ImportStatement[],
): CompileContext {
    const ruleDefMap: DefinitionMap = new Map();

    // Build separate sets of imported rule names and type names
    const importedRuleMap = new Map<string, CompileContext>();
    const importedTypeNames = new Set<string>();

    // Create the context early and add to the map BEFORE processing anything
    // This prevents infinite recursion on circular dependencies
    const context: CompileContext = {
        grammarFileMap,
        displayPath,
        ruleDefMap,
        importedRuleMap,
        importedTypeNames,
        usedImportedTypes: new Set<string>(),
        errors: [],
        warnings: [],
    };

    // Process definitions FIRST - this populates ruleDefMap
    // This allows circular imports to work since our definitions are available
    // when other files try to import from us
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

    // Add to map before processing so circular imports can be detected
    grammarFileMap.set(fullPath, context);

    // Process imports AFTER definitions - this populates importedRuleMap
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

                const ruleNames =
                    importStmt.names === "*"
                        ? importContext.ruleDefMap.keys()
                        : importStmt.names;

                for (const ruleName of ruleNames) {
                    // Check if we're trying to import a rule that's already defined locally
                    if (ruleDefMap.has(ruleName)) {
                        context.errors.push({
                            message: `Rule '<${ruleName}>' cannot be imported because it is already defined in this file.`,
                            definition: ruleName,
                            pos: importStmt.pos,
                        });
                    } else {
                        importedRuleMap.set(ruleName, importContext);
                    }
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

    return context;
}

export function compileGrammar(
    relativePath: string,
    fullPath: string,
    fileUtils: FileLoader | undefined,
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

    // Collect all imported .ts types used as variable types across all contexts
    const usedImportedTypes = new Set<string>();
    for (const [, compileContext] of context.grammarFileMap) {
        for (const t of compileContext.usedImportedTypes) {
            usedImportedTypes.add(t);
        }
    }

    return {
        grammar,
        errors,
        warnings,
        usedImportedTypes: Array.from(usedImportedTypes),
    };
}

const emptyRecord = {
    rules: [],
    pos: undefined,
    grammarRules: [],
    hasValue: true, // Pretend to have value to avoid cascading errors
};

/**
 * Validate variable references in a ValueNode while traversing the structure
 */
function validateVariableReferences(
    context: CompileContext,
    valueNode: ValueNode,
    availableVariables: Set<string>,
): void {
    switch (valueNode.type) {
        case "variable":
            if (!availableVariables.has(valueNode.name)) {
                context.errors.push({
                    message: `Variable '${valueNode.name}' is referenced in the value but not defined in the rule`,
                    definition: context.currentDefinition,
                });
            }
            break;
        case "object":
            for (const key in valueNode.value) {
                validateVariableReferences(
                    context,
                    valueNode.value[key],
                    availableVariables,
                );
            }
            break;
        case "array":
            for (const item of valueNode.value) {
                validateVariableReferences(context, item, availableVariables);
            }
            break;
        case "literal":
            // No variables in literals
            break;
    }
}
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
    const availableVariables = new Set<string>();
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
                const { name, typeName, ruleReference, ruleRefPos, pos } = expr;
                // Check for duplicate variable definition
                if (availableVariables.has(name)) {
                    context.errors.push({
                        message: `Variable '${name}' is already defined in this rule`,
                        definition: context.currentDefinition,
                        pos,
                    });
                }
                availableVariables.add(name);
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
                        } else {
                            // Track imported .ts types used as variable types.
                            // These need runtime entity validation (like old "entity" declarations).
                            context.usedImportedTypes.add(typeName);
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

    // Validate that all variables referenced in the value are defined
    if (value !== undefined) {
        validateVariableReferences(context, value, availableVariables);
    }

    // Determine if this rule produces a value:
    // 1. It has an explicit value expression (value !== undefined)
    // 2. It has exactly one variable (implicit variable value)
    // 3. It has exactly one non-empty string literal (NFA normalization will add -> "literal")
    // 4. It has exactly one rule reference without variable (passthrough - NFA normalization will add capture)
    const isSingleLiteral =
        parts.length === 1 &&
        parts[0].type === "string" &&
        parts[0].value.length > 0;

    const isPassthrough =
        parts.length === 1 && parts[0].type === "rules" && !parts[0].variable;

    return {
        grammarRule: {
            parts,
            value,
        },
        hasValue:
            value !== undefined ||
            variableCount === 1 ||
            isSingleLiteral ||
            isPassthrough,
    };
}
