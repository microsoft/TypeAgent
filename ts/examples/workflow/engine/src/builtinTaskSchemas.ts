// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Built-in task schemas — single source of truth.
 *
 * This module declares just the JSON Schema shape (name, inputSchema,
 * outputSchema) of every built-in task. It is intentionally free of
 * any runtime dependency (`aiclient`, OpenAI SDK, child_process, ...)
 * so that tools that only need to inspect schemas — notably the
 * Workflow LSP — can import it without pulling in the engine's
 * runtime stack.
 *
 * `builtinTasks.ts` imports from here via `BUILTIN_TASK_SCHEMAS` so
 * there is exactly one place where schemas are declared.
 */

import { JSONSchema, SchemaTemplate } from "workflow-model";

/**
 * Declares a generic type parameter on a task.
 * When `default` is present the type arg is optional at call sites;
 * when absent, the caller MUST supply `<T>`.
 *
 * Substitution sites are marked inline in the schema with
 * `{ "$typeParam": "<name>" }`. A single parameter may appear in
 * multiple positions (both input and output schemas).
 */
export interface TypeParameterDef {
    /** Parameter name (e.g. "T"). */
    name: string;
    /** Schema used when the caller omits the type argument. If absent
     *  the type argument is required. */
    default?: JSONSchema;
}

/** A non-generic builtin task schema declaration. */
export interface ConcreteBuiltinTaskSchema {
    name: string;
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
}

/** A generic builtin task schema declaration with type parameters. */
export interface GenericBuiltinTaskSchema {
    name: string;
    inputSchema: SchemaTemplate;
    outputSchema: SchemaTemplate;
    typeParameters: TypeParameterDef[];
}

export type BuiltinTaskSchema =
    | ConcreteBuiltinTaskSchema
    | GenericBuiltinTaskSchema;

/** Type guard: narrows a BuiltinTaskSchema to its generic variant. */
export function isGenericBuiltinSchema(
    schema: BuiltinTaskSchema,
): schema is GenericBuiltinTaskSchema {
    return "typeParameters" in schema;
}

// Names referenced from the DSL appear as `namespace.member`; keep
// the order matching `allBuiltinTasks` in builtinTasks.ts for easier
// diffing.

export const BUILTIN_TASK_SCHEMAS: readonly BuiltinTaskSchema[] = [
    // ---- standard library ----
    {
        name: "list.length",
        inputSchema: {
            type: "object",
            required: ["list"],
            properties: { list: { type: "array" } },
        },
        outputSchema: { type: "integer" },
    },
    {
        name: "list.elementAt",
        typeParameters: [{ name: "T", default: {} }],
        inputSchema: {
            type: "object",
            required: ["list", "index"],
            properties: {
                list: { type: "array", items: { $typeParam: "T" } },
                index: { type: "integer" },
            },
        },
        outputSchema: { $typeParam: "T" },
    },
    {
        name: "list.append",
        inputSchema: {
            type: "object",
            required: ["list", "item"],
            properties: { list: { type: "array" }, item: {} },
        },
        outputSchema: { type: "array" },
    },
    {
        name: "compare.equals",
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: {}, right: {} },
        },
        outputSchema: { type: "boolean" },
    },
    {
        name: "compare.notEquals",
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: {}, right: {} },
        },
        outputSchema: { type: "boolean" },
    },
    {
        name: "compare.greaterThan",
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: { type: "number" }, right: { type: "number" } },
        },
        outputSchema: { type: "boolean" },
    },
    {
        name: "compare.lessThan",
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: { type: "number" }, right: { type: "number" } },
        },
        outputSchema: { type: "boolean" },
    },
    {
        name: "compare.greaterOrEqual",
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: { type: "number" }, right: { type: "number" } },
        },
        outputSchema: { type: "boolean" },
    },
    {
        name: "compare.lessOrEqual",
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: { type: "number" }, right: { type: "number" } },
        },
        outputSchema: { type: "boolean" },
    },
    {
        name: "bool.not",
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "boolean" } },
        },
        outputSchema: { type: "boolean" },
    },
    {
        name: "math.add",
        typeParameters: [{ name: "N", default: { type: "number" } }],
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: {
                left: { $typeParam: "N" },
                right: { $typeParam: "N" },
            },
        },
        outputSchema: { $typeParam: "N" },
    },
    {
        name: "math.subtract",
        typeParameters: [{ name: "N", default: { type: "number" } }],
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: {
                left: { $typeParam: "N" },
                right: { $typeParam: "N" },
            },
        },
        outputSchema: { $typeParam: "N" },
    },
    {
        name: "math.multiply",
        typeParameters: [{ name: "N", default: { type: "number" } }],
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: {
                left: { $typeParam: "N" },
                right: { $typeParam: "N" },
            },
        },
        outputSchema: { $typeParam: "N" },
    },
    {
        // Not generic: integer / integer can yield non-integer (1 / 2 = 0.5).
        name: "math.divide",
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: { type: "number" }, right: { type: "number" } },
        },
        outputSchema: { type: "number" },
    },
    {
        name: "math.modulo",
        typeParameters: [{ name: "N", default: { type: "number" } }],
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: {
                left: { $typeParam: "N" },
                right: { $typeParam: "N" },
            },
        },
        outputSchema: { $typeParam: "N" },
    },
    {
        name: "math.negate",
        typeParameters: [{ name: "N", default: { type: "number" } }],
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { $typeParam: "N" } },
        },
        outputSchema: { $typeParam: "N" },
    },
    {
        // Not generic: output is always integer, regardless of input subtype.
        name: "math.floor",
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "number" } },
        },
        outputSchema: { type: "integer" },
    },
    {
        // Not generic: output is always integer, regardless of input subtype.
        name: "math.round",
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "number" } },
        },
        outputSchema: { type: "integer" },
    },
    {
        // Not generic: output is always integer, regardless of input subtype.
        name: "math.ceil",
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "number" } },
        },
        outputSchema: { type: "integer" },
    },
    {
        name: "error.fail",
        inputSchema: {
            type: "object",
            required: ["message"],
            properties: { message: {} },
        },
        outputSchema: { not: {} },
    },
    {
        name: "noop",
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object", properties: {} },
    },
    {
        name: "identity",
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: {} },
        },
        outputSchema: {},
    },
    // ---- everything else (bool.toLabel, IO, utility) ----
    {
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
        outputSchema: { type: "string" },
    },
    {
        name: "shell.exec",
        inputSchema: {
            type: "object",
            required: ["command"],
            properties: {
                command: { type: "string" },
                args: { type: "array", items: { type: "string" } },
                cwd: { type: "string" },
                maxBuffer: {
                    type: "integer",
                    description: "Max stdout+stderr in bytes (default 1MB)",
                },
            },
        },
        outputSchema: {
            type: "object",
            required: ["stdout", "stderr", "exitCode"],
            properties: {
                stdout: { type: "string" },
                stderr: { type: "string" },
                exitCode: { type: "integer" },
            },
        },
    },
    {
        name: "llm.generate",
        inputSchema: {
            type: "object",
            required: ["prompt"],
            properties: {
                prompt: { type: "string" },
                endpoint: { type: "string" },
            },
        },
        outputSchema: { type: "string" },
    },
    {
        name: "llm.generateJson",
        typeParameters: [{ name: "T", default: {} }],
        inputSchema: {
            type: "object",
            required: ["prompt"],
            properties: {
                prompt: { type: "string" },
                endpoint: { type: "string" },
            },
        },
        outputSchema: { $typeParam: "T" },
    },
    {
        name: "http.get",
        inputSchema: {
            type: "object",
            required: ["url"],
            properties: {
                url: { type: "string" },
                headers: { type: "object" },
                maxResponseBytes: {
                    type: "integer",
                    description:
                        "Max response body size in bytes (default 10MB). Responses larger than this are truncated.",
                },
            },
        },
        outputSchema: {
            type: "object",
            required: ["body", "status"],
            properties: {
                body: { type: "string" },
                status: { type: "integer" },
            },
        },
    },
    {
        name: "file.read",
        inputSchema: {
            type: "object",
            required: ["path"],
            properties: {
                path: { type: "string" },
                maxBytes: {
                    type: "integer",
                    description: "Max file size in bytes (default 10MB)",
                },
            },
        },
        outputSchema: { type: "string" },
    },
    {
        name: "file.write",
        inputSchema: {
            type: "object",
            required: ["path", "content"],
            properties: {
                path: { type: "string" },
                content: { type: "string" },
            },
        },
        outputSchema: { type: "string" },
    },
    {
        name: "text.template",
        inputSchema: {
            type: "object",
            required: ["template", "vars"],
            properties: {
                template: { type: "string" },
                vars: { type: "object" },
            },
        },
        outputSchema: { type: "string" },
    },
    {
        name: "string.join",
        inputSchema: {
            type: "object",
            required: ["list", "delimiter"],
            properties: {
                list: { type: "array", items: { type: "string" } },
                delimiter: { type: "string" },
            },
        },
        outputSchema: { type: "string" },
    },
    {
        name: "string.split",
        inputSchema: {
            type: "object",
            required: ["text", "delimiter"],
            properties: {
                text: { type: "string" },
                delimiter: { type: "string" },
                keepEmpty: {
                    type: "boolean",
                    description:
                        "Keep empty strings in the result (default: false).",
                },
            },
        },
        outputSchema: { type: "array", items: { type: "string" } },
    },
];

/**
 * Returns the schemas (name + input/output JSON Schema) of all
 * built-in tasks. Safe to import from environments that cannot pull
 * in the engine's runtime dependencies.
 */
export function getBuiltinTaskSchemas(): BuiltinTaskSchema[] {
    return [...BUILTIN_TASK_SCHEMAS];
}
