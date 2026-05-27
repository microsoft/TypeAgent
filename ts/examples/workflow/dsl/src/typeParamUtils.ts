// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared utilities for resolving generic type parameters.
 *
 * Both the type checker and emitter use these helpers to resolve
 * `{ "$typeParam": "T" }` markers in task schemas by substituting
 * them with the concrete type argument schemas supplied at call sites.
 */

import { JSONSchema, SchemaTemplate, isTypeParamRef } from "workflow-model";
import { TypeExpr } from "./ast.js";

export interface TypeParamDef {
    name: string;
    default?: JSONSchema;
}

/**
 * Convert an AST TypeExpr to a JSONSchema object.
 * Used by both the type checker and the emitter.
 */
export function typeExprToSchema(te: TypeExpr): JSONSchema {
    switch (te.kind) {
        case "NamedType":
            switch (te.name) {
                case "string":
                    return { type: "string" };
                case "number":
                    return { type: "number" };
                case "integer":
                    return { type: "integer" };
                case "boolean":
                    return { type: "boolean" };
                case "never":
                    return { not: {} };
                case "unknown":
                    return {};
                default:
                    return {};
            }
        case "ArrayType":
            return { type: "array", items: typeExprToSchema(te.element) };
        case "ObjectType": {
            const props: Record<string, JSONSchema> = {};
            const req: string[] = [];
            for (const f of te.fields) {
                props[f.name] = typeExprToSchema(f.type);
                if (!f.optional) req.push(f.name);
            }
            const out: JSONSchema = { type: "object", properties: props };
            if (req.length > 0) out.required = req;
            return out;
        }
    }
}

/**
 * Resolve all `{ "$typeParam": "<name>" }` markers in a schema by
 * substituting the corresponding type argument schema.
 *
 * @param schema    The template schema (may contain $typeParam markers).
 * @param params    The declared type parameters (for positional mapping).
 * @param argSchemas  The concrete schemas supplied by the caller.
 * @returns A new schema with all markers replaced (plain JSONSchema).
 */
export function resolveTypeParams(
    schema: SchemaTemplate,
    params: TypeParamDef[],
    argSchemas: JSONSchema[],
): JSONSchema {
    const bindings = new Map<string, JSONSchema>();
    for (let i = 0; i < params.length; i++) {
        if (i < argSchemas.length) {
            bindings.set(params[i].name, argSchemas[i]);
        }
    }
    if (bindings.size === 0) return schema as JSONSchema;
    return substituteMarkers(schema, bindings);
}

/**
 * Walk a schema recursively, replacing `{ "$typeParam": "X" }` nodes
 * with the bound schema for X.
 *
 * Recurses into every JSON Schema 7 sub-schema-bearing keyword (see
 * `SchemaRefKeys` in workflow-model/ir.ts) so markers nested under
 * `oneOf` / `anyOf` / `allOf` / `not` / `if` / `then` / `else` /
 * tuple-form `items` / `patternProperties` / `propertyNames` /
 * `additionalItems` / `contains` / `dependencies` / `definitions`
 * are also resolved.
 */
function substituteMarkers(
    schema: SchemaTemplate,
    bindings: ReadonlyMap<string, JSONSchema>,
): JSONSchema {
    if (typeof schema !== "object" || schema === null || Array.isArray(schema))
        return schema as JSONSchema;

    // Check if this node is a $typeParam marker
    if (isTypeParamRef(schema)) {
        const bound = bindings.get(schema.$typeParam);
        // If no binding exists, return the marker as-is (unresolved).
        return bound !== undefined ? bound : (schema as unknown as JSONSchema);
    }

    // Keywords whose value is a single sub-schema.
    const SINGLE_SCHEMA_KEYS = new Set([
        "additionalItems",
        "contains",
        "additionalProperties",
        "propertyNames",
        "if",
        "then",
        "else",
        "not",
    ]);
    // Keywords whose value is an array of sub-schemas.
    const ARRAY_SCHEMA_KEYS = new Set(["allOf", "anyOf", "oneOf"]);
    // Keywords whose value is a record of sub-schemas.
    const RECORD_SCHEMA_KEYS = new Set([
        "properties",
        "patternProperties",
        "definitions",
    ]);

    let changed = false;
    const result: Record<string, unknown> = {};

    const resolveOne = (v: unknown): unknown => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
            const r = substituteMarkers(v as SchemaTemplate, bindings);
            if (r !== v) changed = true;
            return r;
        }
        return v;
    };

    for (const [key, value] of Object.entries(schema)) {
        if (key === "items") {
            // `items` is either a single sub-schema OR an array (tuple form).
            if (Array.isArray(value)) {
                const arr = value.map(resolveOne);
                result[key] = arr;
            } else {
                result[key] = resolveOne(value);
            }
        } else if (SINGLE_SCHEMA_KEYS.has(key)) {
            result[key] = resolveOne(value);
        } else if (ARRAY_SCHEMA_KEYS.has(key) && Array.isArray(value)) {
            result[key] = value.map(resolveOne);
        } else if (
            RECORD_SCHEMA_KEYS.has(key) &&
            value &&
            typeof value === "object" &&
            !Array.isArray(value)
        ) {
            const resolvedRec: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(
                value as Record<string, unknown>,
            )) {
                resolvedRec[k] = resolveOne(v);
            }
            result[key] = resolvedRec;
        } else if (key === "dependencies" && value && typeof value === "object") {
            // `dependencies` values are either sub-schemas or string[]; only
            // recurse into the sub-schema case.
            const resolvedDeps: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(
                value as Record<string, unknown>,
            )) {
                if (Array.isArray(v)) {
                    resolvedDeps[k] = v;
                } else {
                    resolvedDeps[k] = resolveOne(v);
                }
            }
            result[key] = resolvedDeps;
        } else {
            result[key] = value;
        }
    }

    return changed ? (result as JSONSchema) : (schema as unknown as JSONSchema);
}

/** Resolved input/output schemas for a generic task call site. */
export interface ResolvedTaskSchemas {
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
    /** For container nodes (e.g. forkMap): the output schema of each body iteration. */
    bodyOutputSchema?: JSONSchema;
    /** For fork (parallel) nodes: the output schema of each branch, in order. */
    branchOutputSchemas?: JSONSchema[];
}

/**
 * Resolve a generic task's input and output schemas given explicit type
 * arguments. Fills remaining positions with declared defaults (or `{}`
 * if none). Callers that need validation (arity, missing defaults)
 * should check before calling.
 */
export function resolveGenericSchemas(
    schema: {
        inputSchema: SchemaTemplate;
        outputSchema: SchemaTemplate;
        typeParameters: TypeParamDef[];
    },
    explicitArgs: JSONSchema[],
): ResolvedTaskSchemas {
    const params = schema.typeParameters;
    const argSchemas = params.map((p, i) =>
        i < explicitArgs.length ? explicitArgs[i] : (p.default ?? {}),
    );
    return {
        inputSchema: resolveTypeParams(schema.inputSchema, params, argSchemas),
        outputSchema: resolveTypeParams(
            schema.outputSchema,
            params,
            argSchemas,
        ),
    };
}
