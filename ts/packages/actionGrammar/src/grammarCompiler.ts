// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Grammar,
    GrammarPart,
    GrammarRule,
    RulesPart,
    StringPart,
    CompiledSpacingMode,
    CompiledValueNode,
    CompiledObjectElement,
} from "./grammarTypes.js";
import {
    Rule,
    RuleDefinition,
    ImportStatement,
    parseGrammarRules,
    ValueNode,
    isObjectSpread,
} from "./grammarRuleParser.js";
import { getLineCol } from "./utils.js";
import {
    optimizeGrammar,
    GrammarOptimizationOptions,
} from "./grammarOptimizer.js";
import { globalEntityRegistry } from "./entityRegistry.js";
import { globalPhraseSetRegistry } from "./builtInPhraseMatchers.js";
import { getBuiltInEntitiesGrammarContent } from "./builtInFileLoader.js";
import type {
    SchemaTypeDefinition,
    SchemaType,
} from "@typeagent/action-schema";
import {
    validateValueType,
    validateExprTypes,
    validateVariableType,
    buildVariableTypeMap,
    classifyRuleValue,
} from "./grammarValueTypeValidator.js";

export type FileLoader = {
    resolvePath: (name: string, ref?: string) => string;
    displayPath: (fullPath: string) => string;
    readContent: (fullPath: string) => string;
};

/**
 * Resolves a type name imported from a .ts file to its parsed schema definition.
 * @param typeName - The type name to resolve (e.g., "PlayAction")
 * @param source - The resolved absolute path to the source file. The compiler
 *   resolves relative import paths (e.g., "./schema.ts") against the grammar
 *   file's location before calling this function.
 * @returns The resolved type definition, or undefined if not found
 */
export type SchemaLoader = (
    typeName: string,
    source: string,
) => SchemaTypeDefinition | undefined;

type DefinitionRecord = {
    definitions: RuleDefinition[];
    grammarRules?: GrammarRule[];
    hasValue: boolean;
    compiling: boolean; // true while grammarRules is being populated
    nullable?: boolean; // set after compilation; true if any alternative matches ε
    valueType?: string[] | undefined; // declared return type names (e.g. <Rule> : A | B = ...)
};

type ResolvedDefinitionRecord = DefinitionRecord & {
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
    exportedNames: Set<string>; // Only rules with export keyword are importable
    importedRuleMap: Map<string, CompileContext>; // Rule names imported from .agr files
    importedRulePositions: Map<string, number | undefined>; // Source positions of rule import statements for diagnostics
    usedImportedRules: Set<string>; // Imported rules actually referenced during compilation
    importedTypeNames: Map<string, number | undefined>; // All imported type names with positions (source-less entity imports + .ts type imports)
    usedImportedTypes: Set<string>; // Imported types actually referenced in variables (entity + .ts type imports)
    resolvedTypes: Map<string, SchemaTypeDefinition>; // Parsed schema types resolved via SchemaLoader
    hasStarImport: boolean; // Indicates if there's a star import
    currentDefinition?: string | undefined;
    valuePositions: Map<CompiledValueNode, number>; // source positions of value nodes for error reporting (compile-time only)
    derivedTypes: Map<GrammarRule[], SchemaType>; // cached derived output types for rule arrays (compile-time only)
    errors: GrammarCompileError[];
    warnings: GrammarCompileError[];
};

function createImportCompileContext(
    fileLoader: FileLoader,
    grammarFileMap: Map<string, CompileContext>,
    referencingFileName: string,
    source: string,
): CompileContext {
    const fullPath = fileLoader.resolvePath(source, referencingFileName);
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

const BUILTIN_ENTITIES_VIRTUAL_PATH = "__builtInEntities__";

/**
 * Lazily create (or retrieve from cache) the CompileContext for the built-in
 * entity grammar. Uses a virtual path so it is compiled at most once per
 * grammarFileMap.
 */
function getBuiltInGrammarContext(
    grammarFileMap: Map<string, CompileContext>,
): CompileContext {
    const cached = grammarFileMap.get(BUILTIN_ENTITIES_VIRTUAL_PATH);
    if (cached) return cached;

    const content = getBuiltInEntitiesGrammarContent();
    const displayPath = "builtInEntities.agr";
    const result = parseGrammarRules(
        displayPath,
        content,
        undefined,
        true, // enableValueExpressions — built-in grammar uses them
    );
    return createCompileContext(
        grammarFileMap,
        content,
        displayPath,
        BUILTIN_ENTITIES_VIRTUAL_PATH,
        undefined,
        result.definitions,
        result.imports,
    );
}

// Cached set of built-in exported rule names, lazily initialised.
// Used to decide whether a source-less import name (e.g. `import { Ordinal }`)
// refers to a built-in grammar rule or a legacy entity type.
let builtInExportedNamesCache: Set<string> | undefined;

function getBuiltInExportedNames(
    grammarFileMap: Map<string, CompileContext>,
): Set<string> {
    if (builtInExportedNamesCache === undefined) {
        builtInExportedNamesCache =
            getBuiltInGrammarContext(grammarFileMap).exportedNames;
    }
    return builtInExportedNamesCache;
}

/**
 * Import a single grammar rule from an import context.
 * Validates that the rule is exported and doesn't conflict with local
 * definitions, then adds it to importedRuleMap.
 *
 * For wildcard imports (import *), non-exported rules are silently skipped.
 * For named imports (sourced or source-less), non-exported rules produce an error.
 */
function importGrammarRule(
    context: CompileContext,
    importContext: CompileContext,
    ruleName: string,
    importStmt: ImportStatement,
    ruleDefMap: DefinitionMap,
    importedRuleMap: Map<string, CompileContext>,
): void {
    if (!importContext.exportedNames.has(ruleName)) {
        // Wildcard imports silently skip non-exported rules.
        // Named imports (sourced or source-less) produce an error.
        if (importStmt.names !== "*") {
            const source = importStmt.source ?? "built-in entities";
            context.errors.push({
                message: `Rule '<${ruleName}>' is not exported from '${source}'.`,
                definition: ruleName,
                pos: importStmt.pos,
            });
        }
        return;
    }
    if (ruleDefMap.has(ruleName)) {
        context.errors.push({
            message: `Rule '<${ruleName}>' cannot be imported because it is already defined in this file.`,
            definition: ruleName,
            pos: importStmt.pos,
        });
    } else if (
        importedRuleMap.has(ruleName) &&
        importedRuleMap.get(ruleName) !== importContext
    ) {
        context.errors.push({
            message: `Rule '<${ruleName}>' is already imported from '${importedRuleMap.get(ruleName)!.displayPath}'.`,
            definition: ruleName,
            pos: importStmt.pos,
        });
    } else {
        importedRuleMap.set(ruleName, importContext);
        context.importedRulePositions.set(ruleName, importStmt.pos);
    }
}

function createCompileContext(
    grammarFileMap: Map<string, CompileContext>,
    content: string,
    displayPath: string,
    fullPath: string,
    fileUtils: FileLoader | undefined,
    definitions: RuleDefinition[],
    imports?: ImportStatement[],
    schemaLoader?: SchemaLoader,
): CompileContext {
    const ruleDefMap: DefinitionMap = new Map();

    // Build imported rule names and type names
    const importedRuleMap = new Map<string, CompileContext>();
    const importedRulePositions = new Map<string, number | undefined>();
    const usedImportedRules = new Set<string>();
    const importedTypeNames = new Map<string, number | undefined>();
    const usedImportedTypes = new Set<string>();
    const resolvedTypes = new Map<string, SchemaTypeDefinition>();

    // Build exportedNames from definitions with exported: true
    // Only rules explicitly marked with export are importable
    const exportedNames = new Set<string>();
    for (const def of definitions) {
        if (def.exported) {
            exportedNames.add(def.definitionName.name);
        }
    }

    // Create the context early and add to the map BEFORE processing anything
    // This prevents infinite recursion on circular dependencies
    const context: CompileContext = {
        grammarFileMap,
        content,
        displayPath,
        ruleDefMap,
        exportedNames,
        importedRuleMap,
        importedRulePositions,
        usedImportedRules,
        importedTypeNames,
        usedImportedTypes,
        resolvedTypes,
        hasStarImport: false,
        valuePositions: new Map(),
        derivedTypes: new Map(),
        errors: [],
        warnings: [],
    };

    // Process definitions FIRST - this populates ruleDefMap
    // This allows circular imports to work since our definitions are available
    // when other files try to import from us
    for (const def of definitions) {
        const existing = ruleDefMap.get(def.definitionName.name);
        if (existing === undefined) {
            ruleDefMap.set(def.definitionName.name, {
                definitions: [def],
                // Set this to true to allow recursion to assume that it has value.
                hasValue: true,
                compiling: false,
                valueType: def.valueType?.map((vt) => vt.name),
            });
        } else {
            existing.definitions.push(def);
        }
    }

    // Add to map before processing so circular imports can be detected
    grammarFileMap.set(fullPath, context);

    // Process imports AFTER definitions - this populates importedRuleMap
    if (imports) {
        for (const importStmt of imports) {
            // Source-less imports are entity/built-in declarations: import { Ordinal, Cardinal };
            // Names that match exported rules in the built-in entity grammar are
            // imported as grammar rules (same as .agr imports).  All names are
            // also registered as entity type names for runtime entity registry
            // compatibility.
            if (importStmt.source === undefined) {
                if (importStmt.names !== "*") {
                    const builtInCtx = getBuiltInGrammarContext(grammarFileMap);
                    const builtInExported =
                        getBuiltInExportedNames(grammarFileMap);

                    for (const { name } of importStmt.names) {
                        // If the name matches a built-in exported rule,
                        // import it as a grammar rule (same as .agr imports).
                        // If it's a camelCase alias (e.g., "ordinal" for
                        // "Ordinal"), treat as a legacy entity type only.
                        // All other names produce an error via
                        // importGrammarRule (not exported from built-in).
                        const isLegacyCamelCase =
                            !builtInExported.has(name) &&
                            builtInExported.has(
                                name[0].toUpperCase() + name.slice(1),
                            );
                        if (!isLegacyCamelCase) {
                            importGrammarRule(
                                context,
                                builtInCtx,
                                name,
                                importStmt,
                                ruleDefMap,
                                importedRuleMap,
                            );
                        }
                        // Legacy: Always register the name as an imported type so it
                        // appears in grammar.entities for runtime entity
                        // registry compatibility.
                        importedTypeNames.set(name, importStmt.pos);

                        // Don't warn not used as type.
                        usedImportedTypes.add(name);
                    }
                }
                continue;
            }
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
                    importStmt.source,
                );

                const ruleNames =
                    importStmt.names === "*"
                        ? importContext.ruleDefMap.keys()
                        : importStmt.names.map((n) => n.name);

                for (const ruleName of ruleNames) {
                    importGrammarRule(
                        context,
                        importContext,
                        ruleName,
                        importStmt,
                        ruleDefMap,
                        importedRuleMap,
                    );
                }
            } else {
                if (importStmt.names === "*") {
                    // For wildcard imports, we can't know all names at compile time
                    // They will be validated at runtime instead
                    // Mark with a special sentinel to indicate wildcard import
                    context.hasStarImport = true;
                } else {
                    for (const { name } of importStmt.names) {
                        importedTypeNames.set(name, importStmt.pos);
                        // Resolve type via SchemaLoader if available
                        if (schemaLoader) {
                            // Resolve relative source path against the grammar file
                            const resolvedSource = fileUtils
                                ? fileUtils.resolvePath(
                                      importStmt.source,
                                      fullPath,
                                  )
                                : importStmt.source;
                            const def = schemaLoader(name, resolvedSource);
                            if (def !== undefined) {
                                if (!def.exported) {
                                    context.errors.push({
                                        message: `Type '${name}' is not exported from '${importStmt.source}'`,
                                        pos: importStmt.pos,
                                    });
                                }
                                resolvedTypes.set(name, def);
                            } else {
                                context.errors.push({
                                    message: `Cannot resolve type '${name}' from '${importStmt.source}'`,
                                    pos: importStmt.pos,
                                });
                            }
                        }
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
    schemaLoader?: SchemaLoader,
    optimizations?: GrammarOptimizationOptions,
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
        schemaLoader,
    );

    const { grammarRules, hasValue } = createNamedGrammarRules(context, start);

    if (startValueRequired && !hasValue) {
        context.errors.push({
            message: `Start rule '<${start}>' does not produce a value.`,
            definition: start,
        });
    }

    for (const [name, record] of context.ruleDefMap.entries()) {
        if (
            record.grammarRules === undefined &&
            !context.exportedNames.has(name)
        ) {
            context.warnings.push({
                message: `Rule '<${name}>' is defined but never used.`,
                pos: record.definitions[0]?.pos,
            });
        }
    }

    // Warn about imported rules that are declared but never used
    for (const [, compileContext] of context.grammarFileMap) {
        for (const [ruleName, pos] of compileContext.importedRulePositions) {
            if (!compileContext.usedImportedRules.has(ruleName)) {
                compileContext.warnings.push({
                    message: `Imported rule '<${ruleName}>' is declared but never used.`,
                    pos,
                });
            }
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

    // TODO: Find a better way to discover entities instead of deriving them
    // from import statements.
    // Collect entity names from two sources:
    // 1. Source-less imports: import { Ordinal, Cardinal };
    // 2. Imported .ts types used as variable types across all contexts
    const allEntities = new Set<string>();
    for (const name of context.importedTypeNames.keys()) {
        allEntities.add(name);
    }
    for (const [, compileContext] of context.grammarFileMap) {
        for (const t of compileContext.usedImportedTypes) {
            allEntities.add(t);
        }
    }

    const grammar: Grammar = { rules: grammarRules };
    if (allEntities.size > 0) {
        grammar.entities = Array.from(allEntities);
    }
    // Skip optimizations when there were errors — the AST may be partial
    // and optimization invariants may not hold.
    if (errors.length === 0 && optimizations !== undefined) {
        return optimizeGrammar(grammar, optimizations, warnings);
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

/**
 * Validate variable references in a ValueNode and compile it to a CompiledValueNode,
 * stripping parser-only comment fields so the result is safe for serialization into .ag.json.
 */
function validateAndCompileValueNode(
    context: CompileContext,
    node: ValueNode,
    availableVariables: Set<string>,
): CompiledValueNode {
    let result: CompiledValueNode;
    switch (node.type) {
        case "literal":
            result = { type: "literal", value: node.value };
            break;
        case "variable":
            if (!availableVariables.has(node.name)) {
                context.errors.push({
                    message: `Variable '${node.name}' is referenced in the value but not defined in the rule`,
                    definition: context.currentDefinition,
                });
            }
            result = { type: "variable", name: node.name };
            break;
        case "object": {
            const elements: CompiledObjectElement[] = [];
            for (const elem of node.value) {
                if (isObjectSpread(elem)) {
                    elements.push({
                        type: "spread",
                        argument: validateAndCompileValueNode(
                            context,
                            elem.argument,
                            availableVariables,
                        ),
                    });
                } else if (elem.value === null) {
                    // Shorthand form: { key } means { key: key }
                    // Validate that 'key' is an available variable
                    if (!availableVariables.has(elem.key)) {
                        context.errors.push({
                            message: `Variable '${elem.key}' is referenced in the value but not defined in the rule`,
                            definition: context.currentDefinition,
                        });
                    }
                    elements.push({
                        type: "property",
                        key: elem.key,
                        value: null,
                    });
                } else {
                    elements.push({
                        type: "property",
                        key: elem.key,
                        value: validateAndCompileValueNode(
                            context,
                            elem.value,
                            availableVariables,
                        ),
                    });
                }
            }
            result = { type: "object", value: elements };
            break;
        }
        case "array":
            result = {
                type: "array",
                value: node.value.map((elem) =>
                    validateAndCompileValueNode(
                        context,
                        elem.value,
                        availableVariables,
                    ),
                ),
            };
            break;

        // ── Value expression nodes ────────────────────────────────────
        case "binaryExpression":
            result = {
                type: "binaryExpression",
                operator: node.operator,
                left: validateAndCompileValueNode(
                    context,
                    node.left,
                    availableVariables,
                ),
                right: validateAndCompileValueNode(
                    context,
                    node.right,
                    availableVariables,
                ),
            };
            break;
        case "unaryExpression":
            result = {
                type: "unaryExpression",
                operator: node.operator,
                operand: validateAndCompileValueNode(
                    context,
                    node.operand,
                    availableVariables,
                ),
            };
            break;
        case "conditionalExpression":
            result = {
                type: "conditionalExpression",
                test: validateAndCompileValueNode(
                    context,
                    node.test,
                    availableVariables,
                ),
                consequent: validateAndCompileValueNode(
                    context,
                    node.consequent,
                    availableVariables,
                ),
                alternate: validateAndCompileValueNode(
                    context,
                    node.alternate,
                    availableVariables,
                ),
            };
            break;
        case "memberExpression":
            result = {
                type: "memberExpression",
                object: validateAndCompileValueNode(
                    context,
                    node.object,
                    availableVariables,
                ),
                property:
                    typeof node.property === "string"
                        ? node.property
                        : validateAndCompileValueNode(
                              context,
                              node.property,
                              availableVariables,
                          ),
                computed: node.computed,
                optional: node.optional,
            };
            break;
        case "callExpression":
            result = {
                type: "callExpression",
                callee: validateAndCompileValueNode(
                    context,
                    node.callee,
                    availableVariables,
                ),
                arguments: node.arguments.map((arg) =>
                    validateAndCompileValueNode(
                        context,
                        arg,
                        availableVariables,
                    ),
                ),
                ...(node.optional ? { optional: true } : {}),
            };
            break;
        case "spreadElement":
            result = {
                type: "spreadElement",
                argument: validateAndCompileValueNode(
                    context,
                    node.argument,
                    availableVariables,
                ),
            };
            break;
        case "templateLiteral":
            result = {
                type: "templateLiteral",
                quasis: node.quasis,
                expressions: node.expressions.map((expr) =>
                    validateAndCompileValueNode(
                        context,
                        expr,
                        availableVariables,
                    ),
                ),
            };
            break;
        default:
            throw new Error(`Unknown value node type '${(node as any).type}'`);
    }
    // Track source position of the value node for error reporting
    if (node.pos !== undefined) {
        context.valuePositions.set(result, node.pos);
    }
    return result;
}

// Sentinel for missing rule definitions. Pre-populated grammarRules suppress
// re-compilation; empty definitions yield undefined for any pos lookup.
const emptyRecord: ResolvedDefinitionRecord = {
    definitions: [],
    grammarRules: [],
    hasValue: true, // Pretend to have value to avoid cascading errors
    compiling: false,
    nullable: false,
};

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
): ResolvedDefinitionRecord {
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
        context.usedImportedRules.add(name);
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
        let hasValue = true;
        let nullable = false;
        for (const entry of record.definitions) {
            const result = createGrammarRules(
                context,
                entry.rules,
                eprWithSelf,
                // Fold "auto" (explicit annotation) to undefined (runtime default) so
                // the NFA compiler and matcher never see the parser-only "auto" value.
                entry.spacingMode === "auto" ? undefined : entry.spacingMode,
                record.grammarRules,
            );
            hasValue = hasValue && result.hasValue;
            nullable = nullable || result.nullable;
        }
        record.hasValue = hasValue;
        record.compiling = false;
        record.nullable = nullable;
        context.currentDefinition = prev;

        // Track valueType entries as used imported types
        if (record.valueType !== undefined) {
            for (const typeName of record.valueType) {
                // Verify the type was actually imported
                if (
                    !context.importedTypeNames.has(typeName) &&
                    !context.hasStarImport
                ) {
                    context.errors.push({
                        message: `Type '${typeName}' in value type annotation is not imported`,
                        definition: name,
                    });
                }
                context.usedImportedTypes.add(typeName);
            }

            // Collect all leaf value nodes from the rule tree,
            // including those in sub-rules referenced via RulesPart.
            //
            // Why per-leaf instead of deriving the whole rule's type and doing
            // a single isTypeAssignable check?  Semantically equivalent, but
            // per-leaf validation yields much better diagnostics:
            //   1. Source positions — each leaf carries a pos, so errors point
            //      to the specific -> expression, not just the rule name.
            //   2. Structural detail — object leaves get field-level messages
            //      (missing required property, extraneous property, type mismatch).
            //   3. Per-alternative isolation — if one of N alternatives is wrong,
            //      the error identifies that alternative rather than failing the
            //      whole union.
            const leafValues = collectLeafValues(
                record.grammarRules,
                context.valuePositions,
            );

            // Pass 1: Expression-internal consistency (always runs).
            // Catches operator constraint violations and inference errors
            // regardless of whether a schema loader resolved types.
            // Only expression-typed leaves will produce errors here;
            // validateExprTypes early-returns for non-expression nodes.
            // "variable" leaves have no value node to validate internally.
            const leafExprTypes = new Map<CompiledValueNode, SchemaType>();
            const leafVarTypes = new Map<
                CompiledValueNode,
                Map<string, SchemaType>
            >();
            for (const leaf of leafValues) {
                if (leaf.kind !== "value") continue;
                const varTypes = buildVariableTypeMap(
                    leaf.parts,
                    context.derivedTypes,
                );
                leafVarTypes.set(leaf.value, varTypes);
                const result = validateExprTypes(leaf.value, varTypes);
                for (const error of result.errors) {
                    context.errors.push({
                        message: error,
                        definition: name,
                        pos: leaf.pos,
                    });
                }
                for (const warning of result.warnings) {
                    context.warnings.push({
                        message: warning,
                        definition: name,
                        pos: leaf.pos,
                    });
                }
                if (result.inferredType !== undefined) {
                    leafExprTypes.set(leaf.value, result.inferredType);
                }
            }

            // Pass 2: Conformance against declared type (only when resolved).
            if (context.resolvedTypes.size > 0) {
                const declaredTypes: SchemaType[] = [];
                for (const typeName of record.valueType) {
                    const def = context.resolvedTypes.get(typeName);
                    if (def !== undefined) {
                        declaredTypes.push(def.type);
                    }
                }
                if (declaredTypes.length > 0) {
                    const expectedType: SchemaType =
                        declaredTypes.length === 1
                            ? declaredTypes[0]
                            : { type: "type-union", types: declaredTypes };

                    for (const leaf of leafValues) {
                        let errors: string[];
                        if (leaf.kind === "value") {
                            const varTypes = leafVarTypes.get(leaf.value)!;
                            errors = validateValueType(
                                leaf.value,
                                expectedType,
                                varTypes,
                                "",
                                leafExprTypes.get(leaf.value),
                            );
                        } else {
                            // "variable" leaf — check variable type directly
                            const varTypes = buildVariableTypeMap(
                                leaf.parts,
                                context.derivedTypes,
                            );
                            const varType = varTypes.get(leaf.variableName);
                            if (varType !== undefined) {
                                errors = validateVariableType(
                                    leaf.variableName,
                                    varType,
                                    expectedType,
                                );
                            } else {
                                errors = [];
                            }
                        }
                        for (const error of errors) {
                            context.errors.push({
                                message: error,
                                definition: name,
                                pos:
                                    leaf.kind === "value"
                                        ? leaf.pos
                                        : undefined,
                            });
                        }
                    }
                }
            }
        }
    }

    if (referenceVariable !== undefined && !record.hasValue) {
        referenceContext.errors.push({
            message: `Referenced rule '<${name}>' does not produce a value for variable '${referenceVariable}'`,
            definition: referenceContext.currentDefinition,
            pos: referencePosition,
        });
    }
    return record as ResolvedDefinitionRecord;
}

type LeafValue =
    | {
          kind: "value";
          value: CompiledValueNode;
          parts: GrammarPart[];
          pos?: number | undefined;
      }
    | {
          kind: "variable";
          variableName: string;
          parts: GrammarPart[];
      };

/**
 * Recursively collects all leaf value nodes from a grammar rule tree.
 * A "leaf" is a GrammarRule that has a direct value expression (-> { ... })
 * or a single-variable implicit rule whose variable type must be validated.
 * Rules that pass through to sub-rules (single RulesPart, no variables,
 * no explicit value) are traversed recursively.
 *
 * Uses `classifyRuleValue` from the validator to keep classification
 * logic in sync with `deriveAlternativeType`.
 */
function collectLeafValues(
    rules: GrammarRule[],
    valuePositions: Map<CompiledValueNode, number>,
    visited: Set<GrammarRule[]> = new Set(),
): LeafValue[] {
    if (visited.has(rules)) {
        return []; // Avoid infinite loops on circular rule references
    }
    visited.add(rules);

    const results: LeafValue[] = [];
    for (const rule of rules) {
        const kind = classifyRuleValue(rule);
        switch (kind.kind) {
            case "explicit":
                results.push({
                    kind: "value",
                    value: rule.value!,
                    parts: rule.parts,
                    pos: valuePositions.get(rule.value!),
                });
                break;
            case "variable":
                results.push({
                    kind: "variable",
                    variableName: kind.variableName,
                    parts: rule.parts,
                });
                break;
            case "passthrough":
                results.push(
                    ...collectLeafValues(kind.rules, valuePositions, visited),
                );
                break;
            // "none": multi-var with no explicit value — already warned
        }
    }
    return results;
}

function createGrammarRules(
    context: CompileContext,
    rules: Rule[],
    epsilonReachable: Set<string>,
    spacingMode: CompiledSpacingMode,
    grammarRules: GrammarRule[] = [],
): { grammarRules: GrammarRule[]; hasValue: boolean; nullable: boolean } {
    let hasValue = true;
    let nullable = false; // nullable if ANY alternative is nullable
    for (const r of rules) {
        const result = createGrammarRule(
            context,
            r,
            epsilonReachable,
            spacingMode,
        );
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
    spacingMode: CompiledSpacingMode,
): {
    grammarRule: GrammarRule;
    hasValue: boolean;
    nullable: boolean;
} {
    // Per-alternate [spacing=...] overrides definition-level spacing
    if (rule.spacingMode !== undefined) {
        spacingMode =
            rule.spacingMode === "auto" ? undefined : rule.spacingMode;
    }
    const { expressions, value } = rule;
    const parts: GrammarPart[] = [];
    const availableVariables = new Set<string>();
    let variableCount = 0;
    // Whether the last part can implicitly produce a value (string literal
    // or rule reference). Used for zero-variable, single-part rules where
    // the matched text or referenced rule's value is the implicit output.
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
                const { variableName, refName, ruleReference, refPos, pos } =
                    expr;
                const referencedName = refName?.name ?? "string";
                const name = variableName.name;
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
                        referencedName,
                        refPos,
                        name,
                        currentEpr,
                    );
                    parts.push({
                        type: "rules",
                        rules: record.grammarRules,
                        variable: name,
                        name: referencedName,
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
                } else if (referencedName === "number") {
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
                        referencedName === "string" ||
                        referencedName === "wildcard" ||
                        referencedName === "word";
                    if (!isBuiltInType) {
                        const isImportedType =
                            context.hasStarImport ||
                            context.importedTypeNames.has(referencedName) ||
                            globalEntityRegistry.getConverter(
                                referencedName,
                            ) !== undefined;

                        if (!isImportedType) {
                            context.errors.push({
                                message: `Undefined type '${referencedName}' in variable '${name}'`,
                                definition: context.currentDefinition,
                                pos: refPos,
                            });
                        } else {
                            // Track imported .ts types used as variable types.
                            // These need runtime entity validation (like old "entity" declarations).
                            context.usedImportedTypes.add(referencedName);
                        }
                    }

                    parts.push({
                        type: "wildcard",
                        variable: name,
                        optional: expr.optional,
                        typeName: referencedName,
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
                    context.ruleDefMap.has(expr.refName.name) ||
                    context.importedRuleMap.has(expr.refName.name);
                if (
                    !isLocallyDefined &&
                    globalPhraseSetRegistry.isPhraseSetName(expr.refName.name)
                ) {
                    parts.push({
                        type: "phraseSet",
                        matcherName: expr.refName.name,
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
                    expr.refName.name,
                    expr.pos,
                    undefined,
                    currentEpr,
                );
                // default value of the rule reference
                defaultValue = record.hasValue;
                parts.push({
                    type: "rules",
                    rules: record.grammarRules,
                    name: expr.refName.name,
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
                } = createGrammarRules(context, rules, currentEpr, spacingMode);
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

    let compiledValue: CompiledValueNode | undefined;
    if (value !== undefined) {
        compiledValue = validateAndCompileValueNode(
            context,
            value,
            availableVariables,
        );
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
            value: compiledValue,
            spacingMode,
        },
        hasValue:
            value !== undefined ||
            variableCount === 1 ||
            (variableCount === 0 && parts.length === 1 && defaultValue),
        nullable: ruleNullable,
    };
}
