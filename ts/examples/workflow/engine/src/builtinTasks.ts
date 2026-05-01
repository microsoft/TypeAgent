// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TaskDefinition } from "workflow-model";

/**
 * A task that passes its input through as output.
 */
export const passthroughTask: TaskDefinition = {
    name: "passthrough",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    async execute(input) {
        return { kind: "ok", output: input };
    },
};

/**
 * A task that builds a string from a template and named values.
 * Input: { template: string, ...values }
 * Output: { result: string }
 *
 * Replaces `{key}` placeholders in the template with the corresponding
 * input values. Keys may use dot notation (`{a.b}`) or bracket notation
 * (`{items[0]}`) to reach nested fields and array elements.
 */
export const stringTemplateTask: TaskDefinition<
    Record<string, unknown>,
    { result: string }
> = {
    name: "string.template",
    inputSchema: {
        type: "object",
        properties: {
            template: { type: "string" },
        },
        required: ["template"],
    },
    outputSchema: {
        type: "object",
        properties: {
            result: { type: "string" },
        },
        required: ["result"],
    },
    async execute(input) {
        const template = input.template as string;
        const result = template.replace(
            /\{([^}]+)\}/g,
            (_match, keyPath: string) => {
                const val = resolveTemplatePath(input, keyPath);
                return val !== undefined ? String(val) : `{${keyPath}}`;
            },
        );
        return { kind: "ok", output: { result } };
    },
};

/**
 * A task that logs its input and returns it unchanged.
 * Useful for error handlers and debugging.
 */
export const logTask: TaskDefinition = {
    name: "log.error",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    async execute(input, ctx) {
        ctx.log("error", "Error handler invoked", input);
        return { kind: "ok", output: input };
    },
};

/**
 * A generic threshold-based branch task.
 * Input: { value: number, threshold?: number }
 * Returns branch "high" if value >= threshold (default 0.5), else "low".
 */
export const thresholdBranchTask: TaskDefinition<
    { value: number; threshold?: number },
    { value: number }
> = {
    name: "threshold.branch",
    inputSchema: {
        type: "object",
        properties: {
            value: { type: "number" },
            threshold: { type: "number" },
        },
        required: ["value"],
    },
    outputSchema: {
        type: "object",
        properties: {
            value: { type: "number" },
        },
    },
    branchLabels: ["high", "low"],
    async execute(input) {
        const threshold = input.threshold ?? 0.5;
        const branch = input.value >= threshold ? "high" : "low";
        return { kind: "branch", branch, output: { value: input.value } };
    },
};

/**
 * Parse a template key path like `a.b`, `items[0]`, or `a[0].b` into
 * segments and traverse the object. Supports dot notation and bracket
 * notation for both object keys and array indices.
 */
function resolveTemplatePath(
    obj: Record<string, unknown>,
    path: string,
): unknown {
    // Split on `.` and `[`, keeping bracket contents.
    // "a.b[0].c" -> ["a", "b", "0", "c"]
    const segments = path.split(/[.[\]]+/).filter((s) => s.length > 0);
    let current: unknown = obj;
    for (const seg of segments) {
        if (current == null || typeof current !== "object") {
            return undefined;
        }
        // Array index or object key
        if (Array.isArray(current)) {
            const idx = Number(seg);
            if (Number.isNaN(idx)) {
                return undefined;
            }
            current = current[idx];
        } else {
            current = (current as Record<string, unknown>)[seg];
        }
    }
    return current;
}
