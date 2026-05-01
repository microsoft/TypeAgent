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
 * input values.
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
        const result = template.replace(/\{(\w+)\}/g, (_match, key) => {
            const val = input[key];
            return val !== undefined ? String(val) : `{${key}}`;
        });
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
