// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Grammar,
    GrammarPart,
    GrammarRule,
    RulesPart,
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
    compiling: boolean; // true while grammarRules is being populated
    nullable?: boolean; // set after compilation; true if any alternative matches ε
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
                compiling: false,
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
    compiling: false,
    nullable: false,
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
// ε-reachable cycle detection
//
// A grammar rule causes an infinite loop at match time when a named rule can
// recurse back to itself without ever consuming a mandatory input token — i.e.
// when the cycle is reachable via ε-transitions (optional parts, rule expansions
// that themselves match ε).
//
// Detection: `epsilonReachable` carries the set of rule names entered since the
// last mandatory input was consumed. When a back-reference is found
// (record.compiling === true) and the rule name is still in that set, the full
// path back to the entry point was traversed without consuming any input, so an
// error is reported.
//
// Nullability note — two asymmetric checks appear at each rule-reference site:
//   record.nullable === false  →  clear currentEpr (only when *definitely*
//                                 non-nullable; undefined/back-ref leaves it
//                                 intact to avoid masking a cycle further along)
//   record.nullable ?? false   →  propagate ruleNullable (treat back-refs
//                                 conservatively as non-nullable)

function createNamedGrammarRules(
    context: CompileContext,
    name: string,
    referencePosition?: number,
    referenceVariable?: string,
    epsilonReachable: Set<string> = new Set(),
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
            epsilonReachable,
            referenceContext,
        );
    }
    if (record.compiling) {
        if (epsilonReachable.has(name)) {
            // Back-reference reachable without consuming any input: infinite loop at match time
            referenceContext.errors.push({
                message: `Rule '<${name}>' creates an epsilon-reachable cycle that would cause an infinite loop at match time`,
                definition: referenceContext.currentDefinition,
                pos: referencePosition,
            });
        }
        // else: non-epsilon back-reference (mandatory input consumed before the
        // back-ref); just return the incomplete record — the grammar is valid.
    } else if (record.grammarRules === undefined) {
        const eprWithSelf = new Set(epsilonReachable).add(name);
        const prev = context.currentDefinition;
        context.currentDefinition = name;
        // Assign an empty sentinel array before setting compiling=true so that
        // any non-epsilon re-entrant call (record.compiling=true, name not in
        // epsilonReachable) returns [] rather than undefined for grammarRules.
        record.grammarRules = [];
        record.compiling = true;
        // Pass the sentinel as the output array so createGrammarRules pushes
        // directly into it. Any RulesPart.rules captured during a circular
        // back-reference holds a reference to this same array object and will
        // see the populated rules without a separate copy step.
        const { hasValue, nullable } = createGrammarRules(
            context,
            record.rules,
            eprWithSelf,
            record.grammarRules,
        );
        record.hasValue = hasValue;
        record.compiling = false;
        record.nullable = nullable;
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
    epsilonReachable: Set<string>,
    out: GrammarRule[] = [],
): { grammarRules: GrammarRule[]; hasValue: boolean; nullable: boolean } {
    const grammarRules = out;
    let hasValue = true;
    let nullable = false; // nullable if ANY alternative is nullable
    for (const r of rules) {
        const result = createGrammarRule(context, r, epsilonReachable);
        grammarRules.push(result.grammarRule);
        hasValue = hasValue && result.hasValue;
        nullable = nullable || result.nullable;
    }
    return { grammarRules, hasValue, nullable };
}

function createGrammarRule(
    context: CompileContext,
    rule: Rule,
    epsilonReachable: Set<string>,
): { grammarRule: GrammarRule; hasValue: boolean; nullable: boolean } {
    const { expressions, value } = rule;
    const parts: GrammarPart[] = [];
    const availableVariables = new Set<string>();
    let variableCount = 0;
    let defaultValue = false;
    // A rule alternative is nullable if ALL of its parts can match ε.
    let ruleNullable = true;
    let currentEpr = epsilonReachable;
    // Call after any part that guarantees consuming ≥1 input token.
    const consumedInput = () => {
        currentEpr = new Set<string>();
        ruleNullable = false;
    };
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
                consumedInput(); // string literals always consume mandatory input
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
                    const record = createNamedGrammarRules(
                        context,
                        refName,
                        refPos,
                        name,
                        currentEpr,
                    );
                    parts.push({
                        type: "rules",
                        rules: record.grammarRules,
                        variable: name,
                        name: refName,
                        optional: expr.optional,
                    });
                    if (!expr.optional) {
                        // === false: only clear when *definitely* non-nullable.
                        // undefined (back-ref still compiling) leaves epr intact
                        // to avoid masking an ε-cycle further along this path.
                        if (record.nullable === false) currentEpr = new Set();
                        // ?? false: treat undefined (back-ref) as non-nullable —
                        // conservative for nullability propagation, consistent with
                        // how cycles are broken (they require mandatory input).
                        ruleNullable =
                            ruleNullable && (record.nullable ?? false);
                    }
                } else if (refName === "number") {
                    parts.push({
                        type: "number",
                        variable: name,
                        optional: expr.optional,
                    });
                    if (!expr.optional) consumedInput();
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
                            globalEntityRegistry.getConverter(refName) !==
                                undefined;

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
                    if (!expr.optional) consumedInput();
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
                    consumedInput(); // phrase sets always consume input
                    break;
                }
                const record = createNamedGrammarRules(
                    context,
                    expr.name,
                    expr.pos,
                    undefined,
                    currentEpr,
                );
                // default value of the rule reference
                defaultValue = record.hasValue;
                parts.push({
                    type: "rules",
                    rules: record.grammarRules,
                    name: expr.name,
                });
                // RuleRefExpr has no optional modifier; it is always non-optional.
                // === false: only clear when *definitely* non-nullable (same
                // asymmetry as the variable ruleRef case above).
                if (record.nullable === false) {
                    currentEpr = new Set();
                }
                // ?? false: treat undefined (back-ref) as non-nullable.
                ruleNullable = ruleNullable && (record.nullable ?? false);
                break;
            }
            case "rules": {
                const { rules, optional, repeat } = expr;
                // default value of the nested rules
                const {
                    grammarRules,
                    hasValue: groupHasValue,
                    nullable: groupNullable,
                } = createGrammarRules(context, rules, currentEpr);
                defaultValue = groupHasValue;
                const rulesPart: RulesPart = {
                    type: "rules",
                    rules: grammarRules,
                    optional,
                };
                if (repeat) rulesPart.repeat = true;
                parts.push(rulesPart);
                if (!optional && !groupNullable) consumedInput();
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
        nullable: ruleNullable,
    };
}
