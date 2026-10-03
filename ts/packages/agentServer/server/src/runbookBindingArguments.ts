// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { validateCatalogSchemaValues } from "default-agent-provider";
import {
    runbookArgumentLimits,
    validateRunbookBindingArguments as validateCanonicalArguments,
    validateRunbookArgumentReadiness,
} from "@typeagent/memory-service/agent-edition-validation";
import { types } from "node:util";

const annotations = [
    "title",
    "description",
    "default",
    "examples",
    "$comment",
    "$schema",
    "$id",
    "deprecated",
    "readOnly",
    "writeOnly",
];
const unconstrainedLeafKeys = new Set(["type", ...annotations]);
const objectKeys = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "minProperties",
    "maxProperties",
    ...annotations,
]);
const arrayKeys = new Set([
    "type",
    "items",
    "additionalItems",
    "minItems",
    "maxItems",
    ...annotations,
]);
const unsupportedSymbolicKeywords = new Set([
    "$ref",
    "$dynamicRef",
    "$recursiveRef",
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "if",
    "then",
    "else",
    "dependentSchemas",
    "dependencies",
    "patternProperties",
    "propertyNames",
    "contains",
    "uniqueItems",
    "prefixItems",
    "unevaluatedProperties",
    "unevaluatedItems",
]);

class UnsupportedSchema extends Error {}

function plainJsonContainer(
    value: object,
    expected: typeof Object | typeof Array,
): boolean {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype === null) return expected === Object;
    if (typeof prototype !== "object" || types.isProxy(prototype)) return false;
    const constructor: unknown = Object.getOwnPropertyDescriptor(
        prototype,
        "constructor",
    )?.value;
    return (
        typeof constructor === "function" &&
        !types.isProxy(constructor) &&
        Function.prototype.toString.call(constructor) ===
            Function.prototype.toString.call(expected) &&
        Object.getOwnPropertyDescriptor(constructor, "prototype")?.value ===
            prototype
    );
}

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function jsonEntries(value: object): [string, unknown][] {
    const names = Object.getOwnPropertyNames(value);
    if (
        names.length > runbookArgumentLimits.maxNodes + 1 ||
        Object.getOwnPropertySymbols(value).length !== 0
    )
        throw new Error(
            "Binding JSON exceeds its key limit or contains symbol keys.",
        );
    const entries: [string, unknown][] = [];
    for (const key of names) {
        if (Array.isArray(value) && key === "length") continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (
            descriptor.get !== undefined ||
            descriptor.set !== undefined ||
            !descriptor.enumerable
        )
            throw new Error(
                "Binding JSON cannot contain accessors or hidden values.",
            );
        if (
            Array.isArray(value) &&
            (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
        )
            throw new Error(
                "Binding JSON arrays cannot contain custom properties.",
            );
        entries.push([key, descriptor.value]);
    }
    if (Array.isArray(value) && entries.length !== value.length)
        throw new Error("Binding JSON arrays cannot contain holes.");
    return entries;
}

function inspectJson(
    value: unknown,
    depth: number,
    budget: { nodes: number },
): void {
    if (
        ++budget.nodes > runbookArgumentLimits.maxNodes ||
        depth > runbookArgumentLimits.maxDepth
    )
        throw new Error("Binding JSON exceeds its node/depth limit.");
    if (typeof value === "string") {
        if (value.length > runbookArgumentLimits.maxStringLength)
            throw new Error("Binding JSON string exceeds its limit.");
        return;
    }
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object")
        throw new Error(
            "Binding arguments must contain finite JSON values only.",
        );
    if (types.isProxy(value))
        throw new Error("Binding arguments cannot contain proxies.");
    if (!plainJsonContainer(value, Array.isArray(value) ? Array : Object))
        throw new Error("Binding arguments must be plain JSON objects.");
    for (const [key, child] of jsonEntries(value)) {
        if (["__proto__", "prototype", "constructor"].includes(key))
            throw new Error("Unsafe binding JSON key.");
        inspectJson(child, depth + 1, budget);
    }
}

export function boundRunbookJson(value: unknown): void {
    inspectJson(value, 0, { nodes: 0 });
    if (
        Buffer.byteLength(JSON.stringify(value)) >
        runbookArgumentLimits.maxEncodedBytes
    )
        throw new Error("Binding JSON exceeds its encoded limit.");
}

function hasSymbolic(value: unknown): boolean {
    if (value === null || typeof value !== "object") return false;
    if (Object.prototype.hasOwnProperty.call(value, "$literal")) return false;
    return (
        Object.prototype.hasOwnProperty.call(value, "$input") ||
        Object.values(value).some(hasSymbolic)
    );
}

function literalValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(literalValue);
    if (value === null || typeof value !== "object") return value;
    if (Object.prototype.hasOwnProperty.call(value, "$literal"))
        return record(value).$literal;
    return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, literalValue(child)]),
    );
}

function fitsType(source: string, target: unknown): boolean {
    if (target === undefined) return true;
    const allowed = Array.isArray(target) ? target : [target];
    return (
        allowed.includes(source) ||
        (source === "integer" && allowed.includes("number"))
    );
}

function validateConcrete(schema: unknown, value: unknown): void {
    if (schema === false)
        throw new Error("The target schema rejects this argument.");
    const result = validateCatalogSchemaValues(record(schema), [value]);
    if (!result.valid)
        throw new Error(
            result.reason ?? "Arguments do not fit the actual target schema.",
        );
}

function sourceInput(
    id: string,
    inputs: Record<string, unknown>,
): Record<string, unknown> {
    const properties = record(inputs.properties);
    if (!Object.prototype.hasOwnProperty.call(properties, id))
        throw new Error(`Unknown symbolic input reference: ${id}.`);
    const source = record(properties[id]);
    if (
        source.writeOnly === true ||
        source.secret === true ||
        source["x-secret"] === true
    )
        throw new UnsupportedSchema(
            "Secret input bindings are unsupported; retain a manual step.",
        );
    if (!Array.isArray(inputs.required) || !inputs.required.includes(id))
        throw new UnsupportedSchema(
            "Symbolic bindings require a required declared input; defaults are not substituted.",
        );
    if (
        !["string", "number", "integer", "boolean"].includes(
            String(source.type),
        )
    )
        throw new UnsupportedSchema(
            "Symbolic bindings require a declared primitive input type.",
        );
    return source;
}

function proveReference(
    id: string,
    schema: unknown,
    inputs: Record<string, unknown>,
): void {
    const source = sourceInput(id, inputs);
    if (schema === false)
        throw new Error("The target schema rejects this symbolic argument.");
    const target = record(schema);
    if (
        Array.isArray(source.enum) &&
        source.enum.length > 0 &&
        source.enum.length <= 100
    ) {
        const declared = validateCatalogSchemaValues(source, source.enum);
        const fit = validateCatalogSchemaValues(target, source.enum);
        if (!declared.valid || !fit.valid)
            throw new Error(
                "Every declared input enum value must fit the actual target schema.",
            );
        return;
    }
    if (source.enum !== undefined)
        throw new UnsupportedSchema(
            "Symbolic input enums must contain 1..100 fitting values.",
        );
    if (!fitsType(String(source.type), target.type))
        throw new Error(
            "Declared input type does not fit the target argument schema.",
        );
    if (Object.keys(target).some((key) => !unconstrainedLeafKeys.has(key)))
        throw new UnsupportedSchema(
            "Symbolic constraints cannot be proven from the declared type; use a fitting enum or keep the step manual.",
        );
}

function proveContainer(
    schema: unknown,
    kind: "object" | "array",
    allowed: Set<string>,
): Record<string, unknown> {
    if (schema === false)
        throw new Error("The target schema rejects this argument container.");
    const target = record(schema);
    if (!fitsType(kind, target.type))
        throw new Error("Argument container does not fit the target type.");
    if (Object.keys(target).some((key) => !allowed.has(key)))
        throw new UnsupportedSchema(
            "This container schema does not support provable symbolic bindings.",
        );
    return target;
}

function checkSize(length: number, minimum: unknown, maximum: unknown): void {
    if (
        (typeof minimum === "number" && length < minimum) ||
        (typeof maximum === "number" && length > maximum)
    )
        throw new Error(
            "Argument container size does not fit the target schema.",
        );
}

function proveObject(
    value: Record<string, unknown>,
    schema: unknown,
    inputs: Record<string, unknown>,
): void {
    const target = proveContainer(schema, "object", objectKeys);
    const entries = Object.entries(value);
    checkSize(entries.length, target.minProperties, target.maxProperties);
    if (
        Array.isArray(target.required) &&
        target.required.some(
            (key) =>
                typeof key !== "string" ||
                !Object.prototype.hasOwnProperty.call(value, key),
        )
    )
        throw new Error("Required target arguments are missing.");
    const properties = record(target.properties);
    for (const [key, child] of entries) {
        const childSchema = Object.prototype.hasOwnProperty.call(
            properties,
            key,
        )
            ? properties[key]
            : target.additionalProperties;
        proveNode(child, childSchema, inputs);
    }
}

function proveArray(
    value: unknown[],
    schema: unknown,
    inputs: Record<string, unknown>,
): void {
    const target = proveContainer(schema, "array", arrayKeys);
    checkSize(value.length, target.minItems, target.maxItems);
    for (let index = 0; index < value.length; index++) {
        const childSchema = Array.isArray(target.items)
            ? (target.items[index] ?? target.additionalItems)
            : target.items;
        proveNode(value[index], childSchema, inputs);
    }
}

function proveNode(
    value: unknown,
    schema: unknown,
    inputs: Record<string, unknown>,
): void {
    if (!hasSymbolic(value)) {
        validateConcrete(schema, literalValue(value));
        return;
    }
    const object = record(value);
    if (typeof object.$input === "string") {
        proveReference(object.$input, schema, inputs);
    } else if (Array.isArray(value)) {
        proveArray(value, schema, inputs);
    } else {
        proveObject(object, schema, inputs);
    }
}

function unsupportedSchema(value: unknown): boolean {
    if (value === null || typeof value !== "object") return false;
    return (
        Object.keys(value).some((key) =>
            unsupportedSymbolicKeywords.has(key),
        ) || Object.values(value).some(unsupportedSchema)
    );
}

export function validateRunbookBindingArguments(
    schema: Record<string, unknown>,
    arguments_: Record<string, unknown> | undefined,
    inputSchema?: Record<string, unknown>,
): {
    valid: boolean;
    reason?: string;
    code?: "unavailable" | "invalidArguments";
} {
    try {
        const values = arguments_ ?? {};
        boundRunbookJson(values);
        if (inputSchema !== undefined) boundRunbookJson(inputSchema);
        validateCanonicalArguments(values);
        if (
            inputSchema === undefined &&
            Object.values(values).some(hasSymbolic)
        )
            throw new UnsupportedSchema(
                "Declared edition inputs are required to validate symbolic references.",
            );
        validateRunbookArgumentReadiness(
            values,
            Object.keys(record(inputSchema?.properties)).map((id) => ({ id })),
        );
        const compiled = validateCatalogSchemaValues(schema, []);
        if (!compiled.valid)
            throw new UnsupportedSchema(
                compiled.reason ??
                    "Current catalog schema cannot be validated.",
            );
        if (!Object.values(values).some(hasSymbolic)) {
            const concrete = Object.fromEntries(
                Object.entries(values).map(([key, child]) => [
                    key,
                    literalValue(child),
                ]),
            );
            return validateCatalogSchemaValues(schema, [concrete]);
        }
        if (inputSchema === undefined)
            throw new UnsupportedSchema(
                "Declared edition inputs are required to validate symbolic references.",
            );
        if (unsupportedSchema(schema))
            throw new UnsupportedSchema(
                "This catalog schema does not support provable symbolic bindings; retain a manual step.",
            );
        proveObject(values, schema, inputSchema);
        return { valid: true };
    } catch (error) {
        return {
            valid: false,
            code:
                error instanceof UnsupportedSchema
                    ? "unavailable"
                    : "invalidArguments",
            reason:
                error instanceof Error
                    ? error.message
                    : "Invalid binding arguments.",
        };
    }
}
