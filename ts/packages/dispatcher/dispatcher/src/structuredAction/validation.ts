// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    StructuredActionPrompt,
    StructuredActionResponse,
} from "@typeagent/dispatcher-types";
import type { QuestionForm, TemplateSchema } from "@typeagent/agent-sdk";

export function object(
    value: unknown,
): asserts value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Expected an object");
    }
}

export function keys(
    value: Record<string, unknown>,
    allowed: readonly string[],
) {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key))
            throw new Error(`Unexpected field '${key}'`);
    }
}

export function nonempty(
    value: unknown,
    name: string,
): asserts value is string {
    if (typeof value !== "string" || value.trim().length === 0)
        throw new Error(`${name} must be a nonempty string`);
}

/** Reject non-wire values and externally supplied implicit binding syntax. */
export function validateJson(
    value: unknown,
    bindings = false,
    depth = 0,
): void {
    if (depth > 64) throw new Error("Input nesting exceeds 64 levels");
    if (typeof value === "string") {
        if (bindings && /\$\{(?:entity|result)-/.test(value))
            throw new Error(
                "External entity/result references are not supported",
            );
        return;
    }
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
        for (const item of value) validateJson(item, bindings, depth + 1);
        return;
    }
    object(value);
    // structuredClone and embedding hosts can supply objects from another realm.
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && Object.getPrototypeOf(prototype) !== null)
        throw new Error("Expected plain JSON data");
    for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(value),
    )) {
        if (!("value" in descriptor))
            throw new Error("Accessors are not supported");
        if (
            key === "__proto__" ||
            key === "constructor" ||
            key === "prototype" ||
            (bindings && key === "$result")
        )
            throw new Error(`Unsupported field '${key}'`);
        validateJson(descriptor.value, bindings, depth + 1);
    }
}

export function immutable<T>(value: T): T {
    const copy = structuredClone(value);
    const freeze = (item: unknown): void => {
        if (item !== null && typeof item === "object") {
            for (const child of Object.values(item)) freeze(child);
            Object.freeze(item);
        }
    };
    freeze(copy);
    return copy;
}

function index(value: unknown, count: number): asserts value is number {
    if (
        !Number.isSafeInteger(value) ||
        (value as number) < 0 ||
        (value as number) >= count
    )
        throw new Error("Choice index is out of range");
}

function indexes(value: unknown, count: number): void {
    if (!Array.isArray(value)) throw new Error("Expected choice indexes");
    if (new Set(value).size !== value.length)
        throw new Error("Duplicate choice indexes");
    for (const selected of value) index(selected, count);
}

function bool(value: unknown): void {
    if (typeof value !== "boolean")
        throw new Error("Expected a boolean response");
}

function validateForm(form: QuestionForm, value: unknown): void {
    object(value);
    keys(value, ["answers", "cancelled"]);
    if (value.cancelled !== undefined && value.cancelled !== false)
        throw new Error("Use cancelAction to cancel a form");
    object(value.answers);
    keys(
        value.answers,
        form.fields.map((field) => field.id),
    );
    for (const field of form.fields) {
        const answer = value.answers[field.id];
        object(answer);
        if (answer.kind !== field.kind)
            throw new Error(`Invalid answer kind for '${field.id}'`);
        if (field.kind === "yesNo") {
            keys(answer, ["kind", "value"]);
            bool(answer.value);
            continue;
        }
        keys(answer, ["kind", "selected", "text"]);
        if (answer.text !== undefined) {
            if (!field.allowFreeText)
                throw new Error("Free text is not permitted");
            nonempty(answer.text, "text");
        }
        if (field.kind === "pick") {
            if (answer.selected === -1) {
                if (!field.allowFreeText)
                    throw new Error("A choice is required");
                nonempty(answer.text, "text");
            } else {
                index(answer.selected, field.choices.length);
                if (answer.text !== undefined)
                    throw new Error("Free text requires selected -1");
            }
        } else {
            indexes(answer.selected, field.choices.length);
        }
    }
}

export function validateResponse(
    prompt: StructuredActionPrompt,
    value: unknown,
): asserts value is StructuredActionResponse {
    object(value);
    if (value.type !== prompt.type)
        throw new Error("Response does not match the pending prompt");
    switch (prompt.type) {
        case "confirmation":
            keys(value, ["type", "approved"]);
            bool(value.approved);
            break;
        case "question":
            keys(value, ["type", "selected"]);
            index(value.selected, prompt.choices.length);
            break;
        case "yesNo":
            keys(value, ["type", "value"]);
            bool(value.value);
            break;
        case "multiChoice":
            keys(value, ["type", "selected"]);
            indexes(value.selected, prompt.choices.length);
            break;
        case "pickRemember":
            keys(value, ["type", "selected", "remember"]);
            index(value.selected, prompt.choices.length);
            bool(value.remember);
            break;
        case "form":
            keys(value, ["type", "value"]);
            validateForm(prompt, value.value);
            break;
        case "proposal":
            keys(value, ["type", "accepted", "data"]);
            bool(value.accepted);
            if (value.accepted) {
                validateJson(value.data, true);
                const templates = prompt.templates.templateData;
                if (Array.isArray(templates)) {
                    if (!Array.isArray(value.data) || value.data.length > 100)
                        throw new Error(
                            "Expected at most 100 proposed actions",
                        );
                    for (let i = 0; i < value.data.length; i++) {
                        validateTemplate(
                            templates[i]?.schema ?? prompt.schema,
                            value.data[i],
                        );
                    }
                } else {
                    validateTemplate(templates.schema, value.data);
                }
            } else if (value.data !== undefined)
                throw new Error("Rejected proposal cannot contain data");
            break;
    }
}

function validateTemplate(schema: TemplateSchema, value: unknown): void {
    // Implemented against the SDK's declarative template fields, not a model.
    validateTemplateField(schema, value);
}

function validateTemplateField(schema: unknown, value: unknown): void {
    object(schema);
    const field = schema as unknown as Record<string, unknown>;
    if (field.type === "object") {
        object(value);
        object(field.fields);
        keys(value, Object.keys(field.fields));
        for (const [name, child] of Object.entries(field.fields)) {
            object(child);
            if (value[name] === undefined && child.optional === true) continue;
            validateTemplateField(child.type, value[name]);
        }
    } else if (field.type === "array") {
        if (!Array.isArray(value)) throw new Error("Expected an array");
        for (const item of value)
            validateTemplateField(field.elementType, item);
    } else if (field.type === "string-union") {
        if (
            typeof value !== "string" ||
            !Array.isArray(field.typeEnum) ||
            !field.typeEnum.includes(value)
        )
            throw new Error("Invalid proposal discriminator");
    } else if (
        field.type === "string" ||
        field.type === "number" ||
        field.type === "boolean"
    ) {
        if (typeof value !== field.type)
            throw new Error(`Expected ${field.type}`);
    } else {
        throw new Error("Unsupported proposal field schema");
    }
}
