// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionSchemaTypeDefinition,
    ActionParamObject,
    SchemaType,
} from "@typeagent/action-schema";
import type { ParamInfo } from "./types.js";
import { joinComments } from "./util.js";

// Maximum recursion depth when rendering a nested schema type. Keeps output
// readable (and guards against self-referential types).
const MAX_TYPE_DEPTH = 2;
// Cap on how many members of a union / string-union are shown inline.
const MAX_UNION_MEMBERS = 8;
// Cap on how many object field names are shown inline.
const MAX_OBJECT_FIELDS = 6;

function renderStringUnion(typeEnum: string[] | undefined): string {
    const values = typeEnum ?? [];
    const shown = values
        .slice(0, MAX_UNION_MEMBERS)
        .map((v) => JSON.stringify(v));
    if (values.length > MAX_UNION_MEMBERS) {
        shown.push("…");
    }
    return shown.join(" | ") || "string";
}

function renderTypeUnion(
    types: SchemaType[] | undefined,
    depth: number,
): string {
    const parts = (types ?? []).map((t) => renderSchemaType(t, depth + 1));
    const unique = [...new Set(parts)];
    const shown = unique.slice(0, MAX_UNION_MEMBERS);
    if (unique.length > MAX_UNION_MEMBERS) {
        shown.push("…");
    }
    return shown.join(" | ") || "any";
}

function renderTypeReference(
    type: Extract<SchemaType, { type: "type-reference" }>,
    depth: number,
): string {
    // Expand a shallow reference so the reader sees the real shape;
    // fall back to the referenced type name when it is too deep.
    if (type.definition !== undefined && depth < MAX_TYPE_DEPTH) {
        return renderSchemaType(type.definition.type, depth + 1);
    }
    return type.name || "object";
}

function renderObject(
    type: Extract<SchemaType, { type: "object" }>,
    depth: number,
): string {
    if (depth >= MAX_TYPE_DEPTH) {
        return "{ … }";
    }
    const fields = Object.keys(type.fields ?? {});
    if (fields.length === 0) {
        return "{}";
    }
    const shown = fields.slice(0, MAX_OBJECT_FIELDS);
    const suffix = fields.length > MAX_OBJECT_FIELDS ? ", …" : "";
    return `{ ${shown.join(", ")}${suffix} }`;
}

/**
 * Render a parsed schema type as a compact, human-readable type string
 * (e.g. `string`, `number[]`, `"a" | "b"`, `{ x, y }`).
 */
export function renderSchemaType(
    type: SchemaType | undefined,
    depth = 0,
): string {
    if (type === undefined) {
        return "any";
    }
    switch (type.type) {
        case "string":
            return "string";
        case "number":
            return "number";
        case "boolean":
            return "boolean";
        case "any":
            return "any";
        case "undefined":
            return "undefined";
        case "true":
            return "true";
        case "false":
            return "false";
        case "string-union":
            return renderStringUnion(type.typeEnum);
        case "array":
            return `${renderSchemaType(type.elementType, depth + 1)}[]`;
        case "type-union":
            return renderTypeUnion(type.types, depth);
        case "type-reference":
            return renderTypeReference(type, depth);
        case "object":
            return renderObject(type, depth);
        default:
            return "any";
    }
}

/** Follow references until an object type is reached, or give up. */
function resolveToObject(type: SchemaType): ActionParamObject | undefined {
    let current: SchemaType | undefined = type;
    let guard = 0;
    while (current !== undefined && guard < 16) {
        guard++;
        if (current.type === "object") {
            return current;
        }
        if (current.type === "type-reference") {
            current = current.definition?.type;
            continue;
        }
        return undefined;
    }
    return undefined;
}

/**
 * Extract the parameter list for an action from its parsed schema definition.
 * Returns an empty array when the action takes no parameters.
 */
export function extractParams(def: ActionSchemaTypeDefinition): ParamInfo[] {
    const paramsField = def.type.fields.parameters;
    if (paramsField === undefined) {
        return [];
    }
    const obj = resolveToObject(paramsField.type);
    if (obj === undefined) {
        return [];
    }
    const params: ParamInfo[] = [];
    for (const [name, field] of Object.entries(obj.fields)) {
        params.push({
            name,
            type: renderSchemaType(field.type),
            optional: field.optional === true,
            description: joinComments(field.comments),
        });
    }
    return params;
}
