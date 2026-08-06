// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Convert action-schema type AST nodes into translation-bench ParamSpec trees
 * and short parameter summary strings.
 *
 * Critical: `type-union` must not collapse to opaque `any` when arms are
 * string-like (e.g. moniker literals | WebPageMoniker string) or when arms are
 * structured objects (e.g. MusicTarget / StartLookup discriminated unions).
 *
 * Depth accounting:
 * - object / array add structural depth
 * - type-reference is depth-transparent (aliases do not charge)
 * - type-union is depth-transparent; `undefined` arms are stripped before
 *   recursing so `T | undefined` on an already-optional field does not erase
 *   nested number leaves (DateVal/TimeVal under conversationLookupFilters)
 */

import type { ParamSpec } from "./paramTypes.js";

/** Loose shape of action-schema type nodes (runtime schema objects). */
export interface SchemaTypeNode {
    type?: string;
    typeEnum?: string[];
    types?: SchemaTypeNode[];
    elementType?: SchemaTypeNode;
    fields?: Record<string, SchemaFieldNode>;
    definition?: { type?: SchemaTypeNode; name?: string };
    name?: string;
}

export interface SchemaFieldNode {
    optional?: boolean;
    type?: SchemaTypeNode;
}

/**
 * Structural nesting budget. Must clear conversationLookupFilters → TermFilter
 * → timeRange → DateTimeRange → DateTime → DateVal → day/month/year (depth 6).
 */
const MAX_SPEC_DEPTH = 8;
const MAX_RENDER_DEPTH = 8;

/** Drop pure-undefined arms; used so optional unions do not charge depth. */
function nonUndefinedArms(types: SchemaTypeNode[] | undefined): SchemaTypeNode[] {
    return (types ?? []).filter((arm) => arm?.type !== "undefined");
}

/**
 * Map a schema type node to ParamSpec.
 * Unknown / unsupported shapes become `{ kind: "any" }` only as a last resort.
 */
export function schemaTypeToParamSpec(
    t: SchemaTypeNode | undefined,
    depth = 0,
): ParamSpec {
    if (!t || depth > MAX_SPEC_DEPTH) return { kind: "any" };
    switch (t.type) {
        case "string":
            return { kind: "string" };
        case "number":
            return { kind: "number" };
        case "boolean":
        case "true":
        case "false":
            return { kind: "boolean" };
        case "undefined":
            // Optionality is carried on the field, not the type tree.
            return { kind: "any" };
        case "any":
            return { kind: "any" };
        case "string-union":
            return t.typeEnum !== undefined && t.typeEnum.length > 0
                ? { kind: "string", enum: [...t.typeEnum] }
                : { kind: "string" };
        case "array":
            return {
                kind: "array",
                item: schemaTypeToParamSpec(t.elementType, depth + 1),
            };
        case "object": {
            const fields: Record<
                string,
                { optional: boolean; spec: ParamSpec }
            > = {};
            for (const [n, f] of Object.entries(t.fields ?? {})) {
                fields[n] = {
                    optional: !!f.optional,
                    spec: schemaTypeToParamSpec(f.type, depth + 1),
                };
            }
            return { kind: "object", fields };
        }
        case "type-reference":
            // Transparent: resolving a named alias does not add structural depth.
            return schemaTypeToParamSpec(t.definition?.type, depth);
        case "type-union": {
            // Transparent like type-reference. Strip undefined arms so
            // `T | undefined` (common on optional fields) does not waste depth
            // or collapse the remaining structured arm to any.
            const arms = nonUndefinedArms(t.types);
            if (arms.length === 0) return { kind: "any" };
            if (arms.length === 1) {
                return schemaTypeToParamSpec(arms[0], depth);
            }
            return mergeUnionParamSpecs(
                arms.map((arm) => schemaTypeToParamSpec(arm, depth)),
            );
        }
        default:
            return { kind: "any" };
    }
}

/**
 * Collapse union arms into one ParamSpec.
 *
 * Rules (in order):
 * - empty → any
 * - drop pure-any arms when other arms exist
 * - all string (enum and/or open): open string wins over closed enum;
 *   closed enums merge unique values
 * - all same scalar kind → that kind
 * - all arrays → merge item specs
 * - all objects → field-wise merge (optional if not on every arm)
 * - otherwise keep as kind:"union" when ≥2 structural arms remain;
 *   true scalar/structure conflicts that cannot score still become any only
 *   when mixing incompatible leaves with no shared object shape
 */
export function mergeUnionParamSpecs(arms: ParamSpec[]): ParamSpec {
    const cleaned = arms.filter((a) => a !== undefined);
    if (cleaned.length === 0) return { kind: "any" };

    const nonAny = cleaned.filter((a) => a.kind !== "any");
    const effective = nonAny.length > 0 ? nonAny : cleaned;
    if (effective.length === 1) return effective[0]!;

    // Flatten nested unions.
    const flat: ParamSpec[] = [];
    for (const arm of effective) {
        if (arm.kind === "union") {
            flat.push(...arm.arms);
        } else {
            flat.push(arm);
        }
    }
    if (flat.length === 1) return flat[0]!;

    if (flat.every((a) => a.kind === "string")) {
        const strings = flat as Array<{
            kind: "string";
            enum?: string[];
        }>;
        const open = strings.some(
            (a) => a.enum === undefined || a.enum.length === 0,
        );
        if (open) {
            // e.g. "paleobiodb" | … | WebPageMoniker(string) → free string
            return { kind: "string" };
        }
        const values = new Set<string>();
        for (const a of strings) {
            for (const v of a.enum ?? []) values.add(v);
        }
        return values.size > 0
            ? { kind: "string", enum: [...values] }
            : { kind: "string" };
    }

    if (flat.every((a) => a.kind === "number")) {
        return { kind: "number" };
    }
    if (flat.every((a) => a.kind === "boolean")) {
        return { kind: "boolean" };
    }

    // Same-shaped arrays: merge item specs recursively.
    if (flat.every((a) => a.kind === "array")) {
        const items = (flat as Array<{ kind: "array"; item: ParamSpec }>).map(
            (a) => a.item,
        );
        return { kind: "array", item: mergeUnionParamSpecs(items) };
    }

    // Discriminated / structural object unions → one object with unioned fields.
    if (flat.every((a) => a.kind === "object")) {
        return mergeObjectParamSpecs(
            flat as Array<{
                kind: "object";
                fields: Record<string, { optional: boolean; spec: ParamSpec }>;
            }>,
        );
    }

    // Heterogeneous structural mix: keep arms so graders can still see shape
    // (e.g. object|string is rare; prefer union over silent any).
    const structural = flat.filter(
        (a) => a.kind === "object" || a.kind === "array" || a.kind === "union",
    );
    if (structural.length === flat.length) {
        return { kind: "union", arms: flat };
    }

    // Scalar vs structure or mixed scalars (string|number) → any.
    return { kind: "any" };
}

function mergeObjectParamSpecs(
    objects: Array<{
        kind: "object";
        fields: Record<string, { optional: boolean; spec: ParamSpec }>;
    }>,
): ParamSpec {
    const allNames = new Set<string>();
    for (const obj of objects) {
        for (const name of Object.keys(obj.fields)) {
            allNames.add(name);
        }
    }
    const fields: Record<string, { optional: boolean; spec: ParamSpec }> = {};
    for (const name of allNames) {
        const present: Array<{ optional: boolean; spec: ParamSpec }> = [];
        for (const obj of objects) {
            const f = obj.fields[name];
            if (f !== undefined) present.push(f);
        }
        const optional =
            present.length < objects.length ||
            present.some((f) => f.optional);
        const specs = present.map((f) => f.spec);
        fields[name] = {
            optional,
            spec: mergeUnionParamSpecs(specs),
        };
    }
    return { kind: "object", fields };
}

/**
 * Pretty-print a schema type for the catalog `parameters` summary line.
 * Optional fields omit a redundant trailing `|undefined` arm.
 */
export function renderSchemaType(
    t: SchemaTypeNode | undefined,
    depth = 0,
    options?: { omitUndefined?: boolean },
): string {
    if (!t || depth > MAX_RENDER_DEPTH) return "any";
    switch (t.type) {
        case "string":
            return "string";
        case "number":
            return "number";
        case "boolean":
            return "boolean";
        case "true":
            return "true";
        case "false":
            return "false";
        case "undefined":
            return options?.omitUndefined ? "" : "undefined";
        case "any":
            return "any";
        case "array":
            return `${renderSchemaType(t.elementType, depth + 1)}[]`;
        case "string-union":
            return t.typeEnum && t.typeEnum.length > 0
                ? t.typeEnum.map((v) => JSON.stringify(v)).join("|")
                : "string";
        case "type-union": {
            // Transparent depth (same as type-reference). Optionally drop
            // undefined arms when the surrounding field is already optional.
            const arms = options?.omitUndefined
                ? nonUndefinedArms(t.types)
                : (t.types ?? []);
            if (arms.length === 0) {
                return options?.omitUndefined ? "any" : "undefined";
            }
            if (arms.length === 1) {
                return renderSchemaType(arms[0], depth, options);
            }
            const rendered = arms.map((arm) =>
                renderSchemaType(arm, depth, options),
            );
            const unique: string[] = [];
            for (const r of rendered) {
                if (r && !unique.includes(r)) unique.push(r);
            }
            return unique.length === 0 ? "any" : unique.join("|");
        }
        case "object": {
            if (!t.fields) return "object";
            const inner = Object.entries(t.fields)
                .map(([n, f]) => {
                    const rendered = renderSchemaType(f.type, depth + 1, {
                        omitUndefined: !!f.optional,
                    });
                    return `${n}${f.optional ? "?" : ""}: ${rendered}`;
                })
                .join(", ");
            return `{ ${inner} }`;
        }
        case "type-reference":
            // Transparent for depth — aliases must not fake "any" on leaves.
            if (t.definition?.type) {
                return renderSchemaType(t.definition.type, depth, options);
            }
            return t.name ?? t.definition?.name ?? "unknown";
        default:
            return t.type ?? "any";
    }
}
