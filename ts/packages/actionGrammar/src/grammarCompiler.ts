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
import { getLineCol } from "./utils.js";

export type FileLoader = {
    resolvePath: (name: string, ref?: string) => string;
    displayPath: (fullPath: string) => string;
    readContent: (fullPath: string) => string;
};

type DefinitionRecord = {
    rules: Rule[];
    pos: number | undefined;
    grammarRules?: GrammarRule[];
    hasValue: boolean;
};

type CompletedDefinitionRecord = DefinitionRecord & {
    grammarRules: GrammarRule[];
};
type DefinitionMap = Map<string, DefinitionRecord>;

type GrammarCompileError = {
    message: string;
    definition?: string | undefined;
    pos?: number | undefined;
};

type CompileContext = {
    grammarFileMap: Map<string, CompileContext>;
    content: string;
    displayPath: string;
    ruleDefMap: DefinitionMap;
    importedRuleMap: Map<string, CompileContext>; // Rule names imported from .agr files
    importedTypeNames: Set<string>; // Type names imported from .ts files
    currentDefinition?: string | undefined;
    errors: GrammarCompileError[];
    warnings: GrammarCompileError[];
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
        content,
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
    content: string,
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
        content,
        displayPath,
        ruleDefMap,
        importedRuleMap,
        importedTypeNames,
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
    displayPath: string,
    content: string,
    fullPath: string,
    fileUtils: FileLoader | undefined,
    definitions: RuleDefinition[],
    start: string,
    startValueRequired: boolean,
    errors: string[],
    warnings?: string[],
    imports?: ImportStatement[],
): Grammar {
    const grammarFileMap = new Map<string, CompileContext>();
    const context = createCompileContext(
        grammarFileMap,
        content,
        displayPath,
        fullPath,
        fileUtils,
        definitions,
        imports,
    );

    const { grammarRules, hasValue } = createNamedGrammarRules(context, start);

    if (startValueRequired && !hasValue) {
        context.errors.push({
            message: `Start rule '<${start}>' does not produce a value.`,
            definition: start,
        });
    }

    for (const [name, record] of context.ruleDefMap.entries()) {
        if (record.grammarRules === undefined) {
            context.warnings.push({
                message: `Rule '<${name}>' is defined but never used.`,
                pos: record.pos,
            });
        }
    }

    for (const [, compileContext] of context.grammarFileMap) {
        errors.push(
            ...convertCompileError(
                compileContext,
                "error",
                compileContext.errors,
            ),
        );
        warnings?.push(
            ...convertCompileError(
                compileContext,
                "warning",
                compileContext.warnings,
            ),
        );
    }
    return { rules: grammarRules };
}

function convertCompileError(
    compileContext: CompileContext,
    type: "error" | "warning",
    errors: GrammarCompileError[],
) {
    const { content, displayPath } = compileContext;
    return errors.map((e) => {
        const lineCol = getLineCol(content, e.pos ?? 0);
        return `${displayPath}(${lineCol.line},${lineCol.col}): ${type}: ${e.message}${e.definition ? ` in definition '<${e.definition}>'` : ""}`;
    });
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
): CompletedDefinitionRecord {
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
            return emptyRecord;
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
    return record as CompletedDefinitionRecord;
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
    let nestedValue = false;
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
                const { name, refName, ruleReference, refPos, pos } = expr;
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
                    const { grammarRules } = createNamedGrammarRules(
                        context,
                        refName,
                        refPos,
                        name,
                    );
                    parts.push({
                        type: "rules",
                        rules: grammarRules,
                        variable: name,
                        name: refName,
                        optional: expr.optional,
                    });
                } else if (refName === "number") {
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
                        refName === "string" ||
                        refName === "wildcard" ||
                        refName === "word";
                    if (!isBuiltInType) {
                        const isImportedType =
                            context.importedTypeNames.has(refName) ||
                            context.importedTypeNames.has("*");

                        if (!isImportedType) {
                            context.errors.push({
                                message: `Undefined type '${refName}' in variable '${name}'`,
                                definition: context.currentDefinition,
                                pos: refPos,
                            });
                        }
                    }

                    parts.push({
                        type: "wildcard",
                        variable: name,
                        optional: expr.optional,
                        typeName: refName,
                    });
                }
                break;
            }
            case "ruleReference":
                const { grammarRules, hasValue } = createNamedGrammarRules(
                    context,
                    expr.name,
                    expr.pos,
                );
                nestedValue = hasValue;
                parts.push({
                    type: "rules",
                    rules: grammarRules,
                    name: expr.name,
                });
                break;
            case "rules": {
                const { rules, optional } = expr;
                const grammarRules: GrammarRule[] = [];
                nestedValue = createGrammarRules(context, rules, grammarRules);
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
    } else if (variableCount > 1) {
        // warn about unused variables if there are more than 1 (since 1 variable rules can be used for simple extraction without value)
        context.warnings.push({
            message: `Rule with multiple variables and no explicit value expression doesn't have an implicit value. Add an explicit value expression or remove unused variables.`,
            definition: context.currentDefinition,
        });
    }

    return {
        grammarRule: {
            parts,
            value,
        },
        hasValue:
            value !== undefined ||
            variableCount === 1 ||
            (variableCount === 0 && parts.length === 1 && nestedValue),
    };
}
