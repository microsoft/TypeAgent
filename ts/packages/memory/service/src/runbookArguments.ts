// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { redactRunbookValue } from "./runbookRedaction.js";

export type RunbookJsonValue =
    | null
    | boolean
    | number
    | string
    | RunbookJsonValue[]
    | { [key: string]: RunbookJsonValue };

export interface RunbookInputReference {
    $input: string;
}

export interface RunbookLiteralArgument {
    $literal: RunbookJsonValue;
}

export type RunbookArgumentValue =
    | null
    | boolean
    | number
    | string
    | RunbookInputReference
    | RunbookLiteralArgument
    | RunbookArgumentValue[]
    | { [key: string]: RunbookArgumentValue };

export type RunbookBindingArguments = Record<string, RunbookArgumentValue>;

export const runbookArgumentLimits = {
    maxDepth: 16,
    maxNodes: 10_000,
    maxStringLength: 64 * 1024,
    maxEncodedBytes: 128 * 1024,
} as const;

interface ArgumentInspection {
    nodes: number;
    characters: number;
    ancestors: Set<object>;
    references: Set<string>;
    redacted: boolean;
}

function account(
    inspection: ArgumentInspection,
    characters: number,
    depth: number,
): void {
    inspection.nodes++;
    inspection.characters += characters;
    if (
        depth > runbookArgumentLimits.maxDepth ||
        inspection.nodes > runbookArgumentLimits.maxNodes ||
        inspection.characters > runbookArgumentLimits.maxEncodedBytes
    ) {
        throw new Error("Runbook binding arguments exceed JSON limits");
    }
}

function inspectText(value: string, inspection: ArgumentInspection): void {
    if (value.length > runbookArgumentLimits.maxStringLength) {
        throw new Error("Runbook argument string exceeds JSON limits");
    }
    inspection.characters += value.length;
    if (value.includes("[REDACTED]")) inspection.redacted = true;
}

function hasJsonPrototype(
    value: object,
    expectedConstructor: ObjectConstructor | ArrayConstructor,
): boolean {
    const prototype: object | null = Object.getPrototypeOf(value);
    if (prototype === null) return true;
    const constructor: unknown = Object.getOwnPropertyDescriptor(
        prototype,
        "constructor",
    )?.value;
    // Structured cloning and browser frames can supply another realm's native prototypes.
    return (
        typeof constructor === "function" &&
        Object.getOwnPropertyDescriptor(constructor, "prototype")?.value ===
            prototype &&
        Function.prototype.toString.call(constructor) ===
            Function.prototype.toString.call(expectedConstructor)
    );
}

function objectEntries(value: object): Array<[string, unknown]> {
    if (!hasJsonPrototype(value, Object)) {
        throw new Error("Runbook arguments must contain plain JSON objects");
    }
    const keys = Object.getOwnPropertyNames(value);
    if (
        keys.length > runbookArgumentLimits.maxNodes ||
        Object.getOwnPropertySymbols(value).length !== 0
    ) {
        throw new Error("Runbook argument object exceeds JSON limits");
    }
    return keys.map((key): [string, unknown] => {
        if (
            key.length > 200 ||
            ["__proto__", "constructor", "prototype"].includes(key)
        ) {
            throw new Error("Unsupported runbook argument key");
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
            descriptor === undefined ||
            !descriptor.enumerable ||
            descriptor.get !== undefined ||
            descriptor.set !== undefined
        ) {
            throw new Error(
                "Runbook arguments cannot contain accessors or hidden fields",
            );
        }
        return [key, descriptor.value];
    });
}

function inspectReference(
    entries: Array<[string, unknown]>,
    inspection: ArgumentInspection,
    depth: number,
): boolean {
    const reference = entries.find(([key]) => key === "$input");
    if (reference === undefined) return false;
    if (
        entries.length !== 1 ||
        typeof reference[1] !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(reference[1])
    ) {
        throw new Error(
            "Symbolic runbook argument must be exactly {$input: inputId}",
        );
    }
    inspection.references.add(reference[1]);
    account(inspection, 1, depth + 1);
    inspectText(reference[1], inspection);
    return true;
}

function inspectObject(
    value: object,
    inspection: ArgumentInspection,
    depth: number,
    symbolic: boolean,
): void {
    const entries = objectEntries(value);
    inspection.characters += entries.reduce(
        (sum, [key]) => sum + key.length,
        0,
    );
    if (symbolic && inspectReference(entries, inspection, depth)) return;
    const literal = symbolic
        ? entries.find(([key]) => key === "$literal")
        : undefined;
    if (literal !== undefined) {
        if (entries.length !== 1) {
            throw new Error(
                "Literal runbook argument escape cannot have additional fields",
            );
        }
        inspectValue(literal[1], inspection, depth + 1, false);
        return;
    }
    for (const [, child] of entries)
        inspectValue(child, inspection, depth + 1, symbolic);
}

function inspectArray(
    value: unknown[],
    inspection: ArgumentInspection,
    depth: number,
    symbolic: boolean,
): void {
    if (
        !hasJsonPrototype(value, Array) ||
        value.length > runbookArgumentLimits.maxNodes ||
        Object.getOwnPropertyNames(value).length !== value.length + 1 ||
        Object.getOwnPropertySymbols(value).length !== 0
    ) {
        throw new Error(
            "Runbook arguments cannot contain sparse or extended arrays",
        );
    }
    for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(
            value,
            String(index),
        );
        if (
            descriptor === undefined ||
            descriptor.get !== undefined ||
            descriptor.set !== undefined
        ) {
            throw new Error("Runbook arguments cannot contain array accessors");
        }
        inspectValue(descriptor.value, inspection, depth + 1, symbolic);
    }
}

function inspectValue(
    value: unknown,
    inspection: ArgumentInspection,
    depth: number,
    symbolic: boolean,
): void {
    account(inspection, 1, depth);
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "string") {
        inspectText(value, inspection);
        return;
    }
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || value === null) {
        throw new Error("Runbook arguments must contain finite JSON values");
    }
    if (inspection.ancestors.has(value)) {
        throw new Error("Runbook arguments cannot contain cyclic JSON");
    }
    inspection.ancestors.add(value);
    if (Array.isArray(value)) inspectArray(value, inspection, depth, symbolic);
    else inspectObject(value, inspection, depth, symbolic);
    inspection.ancestors.delete(value);
}

function inspectArguments(value: unknown): ArgumentInspection {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Runbook binding arguments must be a JSON object");
    }
    const inspection: ArgumentInspection = {
        nodes: 0,
        characters: 0,
        ancestors: new Set([value]),
        references: new Set(),
        redacted: false,
    };
    account(inspection, 1, 0);
    for (const [key, child] of objectEntries(value)) {
        inspection.characters += key.length;
        inspectValue(child, inspection, 1, true);
    }
    if (
        new TextEncoder().encode(JSON.stringify(value)).byteLength >
        runbookArgumentLimits.maxEncodedBytes
    ) {
        throw new Error("Runbook binding arguments exceed encoded JSON limits");
    }
    return inspection;
}

export function validateRunbookBindingArguments(
    value: unknown,
    inputs?: readonly { id: string }[],
): asserts value is RunbookBindingArguments {
    const inspection = inspectArguments(value);
    if (inputs !== undefined) validateReferences(inspection, inputs);
}

function validateReferences(
    inspection: ArgumentInspection,
    inputs: readonly { id: string }[],
): void {
    const known = new Set(inputs.map((input) => input.id));
    if ([...inspection.references].some((id) => !known.has(id))) {
        throw new Error(
            "Runbook argument references an undeclared procedure input",
        );
    }
}

export function getRunbookArgumentReferences(
    value: RunbookBindingArguments,
): string[] {
    return [...inspectArguments(value).references];
}

export function validateRunbookArgumentReadiness(
    value: RunbookBindingArguments,
    inputs: readonly { id: string }[],
): void {
    const inspection = inspectArguments(value);
    validateReferences(inspection, inputs);
    if (inspection.redacted) {
        throw new Error(
            "Redacted argument literals require declared input references",
        );
    }
}

export function isRunbookInputReference(
    value: unknown,
): value is RunbookInputReference {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const keys = Object.keys(value);
    const input: unknown = Object.getOwnPropertyDescriptor(
        value,
        "$input",
    )?.value;
    return (
        keys.length === 1 &&
        keys[0] === "$input" &&
        typeof input === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(input)
    );
}

export function isRunbookLiteralArgument(
    value: unknown,
): value is RunbookLiteralArgument {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const keys = Object.keys(value);
    return keys.length === 1 && keys[0] === "$literal";
}

export function normalizeRunbookBindingArguments(
    value: RunbookBindingArguments,
    secretLiterals: readonly string[] = [],
): RunbookBindingArguments {
    validateRunbookBindingArguments(value);
    const normalized = redactRunbookValue(value, 0, secretLiterals, true);
    validateRunbookBindingArguments(normalized);
    return normalized;
}
