// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Built-in task schemas.
 *
 * This module declares just the JSON Schema shape (name, inputSchema,
 * outputSchema) of every built-in task. It is intentionally free of
 * any runtime dependency (`aiclient`, OpenAI SDK, child_process, ...)
 * so that tools that only need to inspect schemas — notably the
 * Workflow LSP — can import it without pulling in the engine's
 * runtime stack.
 *
 * The schemas here MUST stay in sync with the actual TaskDefinitions
 * exported from `./builtinTasks.ts`. A jest spec
 * (`builtinTaskSchemas.spec.ts`) asserts deep equality across all
 * task names and schemas; CI will fail on drift.
 */

import { JSONSchema } from "workflow-model";

export interface BuiltinTaskSchema {
    name: string;
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
}

// Names referenced from the DSL appear as `namespace.member`; keep
// the order matching `allBuiltinTasks` in builtinTasks.ts for easier
// diffing.

const BUILTIN_TASK_SCHEMAS: readonly BuiltinTaskSchema[] = [
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
        inputSchema: {
            type: "object",
            required: ["list", "index"],
            properties: {
                list: { type: "array" },
                index: { type: "integer" },
            },
        },
        outputSchema: {},
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
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: { type: "number" }, right: { type: "number" } },
        },
        outputSchema: { type: "number" },
    },
    {
        name: "math.subtract",
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: { type: "number" }, right: { type: "number" } },
        },
        outputSchema: { type: "number" },
    },
    {
        name: "math.multiply",
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: { type: "number" }, right: { type: "number" } },
        },
        outputSchema: { type: "number" },
    },
    {
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
        inputSchema: {
            type: "object",
            required: ["left", "right"],
            properties: { left: { type: "number" }, right: { type: "number" } },
        },
        outputSchema: { type: "number" },
    },
    {
        name: "math.negate",
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "number" } },
        },
        outputSchema: { type: "number" },
    },
    {
        name: "math.floor",
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "number" } },
        },
        outputSchema: { type: "integer" },
    },
    {
        name: "math.round",
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "number" } },
        },
        outputSchema: { type: "integer" },
    },
    {
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
            required: ["value"],
            properties: { value: {} },
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
        inputSchema: {
            type: "object",
            required: ["prompt"],
            properties: {
                prompt: { type: "string" },
                endpoint: { type: "string" },
            },
        },
        outputSchema: {},
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
    return BUILTIN_TASK_SCHEMAS.map((s) => ({
        name: s.name,
        inputSchema: s.inputSchema,
        outputSchema: s.outputSchema,
    }));
}
