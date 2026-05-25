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
            return { type: "object", required: req, properties: props };
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
 */
function substituteMarkers(
    schema: SchemaTemplate,
    bindings: ReadonlyMap<string, JSONSchema>,
): JSONSchema {
    if (typeof schema !== "object" || schema === null || Array.isArray(schema))
        return schema as JSONSchema;
    if (typeof schema === "boolean") return schema as unknown as JSONSchema;

    // Check if this node is a $typeParam marker
    if (isTypeParamRef(schema)) {
        const bound = bindings.get(schema.$typeParam);
        // If no binding exists, return the marker as-is (unresolved).
        return bound !== undefined ? bound : (schema as unknown as JSONSchema);
    }

    // Recurse into schema-bearing keywords
    let changed = false;
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(schema)) {
        if (
            key === "properties" &&
            typeof value === "object" &&
            value !== null
        ) {
            const resolvedProps: Record<string, unknown> = {};
            let propsChanged = false;
            for (const [pk, pv] of Object.entries(
                value as Record<string, SchemaTemplate>,
            )) {
                const resolved = substituteMarkers(pv, bindings);
                if (resolved !== pv) propsChanged = true;
                resolvedProps[pk] = resolved;
            }
            result[key] = propsChanged ? resolvedProps : value;
            if (propsChanged) changed = true;
        } else if (
            key === "items" &&
            typeof value === "object" &&
            value !== null
        ) {
            const resolved = substituteMarkers(
                value as SchemaTemplate,
                bindings,
            );
            result[key] = resolved;
            if (resolved !== value) changed = true;
        } else if (
            key === "additionalProperties" &&
            typeof value === "object" &&
            value !== null
        ) {
            const resolved = substituteMarkers(
                value as SchemaTemplate,
                bindings,
            );
            result[key] = resolved;
            if (resolved !== value) changed = true;
        } else {
            result[key] = value;
        }
    }

    // If nothing changed, the schema is returned as-is. The cast is safe
    // because the caller guarantees that all markers will be resolved.
    return changed ? (result as JSONSchema) : (schema as unknown as JSONSchema);
}

/** Resolved input/output schemas for a generic task call site. */
export interface ResolvedTaskSchemas {
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
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
