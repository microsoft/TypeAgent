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
import { globalEntityRegistry } from "./entityRegistry.js";
import { globalPhraseSetRegistry } from "./builtInPhraseMatchers.js";

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
    knownTypeNames: Set<string>; // Type names imported from .ts files
    importedTypeNames: Map<string, number | undefined>; // Explicitly named .ts type imports with positions (excludes entity names and wildcards)
    usedImportedTypes: Set<string>; // Imported .ts types actually referenced in variables
    hasStarImport: boolean; // Indicates if there's a star import
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
    entityNames?: string[],
): CompileContext {
    const ruleDefMap: DefinitionMap = new Map();

    // Build separate sets of imported rule names and type names
    const importedRuleMap = new Map<string, CompileContext>();
    const knownTypeNames = new Set<string>();

    // Entity declarations (e.g., "entity CalendarDate;") are valid type names
    if (entityNames) {
        for (const name of entityNames) {
            knownTypeNames.add(name);
        }
    }
    const importedTypeNames = new Map<string, number | undefined>();
    const usedImportedTypes = new Set<string>();
    // Create the context early and add to the map BEFORE processing anything
    // This prevents infinite recursion on circular dependencies
    const context: CompileContext = {
        grammarFileMap,
        content,
        displayPath,
        ruleDefMap,
        importedRuleMap,
        knownTypeNames,
        importedTypeNames,
        usedImportedTypes,
        hasStarImport: false,
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
                    context.hasStarImport = true;
                } else {
                    for (const name of importStmt.names) {
                        importedTypeNames.set(name, importStmt.pos);
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
    entityNames?: string[],
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
        entityNames,
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

    // Warn about imported types that are declared but never used in any variable
    for (const [, compileContext] of context.grammarFileMap) {
        for (const [typeName, pos] of compileContext.importedTypeNames) {
            if (!compileContext.usedImportedTypes.has(typeName)) {
                compileContext.warnings.push({
                    message: `Imported type '${typeName}' is declared but never used.`,
                    pos,
                });
            }
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

    // Collect all imported .ts types used as variable types across all contexts
    const usedImportedTypes = new Set<string>();
    for (const [, compileContext] of context.grammarFileMap) {
        for (const t of compileContext.usedImportedTypes) {
            usedImportedTypes.add(t);
        }
    }

    const grammar: Grammar = { rules: grammarRules };
    if (usedImportedTypes.size > 0) {
        grammar.entities = Array.from(usedImportedTypes);
    }
    return grammar;
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
 * Validate that a variable reference exists in the available variables set
 */
function validateVariableReference(
    context: CompileContext,
    variableName: string,
    availableVariables: Set<string>,
): void {
    if (!availableVariables.has(variableName)) {
        context.errors.push({
            message: `Variable '${variableName}' is referenced in the value but not defined in the rule`,
            definition: context.currentDefinition,
        });
    }
}

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
            validateVariableReference(
                context,
                valueNode.name,
                availableVariables,
            );
            break;
        case "object":
            for (const key in valueNode.value) {
                const val = valueNode.value[key];
                if (val === null) {
                    // Shorthand form: { key } means { key: key }
                    // Validate that 'key' is an available variable
                    validateVariableReference(context, key, availableVariables);
                } else {
                    validateVariableReferences(
                        context,
                        val,
                        availableVariables,
                    );
                }
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
    let defaultValue = false;
    for (const expr of expressions) {
        switch (expr.type) {
            case "string": {
                const part: StringPart = {
                    type: "string",
                    value: expr.value,
                };
                // TODO: create regexp
                parts.push(part);
                // default value of the string
                defaultValue = true;
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
                            context.hasStarImport ||
                            context.knownTypeNames.has(refName) ||
                            context.importedTypeNames.has(refName) ||
                            globalEntityRegistry.getConverter(refName) !== undefined;

                        if (!isImportedType) {
                            context.errors.push({
                                message: `Undefined type '${refName}' in variable '${name}'`,
                                definition: context.currentDefinition,
                                pos: refPos,
                            });
                        } else {
                            // Track imported .ts types used as variable types.
                            // These need runtime entity validation (like old "entity" declarations).
                            context.usedImportedTypes.add(refName);
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
            case "ruleReference": {
                // Phrase-set matchers (Polite, Greeting, etc.) are handled at
                // match time — no rule definition needed, no NFA state expansion.
                // BUT: only use the phrase-set if the rule is NOT defined locally
                // or via import (preserves grammars that define their own <Polite> etc.)
                const isLocallyDefined =
                    context.ruleDefMap.has(expr.name) ||
                    context.importedRuleMap.has(expr.name);
                if (
                    !isLocallyDefined &&
                    globalPhraseSetRegistry.isPhraseSetName(expr.name)
                ) {
                    parts.push({
                        type: "phraseSet",
                        matcherName: expr.name,
                    });
                    // Phrase sets don't produce a captured value on their own.
                    // Use defaultValue=true so single-part rules using a phrase set
                    // don't trip the "Start rule does not produce a value" check.
                    defaultValue = true;
                    break;
                }
                const { grammarRules, hasValue } = createNamedGrammarRules(
                    context,
                    expr.name,
                    expr.pos,
                );
                // default value of the rule reference
                defaultValue = hasValue;
                parts.push({
                    type: "rules",
                    rules: grammarRules,
                    name: expr.name,
                });
                break;
            }
            case "rules": {
                const { rules, optional, repeat } = expr;
                const grammarRules: GrammarRule[] = [];
                // default value of the nested rules
                defaultValue = createGrammarRules(context, rules, grammarRules);
                const rulesPart: import("./grammarTypes.js").RulesPart = {
                    type: "rules",
                    rules: grammarRules,
                    optional,
                };
                if (repeat) rulesPart.repeat = true;
                parts.push(rulesPart);

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
            (variableCount === 0 && parts.length === 1 && defaultValue),
    };
}
