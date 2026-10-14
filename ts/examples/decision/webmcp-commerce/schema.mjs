// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DEPARTMENTS, DIETARY, PRODUCTS, productById } from "./catalog.mjs";

export const NO_FIT = "no_fit";
export const NO_SPAN = "no_span";
export const NONE = "none";
export const MAX_INPUT_CHARS = 500;
export const MAX_SPAN_CHARS = 48;
export const MAX_SPAN_CANDIDATES = 12;
export const FIT_THRESHOLD = 0.5;

const STOP = new Set([
    "a",
    "an",
    "and",
    "any",
    "for",
    "in",
    "me",
    "of",
    "the",
    "to",
]);

export const TOOLS = [
    {
        name: "search_products",
        policy: "allow",
        readOnly: true,
        description:
            "Read the local grocery catalog. No basket, payment, or account change.",
        fields: {
            department: { kind: "enum", values: DEPARTMENTS, required: false },
            dietary: {
                kind: "array-enum",
                values: DIETARY,
                required: false,
            },
            organic: { kind: "boolean", required: false },
            query: { kind: "span", required: false },
        },
    },
    {
        name: "get_product_details",
        policy: "allow",
        readOnly: true,
        description:
            "Read one catalog product whose name is an exact span of the original request.",
        fields: {
            product_id: {
                kind: "enum",
                values: PRODUCTS.map((product) => product.id),
                required: true,
            },
        },
    },
    {
        name: "add_to_cart",
        policy: "deny",
        readOnly: false,
        description: "Mocked basket write. Denied before model questions.",
        fields: {
            product_id: {
                kind: "enum",
                values: PRODUCTS.map((product) => product.id),
                required: true,
            },
        },
    },
    {
        name: "checkout",
        policy: "deny",
        readOnly: false,
        description: "Mocked checkout. Denied before model questions.",
        fields: {},
    },
];

export function toolByName(name) {
    return TOOLS.find((tool) => tool.name === name);
}

export function eligibleTools() {
    return TOOLS.filter((tool) => tool.policy === "allow" && tool.readOnly);
}

export function deniedTools() {
    return TOOLS.filter((tool) => tool.policy !== "allow" || !tool.readOnly);
}

export function inputSchema(tool) {
    const properties = {};
    const required = [];
    for (const [name, field] of Object.entries(tool.fields)) {
        properties[name] = schemaProperty(field);
        if (field.required) required.push(name);
    }
    return {
        type: "object",
        additionalProperties: false,
        properties,
        required,
    };
}

function schemaProperty(field) {
    if (field.kind === "enum") {
        return { type: "string", enum: [...field.values] };
    }
    if (field.kind === "array-enum") {
        return {
            type: "array",
            items: { type: "string", enum: [...field.values] },
            uniqueItems: true,
            maxItems: field.values.length,
        };
    }
    if (field.kind === "boolean") return { type: "boolean" };
    return {
        type: "object",
        additionalProperties: false,
        properties: {
            id: { type: "string" },
            text: { type: "string", maxLength: MAX_SPAN_CHARS },
            start: { type: "integer", minimum: 0 },
            end: { type: "integer", minimum: 0 },
        },
    };
}

export function literalSpans(original) {
    assertOriginal(original);
    const tokens = [];
    for (const match of original.matchAll(
        /[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g,
    )) {
        tokens.push({
            start: match.index,
            end: match.index + match[0].length,
        });
    }
    const grams = [];
    for (let size = 1; size <= 4; size++) {
        for (let index = 0; index + size <= tokens.length; index++) {
            const group = tokens.slice(index, index + size);
            const start = group[0].start;
            const end = group[size - 1].end;
            const text = original.slice(start, end);
            if (text.length > MAX_SPAN_CHARS) continue;
            if (
                group.every((token) =>
                    STOP.has(
                        original.slice(token.start, token.end).toLowerCase(),
                    ),
                )
            ) {
                continue;
            }
            grams.push({ id: `span:${start}:${end}`, text, start, end, size });
        }
    }
    const ranked = grams
        .filter(
            (span, index, all) =>
                all.findIndex((item) => item.id === span.id) === index,
        )
        .sort(
            (left, right) =>
                rank(right) - rank(left) || left.start - right.start,
        );
    return [
        {
            id: NO_SPAN,
            text: "",
            start: null,
            end: null,
        },
        ...ranked.slice(0, MAX_SPAN_CANDIDATES),
    ];
}

function rank(span) {
    const folded = span.text.toLowerCase();
    if (PRODUCTS.some((product) => product.name.toLowerCase() === folded)) {
        return 500;
    }
    if (DEPARTMENTS.includes(folded) || DIETARY.includes(folded)) return 400;
    if (
        PRODUCTS.some((product) => product.name.toLowerCase().includes(folded))
    ) {
        return 300 + span.size;
    }
    if (span.size === 1) return 200;
    return span.size;
}

export function assertOriginal(original) {
    if (typeof original !== "string") {
        throw new Error("original_input_must_be_string");
    }
    if (original.length > MAX_INPUT_CHARS) {
        throw new Error("original_input_too_long");
    }
}

export function validateSpan(
    original,
    span,
    candidates = literalSpans(original),
) {
    assertOriginal(original);
    if (!span || typeof span !== "object" || Array.isArray(span)) {
        return { ok: false, reason: "span_must_be_object" };
    }
    const known = candidates.find((candidate) => candidate.id === span.id);
    if (!known) return { ok: false, reason: "span_not_in_candidates" };
    if (known.id === NO_SPAN) return { ok: true, value: { id: NO_SPAN } };
    if (
        !Number.isSafeInteger(known.start) ||
        !Number.isSafeInteger(known.end) ||
        known.start < 0 ||
        known.end > original.length ||
        known.end <= known.start ||
        known.end - known.start > MAX_SPAN_CHARS
    ) {
        return { ok: false, reason: "span_index_or_length" };
    }
    if (original.slice(known.start, known.end) !== known.text) {
        return { ok: false, reason: "span_not_exact" };
    }
    if (span.text !== undefined && span.text !== known.text) {
        return { ok: false, reason: "span_text_not_exact" };
    }
    return {
        ok: true,
        value: {
            id: known.id,
            text: known.text,
            start: known.start,
            end: known.end,
        },
    };
}

export function validateArguments(tool, args, original, candidates) {
    if (!tool || tool.policy !== "allow" || tool.readOnly !== true) {
        return { ok: false, reason: "tool_not_eligible" };
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
        return { ok: false, reason: "arguments_must_be_object" };
    }
    const allowed = new Set(Object.keys(tool.fields));
    for (const key of Object.keys(args)) {
        if (!allowed.has(key)) {
            return { ok: false, reason: "unknown_field", field: key };
        }
    }
    const value = {};
    const missing = [];
    for (const [name, field] of Object.entries(tool.fields)) {
        if (args[name] === undefined) {
            if (field.required) missing.push(name);
            continue;
        }
        const checked = validateField(field, args[name], original, candidates);
        if (!checked.ok) return { ...checked, field: name };
        if (checked.omit) continue;
        value[name] = checked.value;
    }
    if (missing.length) {
        return { ok: false, reason: "missing_required", missing };
    }
    return { ok: true, value };
}

function validateField(field, value, original, candidates) {
    if (field.kind === "enum") {
        if (typeof value !== "string" || !field.values.includes(value)) {
            return { ok: false, reason: "unknown_enum" };
        }
        return { ok: true, value };
    }
    if (field.kind === "array-enum") {
        if (!Array.isArray(value) || value.length > field.values.length) {
            return { ok: false, reason: "dietary_must_be_bounded_array" };
        }
        if (new Set(value).size !== value.length) {
            return { ok: false, reason: "duplicate_enum" };
        }
        if (
            value.some(
                (item) =>
                    typeof item !== "string" || !field.values.includes(item),
            )
        ) {
            return { ok: false, reason: "unknown_enum" };
        }
        return {
            ok: true,
            value: field.values.filter((item) => value.includes(item)),
        };
    }
    if (field.kind === "boolean") {
        if (typeof value !== "boolean") {
            return { ok: false, reason: "boolean_must_be_boolean" };
        }
        return { ok: true, value };
    }
    const span = validateSpan(original, value, candidates);
    if (!span.ok) return span;
    if (span.value.id === NO_SPAN) return { ok: true, omit: true };
    return span;
}

export function productGrounded(original, productId, spans) {
    const product = productById(productId);
    if (!product) return false;
    const needle = product.name.toLowerCase();
    return spans.some(
        (span) =>
            span.id !== NO_SPAN &&
            span.text.toLowerCase() === needle &&
            original.slice(span.start, span.end).toLowerCase() === needle,
    );
}

export function refusePublicExecution(url) {
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
        throw new Error("public_site_execution_refused");
    }
    if (parsed.protocol !== "http:") {
        throw new Error("public_site_execution_refused");
    }
    return parsed;
}
