// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CompiledValueNode,
    CompiledValueExprNode,
    CompiledArrayValueNode,
    GrammarPart,
    GrammarRule,
} from "./grammarTypes.js";
import type {
    SchemaType,
    SchemaTypeReference,
    ActionParamObject as SchemaTypeObject,
    SchemaObjectField,
} from "@typeagent/action-schema";
import { SchemaCreator } from "@typeagent/action-schema";
import { getDispatchEffectiveMembers } from "./dispatchHelpers.js";

// Sentinel for "any" — can't determine type
const ANY_TYPE: SchemaType = SchemaCreator.any();

/**
 * Sentinel for "error during type inference."
 * Module-private — only reachable via `isErrorType()`, so identity
 * comparison is safe and sufficient.  When a derive function encounters
 * a lookup failure (unknown variable, property, or method) it pushes an
 * error and returns ERROR_TYPE.  Compound nodes (ternary, ??, ||, &&)
 * propagate ERROR_TYPE so downstream operators skip validation and avoid
 * cascading error messages.
 */
const ERROR_TYPE: SchemaType = { type: "any" as const };

/** Check whether a type is the error sentinel. */
function isErrorType(t: SchemaType): boolean {
    return t === ERROR_TYPE;
}

/**
 * A type-inference or operator-constraint error with a reference to the
 * specific sub-expression node that caused it.  The compiler converts these
 * to positioned `GrammarCompileError` via `valuePositions.get(error.node)`.
 */
export type ValueTypeError = {
    message: string;
    node: CompiledValueNode;
};

/**
 * Produce a human-readable label for a SchemaType.
 * Keeps union formatting terse (`string | number`).
 */
function formatSchemaType(t: SchemaType): string {
    switch (t.type) {
        case "type-union":
            return t.types.map(formatSchemaType).join(" | ");
        case "type-reference":
            return t.name;
        case "array":
            return `${formatSchemaType(t.elementType)}[]`;
        case "object":
            return "object";
        default:
            return t.type;
    }
}

/** Check whether a type is string-like (plain string or string-union). */
function isStringType(t: SchemaType): boolean {
    return t.type === "string" || t.type === "string-union";
}

/** Check whether a type is boolean-like (boolean, true, or false literal). */
function isBooleanType(t: SchemaType): boolean {
    return t.type === "boolean" || t.type === "true" || t.type === "false";
}

/**
 * Collect supported method names for a given object type for error messages.
 * Results are memoized since the method sets are static.
 */
const _supportedMethodsCache = new Map<string, string[]>();
function supportedMethodsForType(typeName: string): string[] {
    if (typeName === "string-union") typeName = "string";
    let cached = _supportedMethodsCache.get(typeName);
    if (cached !== undefined) return cached;
    const methods: string[] = [];
    if (typeName === "string") {
        for (const s of [
            STRING_TO_STRING_METHODS,
            STRING_TO_NUMBER_METHODS,
            STRING_TO_BOOLEAN_METHODS,
            STRING_TO_ARRAY_METHODS,
        ]) {
            for (const m of s) methods.push(m);
        }
    } else if (typeName === "array") {
        for (const s of [
            ARRAY_TO_STRING_METHODS,
            ARRAY_TO_BOOLEAN_METHODS,
            ARRAY_TO_NUMBER_METHODS,
            ARRAY_TO_ARRAY_METHODS,
        ]) {
            for (const m of s) methods.push(m);
        }
    } else if (typeName === "number") {
        for (const m of NUMBER_TO_STRING_METHODS) methods.push(m);
    }
    cached = methods.sort();
    _supportedMethodsCache.set(typeName, cached);
    return cached;
}

/**
 * Check whether a type contains `undefined` (either is `undefined` directly,
 * or is a union with an `undefined` member).
 */
function containsUndefined(t: SchemaType): boolean {
    if (t.type === "undefined") return true;
    if (t.type === "type-union")
        return t.types.some((m) => containsUndefined(m));
    return false;
}

/**
 * Remove `undefined` from a type.  Returns the original type unchanged if
 * it doesn't contain `undefined`.  For a union, filters out `undefined`
 * members and simplifies (single remaining member → unwrap).
 *
 * Returns `undefined` type unchanged when the input is bare `undefined`
 * (or a union of only `undefined` members) so callers can detect and
 * handle it appropriately rather than receiving ERROR_TYPE.
 */
function stripUndefined(t: SchemaType): SchemaType {
    if (t.type === "undefined") return t; // bare undefined — caller decides
    if (t.type !== "type-union") return t;
    const remaining = t.types.filter((m) => m.type !== "undefined");
    if (remaining.length === 0) return SchemaCreator.undefined_(); // all members were undefined
    if (remaining.length === 1) return remaining[0];
    return SchemaCreator.union(...remaining);
}

/** Type guard for value expression nodes (computed at runtime). */
function isValueExprNode(
    node: CompiledValueNode,
): node is CompiledValueExprNode {
    switch (node.type) {
        case "binaryExpression":
        case "unaryExpression":
        case "conditionalExpression":
        case "memberExpression":
        case "callExpression":
        case "spreadElement":
        case "templateLiteral":
            return true;
        default:
            return false;
    }
}

// ── Method return type tables ─────────────────────────────────────────────────
// Used by deriveValueType to infer return types for whitelisted method calls.

const STRING_TO_STRING_METHODS = new Set([
    "toLowerCase",
    "toUpperCase",
    "trim",
    "trimStart",
    "trimEnd",
    "slice",
    "substring",
    "repeat",
    "padStart",
    "padEnd",
    "replace",
    "replaceAll",
    "concat",
    "charAt",
    "at",
    "toString",
]);

const STRING_TO_NUMBER_METHODS = new Set([
    "indexOf",
    "lastIndexOf",
    "charCodeAt",
    "codePointAt",
    "search",
]);

const STRING_TO_BOOLEAN_METHODS = new Set([
    "includes",
    "startsWith",
    "endsWith",
]);

const ARRAY_TO_BOOLEAN_METHODS = new Set(["includes"]);

const ARRAY_TO_NUMBER_METHODS = new Set(["indexOf", "lastIndexOf"]);

/** Array methods that return an array of the same element type. */
const ARRAY_TO_ARRAY_METHODS = new Set([
    "slice",
    "reverse",
    "sort",
    "concat",
    "flat",
]);

/** String methods that return an array (special-cased for element type). */
const STRING_TO_ARRAY_METHODS = new Set(["split"]);

/** Array methods that return a string (special-cased). */
const ARRAY_TO_STRING_METHODS = new Set(["join"]);

/** Number methods that return a string. */
const NUMBER_TO_STRING_METHODS = new Set([
    "toFixed",
    "toString",
    "toPrecision",
    "toExponential",
]);

/**
 * All method return-type tables, exported so the runtime evaluator can derive
 * its safe-method whitelist from the same source of truth.
 */
export const METHOD_RETURN_TYPE_TABLES = {
    STRING_TO_STRING_METHODS,
    STRING_TO_NUMBER_METHODS,
    STRING_TO_BOOLEAN_METHODS,
    STRING_TO_ARRAY_METHODS,
    ARRAY_TO_BOOLEAN_METHODS,
    ARRAY_TO_NUMBER_METHODS,
    ARRAY_TO_ARRAY_METHODS,
    ARRAY_TO_STRING_METHODS,
    NUMBER_TO_STRING_METHODS,
} as const;

// ── Method argument type constraints ──────────────────────────────────────────
// Maps "objectType.method" to the expected argument types.  Each entry is an
// array of argument slots; `undefined` means "any type accepted" for that slot.
// Only methods whose arguments have meaningful type constraints are listed —
// methods with no constraints (e.g. trim()) are omitted and pass validation.
type ArgType = "string" | "number" | undefined;
const METHOD_ARG_TYPES: Record<string, ArgType[]> = {
    // String methods
    "string.slice": ["number", "number"],
    "string.substring": ["number", "number"],
    "string.repeat": ["number"],
    "string.padStart": ["number", "string"],
    "string.padEnd": ["number", "string"],
    "string.replace": ["string", "string"],
    "string.replaceAll": ["string", "string"],
    "string.charAt": ["number"],
    "string.at": ["number"],
    "string.indexOf": ["string", "number"],
    "string.lastIndexOf": ["string", "number"],
    "string.charCodeAt": ["number"],
    "string.codePointAt": ["number"],
    "string.includes": ["string", "number"],
    "string.startsWith": ["string", "number"],
    "string.endsWith": ["string", "number"],
    "string.split": ["string", "number"],
    // Array methods
    "array.slice": ["number", "number"],
    "array.indexOf": [undefined, "number"],
    "array.lastIndexOf": [undefined, "number"],
    "array.join": ["string"],
    // Number methods
    "number.toFixed": ["number"],
    "number.toPrecision": ["number"],
    "number.toExponential": ["number"],
    "number.toString": ["number"],
};

/** Per-cache counters for generating unique names for anonymous rules.
 * A WeakMap keyed on the type-derivation cache (a plain Map) avoids
 * polluting the cache object itself and lets the counter be reclaimed
 * automatically when the cache goes out of scope after compilation.
 */
const cacheCounters = new WeakMap<
    Map<GrammarRule[], SchemaType>,
    { value: number }
>();

/**
 * Generate a unique name for an anonymous (unnamed) rule.
 * Named rules pass their name through `deriveRuleValueType(rules, cache, name)`;
 * this fallback is only used for inline nested groups without an explicit name.
 * The names are internal to the type-derivation cache and never surface in
 * user-facing error messages.
 */
function nextRuleName(cache: Map<GrammarRule[], SchemaType>): string {
    let counter = cacheCounters.get(cache);
    if (!counter) {
        counter = { value: 0 };
        cacheCounters.set(cache, counter);
    }
    return `__anon_${counter.value++}`;
}

/**
 * Derives the output SchemaType of a compiled rule (GrammarRule[]).
 * Returns a SchemaType representing the rule's output, or the "any" sentinel
 * for rules whose type can't be determined.
 * Uses a cache to avoid recomputing for rules referenced by multiple parents.
 *
 * Recursive references are handled via type-references in a single pass:
 *   1. Seed the cache with an unresolved SchemaTypeReference before recursing.
 *   2. Derive the rule's type — recursive back-edges embed the ref.
 *   3. Classify the result:
 *      a. Ref not present → not recursive. Use the raw type.
 *      b. Ref appears only as a direct top-level union member → passthrough
 *         recursion (e.g. `<A> = string | <A>`). Strip the self-ref, yielding
 *         the base type.
 *      c. Ref appears nested inside objects/arrays → structural recursion
 *         (e.g. `<Tree> = string | { inner: <Tree> }`). Wrap in a
 *         SchemaTypeAliasDefinition to form a self-referential type graph.
 *
 * In all cases, ref.definition is set so that mutual recursion partners
 * that picked up our ref from the cache during derivation can resolve it.
 */
function deriveRuleValueType(
    rules: GrammarRule[],
    cache: Map<GrammarRule[], SchemaType>,
    name?: string,
): SchemaType {
    const cached = cache.get(rules);
    if (cached !== undefined) {
        return cached;
    }

    // Create a type-reference as the provisional seed for this rule.
    // Any recursive back-references during derivation will embed this ref.
    const ruleName = name ?? nextRuleName(cache);
    const ref = SchemaCreator.ref(ruleName);
    cache.set(rules, ref);

    // Derive the rule's type in a single pass.
    const result = deriveRuleValueTypeOnce(rules, cache);

    if (result === ANY_TYPE || result === ref) {
        // Degenerate: all-ANY or pure self-reference (e.g. <A> = <A>).
        cache.set(rules, ANY_TYPE);
        return ANY_TYPE;
    }

    // Classify how the ref appears in the derived type.
    const refPos = findRefInType(result, ruleName);

    switch (refPos) {
        case "none":
            // Not recursive — use the raw result directly.
            // Set the ref's definition in case mutual recursion partners
            // picked up our ref from the cache during derivation.
            ref.definition = {
                alias: true as const,
                name: ruleName,
                type: result,
            };
            cache.set(rules, result);
            return result;

        case "top-union": {
            // Passthrough recursion (e.g. <A> = string | <A>).
            // Strip the self-referencing union members.
            const stripped = stripRefFromUnion(result, ruleName);
            // Set the ref's definition so external references (from mutual
            // recursion partners) resolve correctly through the ref.
            ref.definition = {
                alias: true as const,
                name: ruleName,
                type: stripped,
            };
            cache.set(rules, stripped);
            return stripped;
        }

        case "nested":
            // Structural recursion (e.g. <Tree> = string | { inner: <Tree> }).
            // Wrap in an alias and tie the knot.
            ref.definition = {
                alias: true as const,
                name: ruleName,
                type: result,
            };
            cache.set(rules, ref);
            return ref;
    }
}

/**
 * Single-pass derivation of a rule's output type.
 * ANY_TYPE alternatives are skipped (they contribute no type information).
 * Union results from rule references are flattened so that passthrough-
 * recursive refs surface as direct union members for findRefInType.
 */
function deriveRuleValueTypeOnce(
    rules: GrammarRule[],
    cache: Map<GrammarRule[], SchemaType>,
): SchemaType {
    const types: SchemaType[] = [];
    for (const rule of rules) {
        const altType = deriveAlternativeType(rule, cache);
        if (altType === ANY_TYPE || isErrorType(altType)) {
            continue; // skip unknowable or error alternatives
        }
        // Flatten unions from nested rule references so passthrough-recursive
        // refs surface as direct union members for findRefInType.
        const alts = altType.type === "type-union" ? altType.types : [altType];
        for (const t of alts) {
            if (!types.some((existing) => schemaTypesEqual(existing, t))) {
                types.push(t);
            }
        }
    }

    if (types.length === 0) {
        return ANY_TYPE;
    } else if (types.length === 1) {
        return types[0];
    } else {
        return SchemaCreator.union(...types);
    }
}

/**
 * Checks whether a type-reference with the given name appears in a type,
 * and if so, whether it's a direct top-level union member or nested deeper.
 */
function findRefInType(
    type: SchemaType,
    refName: string,
): "none" | "top-union" | "nested" {
    if (type.type === "type-reference") {
        return type.name === refName ? "nested" : "none";
    }
    if (type.type === "type-union") {
        let foundAsDirectMember = false;
        for (const member of type.types) {
            if (member.type === "type-reference" && member.name === refName) {
                foundAsDirectMember = true;
            } else if (containsRef(member, refName)) {
                return "nested";
            }
        }
        return foundAsDirectMember ? "top-union" : "none";
    }
    return containsRef(type, refName) ? "nested" : "none";
}

/** Recursively checks whether a type contains a reference with the given name. */
function containsRef(type: SchemaType, refName: string): boolean {
    switch (type.type) {
        case "type-reference":
            return type.name === refName;
        case "type-union":
            return type.types.some((t) => containsRef(t, refName));
        case "array":
            return containsRef(type.elementType, refName);
        case "object":
            return Object.values(type.fields).some((f) =>
                containsRef(f.type, refName),
            );
        default:
            return false;
    }
}

/**
 * Removes type-reference members with the given name from a union type.
 * Returns a simplified type (single type if only one remains, union otherwise).
 */
function stripRefFromUnion(type: SchemaType, refName: string): SchemaType {
    if (type.type !== "type-union") return type;
    const remaining = type.types.filter(
        (t) => !(t.type === "type-reference" && t.name === refName),
    );
    if (remaining.length === 0) return ANY_TYPE;
    if (remaining.length === 1) return remaining[0];
    return SchemaCreator.union(...remaining);
}

/**
 * Classifies how a grammar rule produces its output value.
 * Used by both `deriveAlternativeType` (type inference) and
 * `collectLeafValues` in grammarCompiler.ts (validation collection).
 */
export type RuleValueKind =
    | { kind: "explicit" } // rule.value exists
    | { kind: "variable"; variableName: string; part: GrammarPart } // single-variable implicit
    | { kind: "passthrough"; rules: GrammarRule[]; name?: string | undefined } // bare rule-ref
    | { kind: "default"; part: GrammarPart } // zero-variable single string/phraseSet part → matched text
    | { kind: "none" }; // multi-var or no value

export function classifyRuleValue(rule: GrammarRule): RuleValueKind {
    if (rule.value !== undefined) {
        return { kind: "explicit" };
    }
    const variableParts = rule.parts.filter((p) => p.variable !== undefined);
    if (variableParts.length === 1) {
        return {
            kind: "variable",
            variableName: variableParts[0].variable!,
            part: variableParts[0],
        };
    }
    if (variableParts.length === 0 && rule.parts.length === 1) {
        const part = rule.parts[0];
        if (part.type === "rules") {
            // For dispatched parts, the effective member list spans
            // both the bucket members and `part.rules` (the fallback
            // subset).  `getDispatchEffectiveMembers` returns the
            // union (or just `part.rules` when there is no dispatch).
            // Using it unconditionally keeps downstream logic
            // (`deriveAlternativeType`, `collectLeafValues`) walking
            // the same alternatives it would have walked before
            // `dispatchifyAlternations` ran.
            return {
                kind: "passthrough",
                rules: getDispatchEffectiveMembers(part),
                name: part.name,
            };
        }
        if (part.type === "string" || part.type === "phraseSet") {
            return { kind: "default", part };
        }
    }
    return { kind: "none" };
}

function deriveAlternativeType(
    rule: GrammarRule,
    cache: Map<GrammarRule[], SchemaType>,
): SchemaType {
    const kind = classifyRuleValue(rule);
    switch (kind.kind) {
        case "explicit": {
            const resolveVar: ResolveVariable = (name) => {
                for (const part of rule.parts) {
                    if (part.variable === name) {
                        return derivePartType(part, cache);
                    }
                }
                return undefined;
            };
            return deriveValueType(rule.value!, resolveVar);
        }
        case "variable":
            return derivePartType(kind.part, cache);
        case "passthrough":
            return deriveRuleValueType(kind.rules, cache, kind.name);
        case "default":
            // Single string/phraseSet part produces the matched text at runtime.
            // For string parts, the exact tokens are known — produce a
            // string-union with the literal value so that enum conformance
            // can be checked (strict conformance principle).
            // PhraseSet parts produce an unknown string at runtime.
            if (kind.part.type === "string") {
                return SchemaCreator.string(kind.part.value.join(" "));
            }
            return SchemaCreator.string();
        case "none":
            // Multi-variable implicit rules don't produce a value at
            // runtime (the compiler warns and sets hasValue = false).
            return ANY_TYPE;
    }
}

function derivePartType(
    part: GrammarPart,
    cache: Map<GrammarRule[], SchemaType>,
): SchemaType {
    let baseType: SchemaType;
    switch (part.type) {
        case "wildcard":
            baseType = grammarTypeToSchemaType(part.typeName);
            break;
        case "number":
            baseType = SchemaCreator.number();
            break;
        case "rules":
            // Walk the unified effective member list (covers plain
            // and dispatched RulesParts).
            baseType = deriveRuleValueType(
                getDispatchEffectiveMembers(part),
                cache,
                part.name,
            );
            break;
        case "string":
        case "phraseSet":
            // Reachable in principle when an optimizer-emitted
            // bound StringPart / PhraseSetPart (the factorer mints
            // synthesized `__opt_v_<n>` canonicals on shared first
            // tokens) flows through here.  Today this is dead code
            // at the only call sites: `derivePartType` is invoked
            // from `classifyRuleValue` (kind=variable) and
            // `buildVariableTypeMap`, both used by `grammarCompiler`
            // *before* the optimizer runs.  User-authored `.agr`
            // syntax does not allow binding a StringPart or
            // PhraseSetPart, so at compile time `part.variable` is
            // always undefined for these kinds and the filter
            // `part.variable !== undefined` (or `if (part.variable)`)
            // skips them before the call.
            //
            // Defensive future-proofing: if validation is ever re-run
            // after optimization (e.g. on a deserialized grammar that
            // was optimized at build time), bound StringParts /
            // PhraseSetParts would reach here.  Producing a real
            // SchemaType (string-union for StringPart, plain string
            // for PhraseSetPart) is what callers expect; throwing or
            // returning ANY would silently weaken downstream type
            // checks.
            baseType =
                part.type === "string" && part.value.length > 0
                    ? SchemaCreator.string(part.value.join(" "))
                    : SchemaCreator.string();
            break;
    }
    // Optional captures produce T | undefined at runtime
    if (part.optional) {
        return SchemaCreator.union(baseType, SchemaCreator.undefined_());
    }
    return baseType;
}

/**
 * Callback that resolves a variable name to its type, or returns undefined
 * if the variable is not defined.  Abstracts the difference between
 * compilation (scanning GrammarPart[]) and validation (Map lookup).
 */
type ResolveVariable = (name: string) => SchemaType | undefined;

/**
 * Derives the output SchemaType of a compiled value expression node.
 * The `resolveVar` callback is the only point of variation between
 * compilation and validation contexts.
 *
 * When `typeCache` is provided, results are memoized so that a subsequent
 * validation pass can look up child types without re-traversing the tree.
 */
function deriveValueType(
    value: CompiledValueNode,
    resolveVar: ResolveVariable,
    errors?: ValueTypeError[],
    typeCache?: Map<CompiledValueNode, SchemaType>,
): SchemaType {
    if (typeCache !== undefined) {
        const cached = typeCache.get(value);
        if (cached !== undefined) return cached;
    }
    const result = deriveValueTypeImpl(value, resolveVar, errors, typeCache);
    if (typeCache !== undefined) {
        typeCache.set(value, result);
    }
    return result;
}

/**
 * Pass 1 — Type inference.
 *
 * Errors here mean "the type cannot be determined" and always return
 * ERROR_TYPE so downstream nodes skip validation (no cascading errors).
 * Examples: undefined variable, missing property, unsupported method.
 *
 * This function must NOT check operator constraints or emit warnings.
 * Those belong in walkExprOperands (pass 2), which runs only after
 * inference succeeds and has access to a warnings channel.
 *
 * The one subtle case is optional chaining on bare `undefined`: the
 * condition is detected here to return the correct type (undefined),
 * but the warning is emitted by walkExprOperands.
 */
function deriveValueTypeImpl(
    value: CompiledValueNode,
    resolveVar: ResolveVariable,
    errors: ValueTypeError[] | undefined,
    typeCache: Map<CompiledValueNode, SchemaType> | undefined,
): SchemaType {
    switch (value.type) {
        case "literal":
            switch (typeof value.value) {
                case "string":
                    // Return string-union to preserve the exact literal
                    // value through type inference.  This is safe:
                    // string-union is assignable to string, so it causes
                    // no false positives for string-typed fields, while
                    // enabling precise enum containment checks whenever
                    // the inferred type flows through spread, ternary,
                    // or rule type derivation.
                    return SchemaCreator.string(value.value);
                case "number":
                    return SchemaCreator.number();
                case "boolean":
                    return value.value
                        ? SchemaCreator.true_()
                        : SchemaCreator.false_();
                default:
                    throw new Error(
                        `Unexpected literal typeof: ${typeof value.value}`,
                    );
            }
        case "variable": {
            const varType = resolveVar(value.name);
            if (varType !== undefined) return varType;
            errors?.push({
                message: `Undefined variable '${value.name}'`,
                node: value,
            });
            return ERROR_TYPE;
        }
        case "object": {
            // Infer field types for the object.
            // If any spread resolves to ERROR_TYPE, the object's shape
            // is indeterminate — propagate ERROR_TYPE to prevent
            // cascading "missing required property" errors.
            const fields: Record<string, SchemaObjectField> = {};
            let hasErrorSpread = false;
            for (const elem of value.value) {
                if (elem.type === "spread") {
                    // Spread: derive argument type and merge its fields
                    const argType = deriveValueType(
                        elem.argument,
                        resolveVar,
                        errors,
                        typeCache,
                    );
                    if (argType.type === "object") {
                        for (const [fk, fv] of Object.entries(argType.fields)) {
                            fields[fk] = fv;
                        }
                    } else if (isErrorType(argType)) {
                        hasErrorSpread = true;
                    } else if (argType.type !== "any") {
                        errors?.push({
                            message: `Spread argument must be an object type, got ${formatSchemaType(argType)}`,
                            node: elem.argument,
                        });
                    }
                } else {
                    let fieldType: SchemaType;
                    if (elem.value === null) {
                        // Shorthand { key } — resolve variable directly instead
                        // of creating a synthetic node (which would lack position
                        // info and bypass the compiler's variable validation).
                        const varType = resolveVar(elem.key);
                        if (varType !== undefined) {
                            fieldType = varType;
                        } else {
                            errors?.push({
                                message: `Undefined variable '${elem.key}'`,
                                node: value,
                            });
                            fieldType = ERROR_TYPE;
                        }
                    } else {
                        fieldType = deriveValueType(
                            elem.value,
                            resolveVar,
                            errors,
                            typeCache,
                        );
                    }
                    fields[elem.key] = { type: fieldType };
                }
            }
            if (hasErrorSpread) return ERROR_TYPE;
            return SchemaCreator.obj(fields);
        }
        case "array": {
            const arrNode = value;
            if (arrNode.value.length === 0) {
                return SchemaCreator.array(ANY_TYPE);
            }
            const elementTypes: SchemaType[] = [];
            for (const elem of arrNode.value) {
                const elemType = deriveValueType(
                    elem,
                    resolveVar,
                    errors,
                    typeCache,
                );
                if (isErrorType(elemType)) {
                    return SchemaCreator.array(ERROR_TYPE);
                }
                if (!elementTypes.some((t) => schemaTypesEqual(t, elemType))) {
                    elementTypes.push(elemType);
                }
            }
            const unified =
                elementTypes.length === 1
                    ? elementTypes[0]
                    : SchemaCreator.union(...elementTypes);
            return SchemaCreator.array(unified);
        }

        // ── Value expression nodes ────────────────────────────────────────
        case "binaryExpression": {
            const leftType = deriveValueType(
                value.left,
                resolveVar,
                errors,
                typeCache,
            );
            const rightType = deriveValueType(
                value.right,
                resolveVar,
                errors,
                typeCache,
            );
            switch (value.operator) {
                case "===":
                case "!==":
                case "<":
                case ">":
                case "<=":
                case ">=":
                    // Operand type constraints checked in pass 2
                    return SchemaCreator.boolean();
                case "-":
                case "*":
                case "/":
                case "%":
                    // Operand type constraints checked in pass 2
                    return SchemaCreator.number();
                case "+":
                    // Operand type constraints checked in pass 2
                    if (isStringType(leftType) && isStringType(rightType)) {
                        return SchemaCreator.string();
                    }
                    if (
                        leftType.type === "number" &&
                        rightType.type === "number"
                    ) {
                        return SchemaCreator.number();
                    }
                    // Can't determine result type — pass 2 will emit the
                    // constraint error for mismatched operands.
                    return ERROR_TYPE;
                case "&&":
                case "||":
                    // Operand type constraints checked in pass 2
                    if (isErrorType(leftType) || isErrorType(rightType))
                        return ERROR_TYPE;
                    return SchemaCreator.boolean();
                case "??": {
                    if (isErrorType(leftType) || isErrorType(rightType))
                        return ERROR_TYPE;
                    const stripped = stripUndefined(leftType);
                    // Left was bare undefined — result is entirely the right type
                    if (stripped.type === "undefined") return rightType;
                    if (schemaTypesEqual(stripped, rightType)) return stripped;
                    return SchemaCreator.union(stripped, rightType);
                }
            }
            throw new Error(
                `Unhandled binary operator: ${(value as any).operator}`,
            );
        }
        case "unaryExpression":
            // Operand type constraints checked in pass 2
            switch (value.operator) {
                case "-":
                    return SchemaCreator.number();
                case "!":
                    return SchemaCreator.boolean();
                case "typeof":
                    return SchemaCreator.string();
            }
            throw new Error(
                `Unhandled unary operator: ${(value as any).operator}`,
            );
        case "conditionalExpression": {
            const consequentType = deriveValueType(
                value.consequent,
                resolveVar,
                errors,
                typeCache,
            );
            const alternateType = deriveValueType(
                value.alternate,
                resolveVar,
                errors,
                typeCache,
            );
            if (isErrorType(consequentType) || isErrorType(alternateType))
                return ERROR_TYPE;
            if (schemaTypesEqual(consequentType, alternateType))
                return consequentType;
            return SchemaCreator.union(consequentType, alternateType);
        }
        case "memberExpression": {
            let objectType = resolveType(
                deriveValueType(value.object, resolveVar, errors, typeCache),
            );
            if (isErrorType(objectType)) return ERROR_TYPE;
            // Optional chaining: strip undefined before lookup, add back after
            const addUndefined =
                value.optional && containsUndefined(objectType);
            if (addUndefined) {
                objectType = resolveType(stripUndefined(objectType));
                // Object is always undefined — access always short-circuits
                if (objectType.type === "undefined") {
                    return SchemaCreator.undefined_();
                }
            }
            let resultType: SchemaType | undefined;
            if (
                objectType.type === "object" &&
                !value.computed &&
                typeof value.property === "string"
            ) {
                const field = objectType.fields[value.property];
                if (field !== undefined) {
                    resultType = field.type;
                } else {
                    const available = Object.keys(objectType.fields).join(", ");
                    errors?.push({
                        message:
                            `Property '${value.property}' does not exist on type ` +
                            `'${formatSchemaType(objectType)}'.` +
                            `${available.length > 0 ? ` Available properties: ${available}.` : ""}`,
                        node: value,
                    });
                    return ERROR_TYPE;
                }
            }
            if (
                resultType === undefined &&
                typeof value.property === "string"
            ) {
                if (
                    value.property === "length" &&
                    (isStringType(objectType) || objectType.type === "array")
                ) {
                    resultType = SchemaCreator.number();
                }
            }
            // Computed access with literal number on array → element type
            if (
                resultType === undefined &&
                value.computed &&
                objectType.type === "array" &&
                typeof value.property === "number"
            ) {
                resultType = objectType.elementType;
            }
            if (resultType !== undefined) {
                return addUndefined
                    ? SchemaCreator.union(
                          resultType,
                          SchemaCreator.undefined_(),
                      )
                    : resultType;
            }
            if (value.computed) {
                errors?.push({
                    message: `Computed access ([n]) is only supported on arrays. Use property access (.prop) for object properties.`,
                    node: value,
                });
            } else if (typeof value.property === "string") {
                const supported = supportedMethodsForType(objectType.type);
                errors?.push({
                    message:
                        `Property '${value.property}' does not exist on type ` +
                        `'${formatSchemaType(objectType)}'.` +
                        `${supported.length > 0 ? ` Available methods: ${supported.join(", ")}.` : ""}`,
                    node: value,
                });
            }
            return ERROR_TYPE;
        }
        case "callExpression": {
            if (
                value.callee.type !== "memberExpression" ||
                value.callee.computed
            ) {
                errors?.push({
                    message: `Free function calls are not supported. Use method syntax (value.method()) instead.`,
                    node: value,
                });
                return ERROR_TYPE;
            }
            if (typeof value.callee.property === "string") {
                let objectType = resolveType(
                    deriveValueType(
                        value.callee.object,
                        resolveVar,
                        errors,
                        typeCache,
                    ),
                );
                if (isErrorType(objectType)) return ERROR_TYPE;
                // Optional chaining on callee: strip undefined before
                // method lookup, add back to result after.
                const addUndefined =
                    value.callee.optional && containsUndefined(objectType);
                if (addUndefined) {
                    objectType = resolveType(stripUndefined(objectType));
                    if (objectType.type === "undefined") {
                        return SchemaCreator.undefined_();
                    }
                }
                const method = value.callee.property;
                const wrapResult = (t: SchemaType): SchemaType =>
                    addUndefined
                        ? SchemaCreator.union(t, SchemaCreator.undefined_())
                        : t;
                if (isStringType(objectType)) {
                    if (STRING_TO_STRING_METHODS.has(method))
                        return wrapResult(SchemaCreator.string());
                    if (STRING_TO_NUMBER_METHODS.has(method))
                        return wrapResult(SchemaCreator.number());
                    if (STRING_TO_BOOLEAN_METHODS.has(method))
                        return wrapResult(SchemaCreator.boolean());
                    if (STRING_TO_ARRAY_METHODS.has(method))
                        return wrapResult(
                            SchemaCreator.array(SchemaCreator.string()),
                        );
                }
                if (objectType.type === "array") {
                    if (ARRAY_TO_STRING_METHODS.has(method))
                        return wrapResult(SchemaCreator.string());
                    if (ARRAY_TO_BOOLEAN_METHODS.has(method))
                        return wrapResult(SchemaCreator.boolean());
                    if (ARRAY_TO_NUMBER_METHODS.has(method))
                        return wrapResult(SchemaCreator.number());
                    if (ARRAY_TO_ARRAY_METHODS.has(method))
                        return wrapResult(
                            SchemaCreator.array(objectType.elementType),
                        );
                }
                if (objectType.type === "number") {
                    if (NUMBER_TO_STRING_METHODS.has(method))
                        return wrapResult(SchemaCreator.string());
                }
                const supported = supportedMethodsForType(objectType.type);
                errors?.push({
                    message:
                        `Method '${method}' is not supported on type ` +
                        `'${formatSchemaType(objectType)}'.` +
                        `${supported.length > 0 ? ` Supported methods: ${supported.join(", ")}.` : ""}`,
                    node: value,
                });
                return ERROR_TYPE;
            }
            return ERROR_TYPE;
        }
        case "spreadElement":
            return deriveValueType(
                value.argument,
                resolveVar,
                errors,
                typeCache,
            );
        case "templateLiteral":
            return SchemaCreator.string();
    }
}

/** Convert a grammar type name to a SchemaType */
function grammarTypeToSchemaType(grammarType: string): SchemaType {
    switch (grammarType) {
        case "string":
        case "wildcard":
        case "word":
            return SchemaCreator.string();
        case "number":
        // TODO: look up entity return types from the entity registry instead of hard-coding
        case "Cardinal":
        case "Ordinal":
            return SchemaCreator.number();
        default:
            // Custom entity types (e.g. "email", "date") capture text
            return SchemaCreator.string();
    }
}

/**
 * Checks if an inferred type is assignable to an expected type.
 * Uses coinductive reasoning for recursive types: if a type-reference is
 * encountered a second time during the walk, we assume it is assignable
 * (the concrete, non-self-referencing members determine the real answer).
 *
 * This makes validation independent of whether a rule's type was resolved
 * via fixed-point iteration (producing a plain type like `string`) or via
 * the type-reference approach (producing `A = string | A`).  Both
 * representations validate identically.
 *
 * Design principle — STRICT CONFORMANCE:
 * The purpose of type checking is to ensure that values produced by the
 * grammar conform to the types declared in the schema.  Assignability
 * must therefore be SOUND: if `isTypeAssignable(A, B)` returns true, then
 * every possible runtime value of type A must be a valid value of type B.
 *
 * Widening directions that are SOUND (kept):
 *   - `string-union` → `string`  (every enum member IS a string)
 *   - `true` / `false` → `boolean` (every literal IS a boolean)
 *
 * Widening directions that are UNSOUND (rejected):
 *   - `string` → `string-union`  (a bare string could produce values
 *     outside the declared enum — the grammar must use a sub-rule or
 *     literal that produces one of the declared enum values)
 *   - `boolean` → `true` / `false`  (a bare boolean capture could
 *     produce the wrong literal — the grammar must use a literal `true`
 *     or `false` value, or an expression that infers the exact literal)
 *
 * NOTE: This is a shallow type-discriminant check.  For object and array
 * types it only verifies that both sides share the same discriminant
 * ("object" or "array") — it does NOT compare fields or element types.
 * Structural validation for objects lives in `validateInferredObjectType`
 * / `validateInferredAgainstExpected`, which produce per-field error
 * messages.  Callers that need structural depth must use those functions
 * instead of relying solely on this one.
 */
function isTypeAssignable(
    inferred: SchemaType,
    expected: SchemaType,
    visited: Set<string> = new Set(),
): boolean {
    if (expected.type === "any" || inferred.type === "any") return true;
    // Coinductive cycle detection for recursive type-references.
    // If we've already started checking this ref, assume assignable —
    // the concrete (non-self-referencing) union members determine the
    // real answer.  Guards both sides symmetrically so that recursive
    // expected types (e.g. A = string | A) also terminate.
    if (inferred.type === "type-reference") {
        if (visited.has(inferred.name)) return true;
        visited.add(inferred.name);
    }
    if (expected.type === "type-reference") {
        if (visited.has(expected.name)) return true;
        visited.add(expected.name);
    }
    const resolvedInferred = resolveType(inferred);
    const resolvedExpected = resolveType(expected);
    if (resolvedExpected.type === "any" || resolvedInferred.type === "any")
        return true;
    if (resolvedExpected.type === resolvedInferred.type) {
        // For string-union, check enum value containment
        if (
            resolvedExpected.type === "string-union" &&
            resolvedInferred.type === "string-union"
        ) {
            return resolvedInferred.typeEnum.every((v) =>
                resolvedExpected.typeEnum.includes(v),
            );
        }
        return true;
    }
    // string-union is assignable to string (every enum value is a string)
    if (
        resolvedExpected.type === "string" &&
        resolvedInferred.type === "string-union"
    )
        return true;
    // true/false literal types are assignable to boolean
    if (
        resolvedExpected.type === "boolean" &&
        (resolvedInferred.type === "true" || resolvedInferred.type === "false")
    )
        return true;
    // If expected is a union, inferred must match SOME member
    if (resolvedExpected.type === "type-union") {
        return resolvedExpected.types.some((t) =>
            isTypeAssignable(resolvedInferred, t, visited),
        );
    }
    // If inferred is a union, ALL members must be assignable to expected.
    // Pass the original `expected` (not resolved) so union checks on the
    // expected side still fire for each member.
    if (resolvedInferred.type === "type-union") {
        return resolvedInferred.types.every((t) =>
            isTypeAssignable(t, expected, visited),
        );
    }
    return false;
}

/**
 * Structural equality check for SchemaType values.
 * Handles primitives, string unions, arrays, objects, and type references.
 * Uses coinductive equality for recursive types: if we encounter a pair of
 * type-references we're already comparing, we assume they're equal
 * (standard coinductive approach, same as TypeScript's type checker).
 */
function schemaTypesEqual(
    a: SchemaType,
    b: SchemaType,
    visited?: Set<string>,
): boolean {
    if (a === b) return true;
    if (a.type !== b.type) return false;
    switch (a.type) {
        case "string":
        case "number":
        case "boolean":
        case "any":
        case "undefined":
        case "true":
        case "false":
            return true;
        case "string-union": {
            const bEnum = (b as typeof a).typeEnum;
            return (
                a.typeEnum.length === bEnum.length &&
                a.typeEnum.every((v) => bEnum.includes(v))
            );
        }
        case "type-reference": {
            const bRef = b as typeof a;
            if (a.definition !== undefined && bRef.definition !== undefined) {
                // Coinductive cycle check: if we've already assumed this
                // pair is equal, return true to break the cycle.
                const key = a.name + "==" + bRef.name;
                if (visited === undefined) {
                    visited = new Set<string>();
                }
                if (visited.has(key)) return true;
                visited.add(key);
                return schemaTypesEqual(
                    a.definition.type,
                    bRef.definition.type,
                    visited,
                );
            }
            // Fall back to name comparison when definitions aren't resolved
            return a.name === bRef.name;
        }
        case "array":
            return schemaTypesEqual(
                a.elementType,
                (b as typeof a).elementType,
                visited,
            );
        case "object": {
            const aKeys = Object.keys(a.fields);
            const bFields = (b as typeof a).fields;
            const bKeys = Object.keys(bFields);
            if (aKeys.length !== bKeys.length) return false;
            return aKeys.every((key) => {
                const bf = bFields[key];
                if (bf === undefined) return false;
                const af = a.fields[key];
                return (
                    !!af.optional === !!bf.optional &&
                    schemaTypesEqual(af.type, bf.type, visited)
                );
            });
        }
        case "type-union": {
            const bTypes = (b as typeof a).types;
            return (
                a.types.length === bTypes.length &&
                a.types.every((t) =>
                    bTypes.some((bt) => schemaTypesEqual(t, bt, visited)),
                )
            );
        }
        default:
            return false;
    }
}

/**
 * Builds a map from variable name to its inferred SchemaType from the grammar
 * rule parts. For primitive captures (wildcard, number), returns simple schema
 * For rule-reference variables, derives the output type of the referenced
 * rule recursively.
 */
export function buildVariableTypeMap(
    parts: GrammarPart[],
    derivedTypes: Map<GrammarRule[], SchemaType>,
): Map<string, SchemaType> {
    const map = new Map<string, SchemaType>();
    for (const part of parts) {
        if (part.variable) {
            map.set(part.variable, derivePartType(part, derivedTypes));
        }
    }
    return map;
}

/**
 * Resolves a SchemaType, following type-references to their definition.
 * Uses Floyd's tortoise-and-hare cycle detection — O(1) space, no
 * allocation, no arbitrary depth limit.
 *
 * Invariant: `slow` is always behind `fast` on the same reference chain.
 * If `fast` hasn't reached a non-reference (i.e. the while-loop is still
 * running), every node behind it — including `slow` — must also be a
 * type-reference with a definition.
 */
function resolveType(type: SchemaType): SchemaType {
    let slow: SchemaType = type;
    let fast: SchemaType = type;
    while (fast.type === "type-reference" && fast.definition !== undefined) {
        // Advance fast two steps.
        fast = fast.definition.type;
        if (fast.type === "type-reference" && fast.definition !== undefined) {
            fast = fast.definition.type;
        } else {
            return fast;
        }
        // Advance slow one step.  Safe: slow is behind fast on the same
        // reference chain, so it must still be a resolvable type-reference.
        slow = (slow as SchemaTypeReference).definition!.type;
        if (slow === fast) {
            // Cycle detected — the type-reference itself is the resolved form
            return type;
        }
    }
    return fast;
}

// ── Operator constraint set ───────────────────────────────────────────────────
// Operators that accept `T | undefined` operands without error.
// ("nullable" here means may-be-undefined, not may-be-null — the grammar
// type system uses `undefined` from optional captures, never `null`.)
const UNDEFINED_TOLERANT_OPERATORS = new Set<string>([
    "??",
    "===",
    "!==",
    "typeof",
]);

/**
 * Walk an expression tree and check that each operator's operands satisfy the
 * type restrictions in the Expression Type Restriction Table.
 *
 * Returns errors (fatal constraint violations) and populates an optional
 * `warnings` array (non-fatal, e.g. unnecessary `??` or `?.`).
 *
 * Check ordering per node:
 *   1. If operand is ERROR_TYPE → skip (prevents cascading)
 *   2. If operand contains undefined and operator is not nullable → error
 *   3. Otherwise → check operator-specific type constraint
 */
function validateExprOperandTypes(
    value: CompiledValueNode,
    resolveVar: ResolveVariable,
    warnings?: ValueTypeError[],
    typeCache?: Map<CompiledValueNode, SchemaType>,
): ValueTypeError[] {
    const errors: ValueTypeError[] = [];
    walkExprOperands(value, resolveVar, errors, warnings, typeCache);
    return errors;
}

/**
 * Pass 2 — Operator constraints and warnings.
 *
 * Runs only after deriveValueType (pass 1) succeeds with no errors.
 * Reads inferred types from `typeCache` without re-deriving them.
 *
 * Errors here mean "types are known but misused" — wrong operand types
 * for an operator, undefined flowing into a non-nullable operator, etc.
 *
 * Warnings mean "it works, but it's suspicious" — unnecessary `??`,
 * unnecessary `?.`, or `?.` on bare `undefined`.
 *
 * Do NOT add inference-failure errors here; those belong in
 * deriveValueTypeImpl where they can return ERROR_TYPE.
 */
function walkExprOperands(
    value: CompiledValueNode,
    resolveVar: ResolveVariable,
    errors: ValueTypeError[],
    warnings: ValueTypeError[] | undefined,
    typeCache: Map<CompiledValueNode, SchemaType> | undefined,
): void {
    switch (value.type) {
        case "binaryExpression": {
            // Recurse into operands first
            walkExprOperands(
                value.left,
                resolveVar,
                errors,
                warnings,
                typeCache,
            );
            walkExprOperands(
                value.right,
                resolveVar,
                errors,
                warnings,
                typeCache,
            );

            const leftType = deriveValueType(
                value.left,
                resolveVar,
                undefined,
                typeCache,
            );
            const rightType = deriveValueType(
                value.right,
                resolveVar,
                undefined,
                typeCache,
            );

            // 1. ERROR_TYPE → skip
            if (isErrorType(leftType) || isErrorType(rightType)) return;

            // 2. undefined check for non-undefined-tolerant operators
            if (!UNDEFINED_TOLERANT_OPERATORS.has(value.operator)) {
                if (containsUndefined(leftType)) {
                    errors.push({
                        message:
                            `Operand type '${formatSchemaType(leftType)}' includes undefined. ` +
                            `Use ?? to provide a default value, or ?. for property access.`,
                        node: value.left,
                    });
                    return;
                }
                if (containsUndefined(rightType)) {
                    errors.push({
                        message:
                            `Operand type '${formatSchemaType(rightType)}' includes undefined. ` +
                            `Use ?? to provide a default value, or ?. for property access.`,
                        node: value.right,
                    });
                    return;
                }
            }

            // 3. Operator-specific constraints
            switch (value.operator) {
                case "+":
                    if (
                        !(
                            (isStringType(leftType) &&
                                isStringType(rightType)) ||
                            (leftType.type === "number" &&
                                rightType.type === "number")
                        )
                    ) {
                        errors.push({
                            message:
                                `Operator '+' requires both operands to be number or both to be string. ` +
                                `Got '${formatSchemaType(leftType)}' and '${formatSchemaType(rightType)}'. ` +
                                `Use a template literal for string interpolation.`,
                            node: value,
                        });
                    }
                    break;
                case "-":
                case "*":
                case "/":
                case "%":
                    if (
                        leftType.type !== "number" ||
                        rightType.type !== "number"
                    ) {
                        errors.push({
                            message:
                                `Operator '${value.operator}' requires both operands to be number. ` +
                                `Got '${formatSchemaType(leftType)}' and '${formatSchemaType(rightType)}'.`,
                            node: value,
                        });
                    }
                    break;
                case "<":
                case ">":
                case "<=":
                case ">=":
                    if (
                        !(
                            (leftType.type === "number" &&
                                rightType.type === "number") ||
                            (isStringType(leftType) && isStringType(rightType))
                        )
                    ) {
                        errors.push({
                            message:
                                `Operator '${value.operator}' requires both operands to be the same type ` +
                                `(both number or both string). ` +
                                `Got '${formatSchemaType(leftType)}' and '${formatSchemaType(rightType)}'.`,
                            node: value,
                        });
                    }
                    break;
                case "&&":
                case "||":
                    if (!isBooleanType(leftType) || !isBooleanType(rightType)) {
                        errors.push({
                            message:
                                `Operator '${value.operator}' requires boolean operands. ` +
                                `Got '${formatSchemaType(leftType)}' and '${formatSchemaType(rightType)}'. ` +
                                `Use ternary (e.g., x > 0 ? a : b) for conditional values.`,
                            node: value,
                        });
                    }
                    break;
                case "??":
                    // Warning: unnecessary ?? if left does not contain undefined
                    if (!containsUndefined(leftType)) {
                        warnings?.push({
                            message:
                                `Operator '??' is unnecessary — left operand ` +
                                `'${formatSchemaType(leftType)}' is never undefined.`,
                            node: value,
                        });
                    }
                    break;
                // ===, !== have no constraint
            }
            break;
        }
        case "unaryExpression": {
            walkExprOperands(
                value.operand,
                resolveVar,
                errors,
                warnings,
                typeCache,
            );
            const operandType = deriveValueType(
                value.operand,
                resolveVar,
                undefined,
                typeCache,
            );
            if (isErrorType(operandType)) return;
            if (
                !UNDEFINED_TOLERANT_OPERATORS.has(value.operator) &&
                containsUndefined(operandType)
            ) {
                errors.push({
                    message:
                        `Operand type '${formatSchemaType(operandType)}' includes undefined. ` +
                        `Use ?? to provide a default value.`,
                    node: value.operand,
                });
                return;
            }
            switch (value.operator) {
                case "-":
                    if (operandType.type !== "number") {
                        errors.push({
                            message: `Unary '-' requires a number operand. Got '${formatSchemaType(operandType)}'.`,
                            node: value,
                        });
                    }
                    break;
                case "!":
                    if (!isBooleanType(operandType)) {
                        errors.push({
                            message:
                                `Operator '!' requires a boolean operand. ` +
                                `Got '${formatSchemaType(operandType)}'. ` +
                                `Use === or !== for equality checks.`,
                            node: value,
                        });
                    }
                    break;
                // typeof has no constraint
            }
            break;
        }
        case "conditionalExpression": {
            walkExprOperands(
                value.test,
                resolveVar,
                errors,
                warnings,
                typeCache,
            );
            walkExprOperands(
                value.consequent,
                resolveVar,
                errors,
                warnings,
                typeCache,
            );
            walkExprOperands(
                value.alternate,
                resolveVar,
                errors,
                warnings,
                typeCache,
            );
            const testType = deriveValueType(
                value.test,
                resolveVar,
                undefined,
                typeCache,
            );
            if (isErrorType(testType)) return;
            if (!isBooleanType(testType)) {
                errors.push({
                    message:
                        `Ternary '?' test must be a boolean expression. ` +
                        `Got '${formatSchemaType(testType)}'. ` +
                        `Use a comparison (e.g., x > 0) or equality check (e.g., x !== undefined).`,
                    node: value.test,
                });
            }
            break;
        }
        case "memberExpression": {
            if (typeof value.object === "object") {
                walkExprOperands(
                    value.object,
                    resolveVar,
                    errors,
                    warnings,
                    typeCache,
                );
            }
            if (typeof value.property === "object" && value.property !== null) {
                walkExprOperands(
                    value.property,
                    resolveVar,
                    errors,
                    warnings,
                    typeCache,
                );
            }
            // Warnings for optional chaining
            if (value.optional) {
                const objectType = deriveValueType(
                    value.object,
                    resolveVar,
                    undefined,
                    typeCache,
                );
                if (!isErrorType(objectType)) {
                    if (!containsUndefined(objectType)) {
                        warnings?.push({
                            message:
                                `Optional chaining '?.' is unnecessary — operand ` +
                                `'${formatSchemaType(objectType)}' is never undefined. Use '.' instead.`,
                            node: value,
                        });
                    } else if (
                        resolveType(stripUndefined(objectType)).type ===
                        "undefined"
                    ) {
                        warnings?.push({
                            message: `Optional chaining on type 'undefined' will always produce undefined.`,
                            node: value,
                        });
                    }
                }
            }
            // Validate computed property type (must be number for array indexing)
            if (value.computed && typeof value.property === "object") {
                const propType = deriveValueType(
                    value.property,
                    resolveVar,
                    undefined,
                    typeCache,
                );
                if (!isErrorType(propType) && propType.type !== "number") {
                    errors.push({
                        message: `Computed property key must be number. Got '${formatSchemaType(propType)}'.`,
                        node: value.property,
                    });
                }
            }
            break;
        }
        case "callExpression": {
            walkExprOperands(
                value.callee,
                resolveVar,
                errors,
                warnings,
                typeCache,
            );
            for (const arg of value.arguments) {
                walkExprOperands(arg, resolveVar, errors, warnings, typeCache);
            }
            // Validate argument types against method signatures
            if (
                value.callee.type === "memberExpression" &&
                !value.callee.computed &&
                typeof value.callee.property === "string"
            ) {
                const objectType = deriveValueType(
                    value.callee.object,
                    resolveVar,
                    undefined,
                    typeCache,
                );
                if (!isErrorType(objectType)) {
                    const typeName = isStringType(objectType)
                        ? "string"
                        : objectType.type;
                    const key = `${typeName}.${value.callee.property}`;
                    const expectedArgs = METHOD_ARG_TYPES[key];
                    if (expectedArgs !== undefined) {
                        for (
                            let i = 0;
                            i < value.arguments.length &&
                            i < expectedArgs.length;
                            i++
                        ) {
                            const expected = expectedArgs[i];
                            if (expected === undefined) continue;
                            const argType = deriveValueType(
                                value.arguments[i],
                                resolveVar,
                                undefined,
                                typeCache,
                            );
                            if (isErrorType(argType)) continue;
                            if (
                                expected === "string"
                                    ? !isStringType(argType)
                                    : argType.type !== expected
                            ) {
                                errors.push({
                                    message:
                                        `Argument ${i + 1} of '${value.callee.property}' ` +
                                        `expects ${expected}, got '${formatSchemaType(argType)}'.`,
                                    node: value.arguments[i],
                                });
                            }
                        }
                    }
                }
            }
            break;
        }
        case "templateLiteral": {
            for (const expr of value.expressions) {
                walkExprOperands(expr, resolveVar, errors, warnings, typeCache);
                const exprType = deriveValueType(
                    expr,
                    resolveVar,
                    undefined,
                    typeCache,
                );
                if (isErrorType(exprType)) continue;
                // Check that all types in the expression are interpolatable
                const types =
                    exprType.type === "type-union"
                        ? exprType.types
                        : [exprType];
                for (const t of types) {
                    if (
                        !isStringType(t) &&
                        t.type !== "number" &&
                        !isBooleanType(t)
                    ) {
                        errors.push({
                            message:
                                `Template interpolation does not accept ` +
                                `'${formatSchemaType(exprType)}'. Use ?? to provide a default first.`,
                            node: expr,
                        });
                        break;
                    }
                }
            }
            break;
        }
        case "spreadElement":
            walkExprOperands(
                value.argument,
                resolveVar,
                errors,
                warnings,
                typeCache,
            );
            break;
        case "object":
            for (const elem of value.value) {
                if (elem.type === "spread") {
                    walkExprOperands(
                        elem.argument,
                        resolveVar,
                        errors,
                        warnings,
                        typeCache,
                    );
                } else if (elem.value !== null) {
                    walkExprOperands(
                        elem.value,
                        resolveVar,
                        errors,
                        warnings,
                        typeCache,
                    );
                }
            }
            break;
        case "array":
            for (const elem of (value as CompiledArrayValueNode).value) {
                walkExprOperands(elem, resolveVar, errors, warnings, typeCache);
            }
            break;
        // literal, variable: no sub-expressions to check
    }
}

/**
 * Result of expression-internal type validation.
 * @property errors - Inference or operator-constraint errors (empty if valid).
 * @property inferredType - The inferred result type, or undefined when the
 *   value is not an expression node or the type could not be determined.
 */
export type ExprValidationResult = {
    errors: string[];
    warnings: string[];
    inferredType: SchemaType | undefined;
};

/**
 * Validates expression-internal type consistency: infers the result type,
 * checks for unknown variables/properties/methods, and enforces operator
 * constraints.  Does NOT check conformance against a declared output type.
 *
 * This pass runs independently of whether a schema loader is available —
 * it only needs the variable types derived from grammar parts.
 */
export function validateExprTypes(
    value: CompiledValueNode,
    variableTypes: Map<string, SchemaType>,
): ExprValidationResult {
    const resolveVar: ResolveVariable = (name) => variableTypes.get(name);
    const typeCache = new Map<CompiledValueNode, SchemaType>();

    // Pass 1: Infer the result type only for expression-typed nodes.
    const inferenceErrors: ValueTypeError[] = [];
    let exprType: SchemaType | undefined;
    if (isValueExprNode(value)) {
        exprType = deriveValueType(
            value,
            resolveVar,
            inferenceErrors,
            typeCache,
        );
    }

    // Pass 2: Walk sub-expressions for operator constraints and warnings.
    // This recurses into object/array property values so expressions
    // nested inside object literals are validated too.
    // Always runs even after inference errors — ERROR_TYPE guards in
    // walkExprOperands prevent cascading, and the typeCache has valid
    // entries for sub-expressions that inferred successfully, so
    // warnings (e.g. unnecessary ?.) on those nodes are still collected.
    const exprWarnings: ValueTypeError[] = [];
    const operandErrors = validateExprOperandTypes(
        value,
        resolveVar,
        exprWarnings,
        typeCache,
    );

    const errors = [
        ...inferenceErrors.map((e) => e.message),
        ...operandErrors.map((e) => e.message),
    ];
    return {
        errors,
        warnings: exprWarnings.map((e) => e.message),
        inferredType:
            errors.length === 0 &&
            exprType !== undefined &&
            !isErrorType(exprType) &&
            exprType !== ANY_TYPE
                ? exprType
                : undefined,
    };
}

/**
 * Validates that a variable's inferred type is assignable to the expected type.
 * Used by the compiler for single-variable implicit rules where no value node
 * exists — the variable's capture type is checked directly.
 */
export function validateVariableType(
    variableName: string,
    variableType: SchemaType,
    expectedType: SchemaType,
): string[] {
    if (variableType === ANY_TYPE) return [];
    const resolved = resolveType(expectedType);
    if (resolved.type === "any") return [];
    // Use structural validation so object fields and array element types
    // are checked, not just the type discriminant.
    const errors = validateInferredAgainstExpected(variableType, resolved, "");
    if (errors.length === 0) return errors;
    // Prefix with variable context so the error identifies which variable failed.
    // Top-level errors start with "Value " — replace with the variable name.
    // Nested errors ("Field '...'", "Missing ...") get the variable as context.
    return errors.map((e) =>
        e.startsWith("Value ")
            ? `Variable '$${variableName}' ${e.slice(6)}`
            : `Variable '$${variableName}': ${e}`,
    );
}

/**
 * Validates a CompiledValueNode against a SchemaType at compile time.
 * Returns an array of error messages (empty if valid).
 *
 * Expression-internal consistency (inference errors, operator constraints)
 * must be checked separately via `validateExprTypes` before calling this.
 * For expression nodes, pass the inferred type from that pass.
 *
 * @param value - The compiled value node from a grammar rule's -> expression
 * @param expectedType - The expected schema type from the declared value type
 * @param variableTypes - Map from variable name to its captured type name
 * @param path - Current property path for error messages
 * @param inferredExprType - Pre-computed expression type from validateExprTypes
 */
export function validateValueType(
    value: CompiledValueNode,
    expectedType: SchemaType,
    variableTypes: Map<string, SchemaType>,
    path: string = "",
    inferredExprType?: SchemaType,
): string[] {
    // For expression nodes, check conformance of the inferred type against
    // the declared expected type.  If called from the compiler's pass 1,
    // inferredExprType is pre-computed.  For recursive calls from structural
    // validation (object fields, array elements), derive on the fly.
    if (isValueExprNode(value)) {
        let exprType = inferredExprType;
        if (exprType === undefined) {
            const result = validateExprTypes(value, variableTypes);
            if (result.errors.length > 0) return result.errors;
            exprType = result.inferredType;
        }
        if (exprType === undefined) return [];
        const resolved = resolveType(expectedType);
        if (resolved.type === "any") return [];
        // Use structural validation so array element types and object
        // fields are checked, not just the type discriminant.
        return validateInferredAgainstExpected(exprType, resolved, path);
    }

    const resolved = resolveType(expectedType);

    switch (resolved.type) {
        case "any":
            return [];

        case "type-union": {
            // Value must match at least one union member
            const allErrors: string[][] = [];
            for (const memberType of resolved.types) {
                const errors = validateValueType(
                    value,
                    memberType,
                    variableTypes,
                    path,
                );
                if (errors.length === 0) {
                    return []; // Matches this member
                }
                allErrors.push(errors);
            }
            return [`${fieldName(path)} does not match any union type member`];
        }

        case "object":
            return validateObjectValue(value, resolved, variableTypes, path);

        case "array":
            return validateArrayValue(
                value,
                resolved.elementType,
                variableTypes,
                path,
            );

        case "string":
            return validatePrimitiveValue(value, "string", variableTypes, path);

        case "number":
            return validatePrimitiveValue(value, "number", variableTypes, path);

        case "boolean":
            return validatePrimitiveValue(
                value,
                "boolean",
                variableTypes,
                path,
            );

        case "true":
            return validateLiteralBooleanValue(
                value,
                true,
                variableTypes,
                path,
            );

        case "false":
            return validateLiteralBooleanValue(
                value,
                false,
                variableTypes,
                path,
            );

        case "string-union":
            return validateStringUnionValue(
                value,
                resolved.typeEnum,
                variableTypes,
                path,
            );

        case "type-reference":
            // Unresolved reference — can't validate
            return [];

        case "undefined":
            return [];

        default:
            return [];
    }
}

function fieldName(path: string): string {
    return path === "" ? "Value" : `Field '${path}'`;
}

function fullPath(base: string, field: string): string {
    return base === "" ? field : `${base}.${field}`;
}

function validateObjectValue(
    value: CompiledValueNode,
    expected: SchemaTypeObject,
    variableTypes: Map<string, SchemaType>,
    path: string,
): string[] {
    if (value.type === "variable") {
        // Variable producing an object — check if its type is compatible
        return validateVariableAgainstSchema(
            value.name,
            variableTypes,
            expected,
            path,
        );
    }

    // Derive the type of the whole object expression.
    // deriveValueType processes elements in source order (last-write-wins),
    // correctly handling spread override semantics.
    // Collect inference errors to surface spread-of-non-object diagnostics
    // that aren't caught by the expression validation pass (object literals
    // aren't expression nodes).
    const resolveVar = (name: string) => variableTypes.get(name);
    const inferErrors: ValueTypeError[] = [];
    const inferred = deriveValueType(value, resolveVar, inferErrors);

    const errors = inferErrors.map((e) => e.message);
    if (isErrorType(inferred)) {
        // Primary error already reported — skip structural validation
        // to avoid cascading "missing required property" noise.
    } else if (inferred.type === "object") {
        errors.push(...validateInferredObjectType(inferred, expected, path));
    } else {
        errors.push(
            `${fieldName(path)} expected an object, but inferred type is ${formatSchemaType(inferred)}`,
        );
    }
    return errors;
}

/**
 * Structurally compare an inferred object type against an expected schema
 * object type, producing per-field error messages for missing required
 * properties, extraneous properties, and type mismatches.
 */
function validateInferredObjectType(
    inferred: SchemaTypeObject,
    expected: SchemaTypeObject,
    path: string,
): string[] {
    const errors: string[] = [];

    // Check required fields exist and types match.
    for (const [fieldKey, fieldInfo] of Object.entries(expected.fields) as [
        string,
        SchemaObjectField,
    ][]) {
        const propPath = fullPath(path, fieldKey);
        if (!(fieldKey in inferred.fields)) {
            if (!fieldInfo.optional) {
                errors.push(`Missing required property '${propPath}'`);
            }
            continue;
        }

        const inferredFieldType = inferred.fields[fieldKey].type;
        const expectedFieldType = fieldInfo.optional
            ? SchemaCreator.union(fieldInfo.type, SchemaCreator.undefined_())
            : fieldInfo.type;

        errors.push(
            ...validateInferredAgainstExpected(
                inferredFieldType,
                expectedFieldType,
                propPath,
            ),
        );
    }

    // Check for extraneous properties.
    // Note: any-typed spreads contribute no fields to the inferred type,
    // so they don't cause false positives in this check. However, they
    // *may* supply required fields at runtime, so required-field checks
    // above can produce false positives when the spread argument has
    // type `any`.
    for (const actualKey of Object.keys(inferred.fields)) {
        if (!(actualKey in expected.fields)) {
            errors.push(`Extraneous property '${fullPath(path, actualKey)}'`);
        }
    }

    return errors;
}

/**
 * Validate an inferred type against an expected type, producing detailed
 * error messages. Recursively validates nested object structure and uses
 * {@link isTypeAssignable} for leaf types.
 */
function validateInferredAgainstExpected(
    inferred: SchemaType,
    expected: SchemaType,
    path: string,
): string[] {
    const resolvedExpected = resolveType(expected);
    const resolvedInferred = resolveType(inferred);

    if (resolvedExpected.type === "any" || resolvedInferred.type === "any") {
        return [];
    }

    // Recurse into nested objects for structural validation.
    if (
        resolvedExpected.type === "object" &&
        resolvedInferred.type === "object"
    ) {
        return validateInferredObjectType(
            resolvedInferred,
            resolvedExpected,
            path,
        );
    }

    // Recurse into arrays for element-type validation.
    if (
        resolvedExpected.type === "array" &&
        resolvedInferred.type === "array"
    ) {
        return validateInferredAgainstExpected(
            resolvedInferred.elementType,
            resolvedExpected.elementType,
            path ? `${path}[]` : "[]",
        );
    }

    // If inferred is a type-union (e.g. T | undefined from optional
    // captures), distribute: each member must individually match the
    // expected type.  This ensures T matches some expected member and
    // undefined matches the undefined member.
    if (resolvedInferred.type === "type-union") {
        for (const memberType of resolvedInferred.types) {
            const memberErrors = validateInferredAgainstExpected(
                memberType,
                expected,
                path,
            );
            if (memberErrors.length > 0) {
                return memberErrors;
            }
        }
        return [];
    }

    // Union: inferred must match at least one member.
    if (resolvedExpected.type === "type-union") {
        for (const memberType of resolvedExpected.types) {
            if (
                validateInferredAgainstExpected(
                    resolvedInferred,
                    memberType,
                    path,
                ).length === 0
            ) {
                return [];
            }
        }
        return [`${fieldName(path)} does not match any union type member`];
    }

    // String-union vs string-union: produce specific error with actual values.
    if (
        resolvedExpected.type === "string-union" &&
        resolvedInferred.type === "string-union"
    ) {
        const invalid = resolvedInferred.typeEnum.filter(
            (v) => !resolvedExpected.typeEnum.includes(v),
        );
        if (invalid.length > 0) {
            const expectedStr =
                resolvedExpected.typeEnum.length === 1
                    ? `'${resolvedExpected.typeEnum[0]}'`
                    : `one of ${resolvedExpected.typeEnum.map((s) => `'${s}'`).join(", ")}`;
            return [
                `${fieldName(path)} expected ${expectedStr}, got '${invalid.join("', '")}'`,
            ];
        }
        return [];
    }

    if (!isTypeAssignable(resolvedInferred, resolvedExpected)) {
        return [
            `${fieldName(path)} expected ${formatSchemaType(resolvedExpected)}, got ${formatSchemaType(resolvedInferred)}`,
        ];
    }

    return [];
}

function validateArrayValue(
    value: CompiledValueNode,
    elementType: SchemaType,
    variableTypes: Map<string, SchemaType>,
    path: string,
): string[] {
    if (value.type === "variable") {
        return validateVariableAgainstSchema(
            value.name,
            variableTypes,
            SchemaCreator.array(elementType),
            path,
        );
    }

    if (value.type !== "array") {
        return [
            `${fieldName(path)} expected an array, got ${value.type} value`,
        ];
    }

    const errors: string[] = [];
    const arrValue = value as CompiledArrayValueNode;
    for (let i = 0; i < arrValue.value.length; i++) {
        errors.push(
            ...validateValueType(
                arrValue.value[i],
                elementType,
                variableTypes,
                fullPath(path, String(i)),
            ),
        );
    }
    return errors;
}

function validatePrimitiveValue(
    value: CompiledValueNode,
    expectedPrimitive: "string" | "number" | "boolean",
    variableTypes: Map<string, SchemaType>,
    path: string,
): string[] {
    if (value.type === "variable") {
        const varType = variableTypes.get(value.name);
        if (varType === undefined || varType === ANY_TYPE) {
            return []; // Unknown variable type — skip
        }
        const expectedType =
            expectedPrimitive === "string"
                ? SchemaCreator.string()
                : expectedPrimitive === "number"
                  ? SchemaCreator.number()
                  : SchemaCreator.boolean();
        if (!isTypeAssignable(varType, expectedType)) {
            return [
                `${fieldName(path)} expected ${expectedPrimitive}, but variable '${value.name}' captures ${resolveType(varType).type}`,
            ];
        }
        return [];
    }

    if (value.type === "literal") {
        const actualType = typeof value.value;
        if (actualType !== expectedPrimitive) {
            return [
                `${fieldName(path)} expected ${expectedPrimitive}, got ${actualType} literal ${JSON.stringify(value.value)}`,
            ];
        }
        return [];
    }

    return [
        `${fieldName(path)} expected ${expectedPrimitive}, got ${value.type} value`,
    ];
}

function validateLiteralBooleanValue(
    value: CompiledValueNode,
    expected: boolean,
    variableTypes: Map<string, SchemaType>,
    path: string,
): string[] {
    if (value.type === "literal" && value.value === expected) {
        return [];
    }
    if (value.type === "literal" && typeof value.value === "boolean") {
        return [`${fieldName(path)} expected ${expected}, got ${value.value}`];
    }
    if (value.type === "variable") {
        const varType = variableTypes.get(value.name);
        if (varType === undefined || varType === ANY_TYPE) {
            return []; // Unknown variable type — skip
        }
        const expectedType = expected
            ? SchemaCreator.true_()
            : SchemaCreator.false_();
        if (!isTypeAssignable(varType, expectedType)) {
            return [
                `${fieldName(path)} expected ${expected}, but variable '${value.name}' captures ${formatSchemaType(resolveType(varType))}`,
            ];
        }
        return [];
    }
    return [`${fieldName(path)} expected ${expected}, got ${value.type} value`];
}

function validateStringUnionValue(
    value: CompiledValueNode,
    typeEnum: string[],
    variableTypes: Map<string, SchemaType>,
    path: string,
): string[] {
    if (value.type === "variable") {
        const varType = variableTypes.get(value.name);
        if (varType === undefined || varType === ANY_TYPE) {
            return [];
        }
        const resolvedVarType = resolveType(varType);
        // string-union variable: check that all possible values are in
        // the expected enum.
        if (resolvedVarType.type === "string-union") {
            const invalid = resolvedVarType.typeEnum.filter(
                (v) => !typeEnum.includes(v),
            );
            if (invalid.length > 0) {
                const expected =
                    typeEnum.length === 1
                        ? `'${typeEnum[0]}'`
                        : `one of ${typeEnum.map((s) => `'${s}'`).join(", ")}`;
                return [
                    `${fieldName(path)} expected ${expected}, got '${invalid.join("', '")}'`,
                ];
            }
            return [];
        }
        // A bare string cannot be verified to produce one of the enum
        // values — reject it.  The grammar must use a sub-rule or literal
        // that produces a value matching the declared enum.
        if (!isTypeAssignable(varType, SchemaCreator.string(typeEnum[0]))) {
            return [
                `${fieldName(path)} expected ${typeEnum.length === 1 ? `'${typeEnum[0]}'` : `one of ${typeEnum.map((s) => `'${s}'`).join(", ")}`}, but variable '${value.name}' captures ${formatSchemaType(resolvedVarType)}`,
            ];
        }
        // string type does not guarantee conformance to the enum
        return [
            `${fieldName(path)} expected ${typeEnum.length === 1 ? `'${typeEnum[0]}'` : `one of ${typeEnum.map((s) => `'${s}'`).join(", ")}`}, but variable '${value.name}' captures string (use a sub-rule that produces one of the declared values)`,
        ];
    }

    if (value.type === "literal" && typeof value.value === "string") {
        if (!typeEnum.includes(value.value)) {
            const expected =
                typeEnum.length === 1
                    ? `'${typeEnum[0]}'`
                    : `one of ${typeEnum.map((s) => `'${s}'`).join(", ")}`;
            return [
                `${fieldName(path)} expected ${expected}, got '${value.value}'`,
            ];
        }
        return [];
    }

    return [
        `${fieldName(path)} expected a string union member, got ${value.type} value`,
    ];
}

/**
 * Check if a variable's inferred type is compatible with an expected schema type.
 * When the variable has a full SchemaType (e.g., from rule inference), validates
 * structurally. For simple primitive types, just checks the type discriminant.
 */
function validateVariableAgainstSchema(
    varName: string,
    variableTypes: Map<string, SchemaType>,
    expectedType: SchemaType,
    path: string,
): string[] {
    const varType = variableTypes.get(varName);
    if (varType === undefined || varType === ANY_TYPE) {
        return []; // Unknown — skip
    }
    // Use structural validation so object fields and array element types
    // are checked, not just the type discriminant.
    const resolved = resolveType(expectedType);
    if (resolved.type === "any") return [];
    return validateInferredAgainstExpected(varType, resolved, path);
}
