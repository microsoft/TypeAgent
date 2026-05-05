// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Standard-library tasks for IR v1 (decision 0006).
 *
 * These fill the "no expressions" gap: all computation goes through
 * registered tasks. The DSL lowers inline expressions to these.
 */

import { TaskDefinition } from "workflow-model";

export const intAdd: TaskDefinition<
    { a: number; b: number },
    { result: number }
> = {
    name: "int.add",
    inputSchema: {
        type: "object",
        required: ["a", "b"],
        properties: { a: { type: "integer" }, b: { type: "integer" } },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "integer" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.a + input.b } };
    },
};

export const intLessThan: TaskDefinition<
    { a: number; b: number },
    { result: boolean }
> = {
    name: "int.lessThan",
    inputSchema: {
        type: "object",
        required: ["a", "b"],
        properties: { a: { type: "integer" }, b: { type: "integer" } },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "boolean" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.a < input.b } };
    },
};

export const listLength: TaskDefinition<
    { list: unknown[] },
    { length: number }
> = {
    name: "list.length",
    inputSchema: {
        type: "object",
        required: ["list"],
        properties: { list: { type: "array" } },
    },
    outputSchema: {
        type: "object",
        required: ["length"],
        properties: { length: { type: "integer" } },
    },
    async execute(input) {
        return { kind: "ok", output: { length: input.list.length } };
    },
};

export const listElementAt: TaskDefinition<
    { list: unknown[]; index: number },
    { element: unknown }
> = {
    name: "list.elementAt",
    inputSchema: {
        type: "object",
        required: ["list", "index"],
        properties: {
            list: { type: "array" },
            index: { type: "integer" },
        },
    },
    outputSchema: {
        type: "object",
        required: ["element"],
        properties: { element: {} },
    },
    async execute(input) {
        return { kind: "ok", output: { element: input.list[input.index] } };
    },
};

export const listAppend: TaskDefinition<
    { list: unknown[]; item: unknown },
    { list: unknown[] }
> = {
    name: "list.append",
    inputSchema: {
        type: "object",
        required: ["list", "item"],
        properties: { list: { type: "array" }, item: {} },
    },
    outputSchema: {
        type: "object",
        required: ["list"],
        properties: { list: { type: "array" } },
    },
    async execute(input) {
        return { kind: "ok", output: { list: [...input.list, input.item] } };
    },
};

export const boolToLabel: TaskDefinition<
    { value: boolean; ifTrue: string; ifFalse: string },
    { label: string }
> = {
    name: "bool.toLabel",
    inputSchema: {
        type: "object",
        required: ["value", "ifTrue", "ifFalse"],
        properties: {
            value: { type: "boolean" },
            ifTrue: { type: "string" },
            ifFalse: { type: "string" },
        },
    },
    outputSchema: {
        type: "object",
        required: ["label"],
        properties: { label: { type: "string" } },
    },
    async execute(input) {
        return {
            kind: "ok",
            output: { label: input.value ? input.ifTrue : input.ifFalse },
        };
    },
};

/** All standard-library tasks as an array, for bulk registration. */
export const standardLibraryTasks: TaskDefinition[] = [
    intAdd,
    intLessThan,
    listLength,
    listElementAt,
    listAppend,
    boolToLabel,
];
