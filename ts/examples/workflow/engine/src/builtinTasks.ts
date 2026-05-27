// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Builtin tasks for IR v1.
 *
 * Standard-library tasks (decision 0006) fill the "no expressions" gap:
 * all computation goes through registered tasks.
 *
 * IO tasks (shell.exec, etc.) provide real-world capabilities.
 * Utility tasks (text.template, string.join, etc.) shape data.
 */

import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { homedir, tmpdir } from "node:os";
import {
    JSONSchema,
    TaskDefinition,
    ConcreteTaskDefinition,
    GenericTaskDefinition,
    TaskTypeParameter,
} from "workflow-model";
import { isGenericBuiltinSchema } from "./builtinTaskSchemas.js";
import { openai } from "aiclient";
import { BUILTIN_TASK_SCHEMAS } from "./builtinTaskSchemas.js";

const SCHEMA_BY_NAME = new Map(
    BUILTIN_TASK_SCHEMAS.map((s) => [s.name, s] as const),
);

type ConcreteSchemaFields = Pick<
    ConcreteTaskDefinition,
    "name" | "inputSchema" | "outputSchema"
>;
type GenericSchemaFields = Pick<
    GenericTaskDefinition,
    "name" | "inputSchemaTemplate" | "outputSchemaTemplate" | "typeParameters"
>;

/**
 * Look up a non-generic task's schema from `builtinTaskSchemas.ts`.
 */
function taskSchema(name: string): ConcreteSchemaFields {
    const s = SCHEMA_BY_NAME.get(name);
    if (!s) {
        throw new Error(
            `No schema declared for builtin task '${name}' in builtinTaskSchemas.ts`,
        );
    }
    if (isGenericBuiltinSchema(s)) {
        throw new Error(
            `Task '${name}' has type parameters; use genericTaskSchema() instead`,
        );
    }
    return {
        name: s.name,
        inputSchema: s.inputSchema,
        outputSchema: s.outputSchema,
    };
}

/**
 * Look up a generic task's schema from `builtinTaskSchemas.ts`.
 * Returns the template and type parameter metadata.
 */
function genericTaskSchema(name: string): GenericSchemaFields {
    const s = SCHEMA_BY_NAME.get(name);
    if (!s) {
        throw new Error(
            `No schema declared for builtin task '${name}' in builtinTaskSchemas.ts`,
        );
    }
    if (!isGenericBuiltinSchema(s)) {
        throw new Error(
            `Task '${name}' has no type parameters; use taskSchema() instead`,
        );
    }
    const typeParameters: TaskTypeParameter[] = s.typeParameters.map((p) => ({
        name: p.name,
        ...(p.default ? { default: p.default } : {}),
    }));
    return {
        name: s.name,
        inputSchemaTemplate: s.inputSchema,
        outputSchemaTemplate: s.outputSchema,
        typeParameters,
    };
}

/**
 * Recursively enforce OpenAI structured output requirements on a schema:
 * - `additionalProperties: false` on every object
 * - `required` must list every key in `properties`
 * Returns a deep copy; the original schema is not mutated.
 */
function sealObjects(schema: JSONSchema): JSONSchema {
    const copy = { ...schema };
    if (copy.type === "object" || copy.properties) {
        copy.additionalProperties = false;
        if (copy.properties) {
            const sealed: Record<string, JSONSchema> = {};
            for (const [key, sub] of Object.entries(copy.properties)) {
                if (typeof sub !== "boolean") {
                    sealed[key] = sealObjects(sub);
                }
            }
            copy.properties = sealed;
            copy.required = Object.keys(sealed);
        }
    }
    if (
        copy.items &&
        typeof copy.items !== "boolean" &&
        !Array.isArray(copy.items)
    ) {
        copy.items = sealObjects(copy.items);
    }
    for (const kw of ["oneOf", "anyOf", "allOf"] as const) {
        if (Array.isArray(copy[kw])) {
            copy[kw] = (copy[kw] as JSONSchema[]).map(sealObjects);
        }
    }
    return copy;
}

export const listLength: TaskDefinition<{ list: unknown[] }, number> = {
    ...taskSchema("list.length"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.list.length };
    },
};

export const listElementAt: TaskDefinition<
    { list: unknown[]; index: number },
    unknown
> = {
    ...genericTaskSchema("list.elementAt"),
    sideEffects: false,
    async execute(input) {
        if (input.index < 0 || input.index >= input.list.length) {
            return {
                kind: "fail",
                error: {
                    message: `Index ${input.index} out of bounds for list of length ${input.list.length}`,
                },
            };
        }
        return { kind: "ok", output: input.list[input.index] };
    },
};

export const listAppend: TaskDefinition<
    { list: unknown[]; item: unknown },
    unknown[]
> = {
    ...taskSchema("list.append"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: [...input.list, input.item] };
    },
};

export const boolToLabel: TaskDefinition<
    { value: boolean; ifTrue: string; ifFalse: string },
    string
> = {
    ...taskSchema("bool.toLabel"),
    sideEffects: false,
    async execute(input) {
        return {
            kind: "ok",
            output: input.value ? input.ifTrue : input.ifFalse,
        };
    },
};

// ---- IO tasks ----

export const shellExec: TaskDefinition<
    {
        command: string;
        args?: string[];
        cwd?: string;
        maxBuffer?: number;
    },
    { stdout: string; stderr: string; exitCode: number }
> = {
    ...taskSchema("shell.exec"),
    sideEffects: true,
    async execute(input, ctx) {
        const { command, args = [], cwd } = input;
        const maxBuffer = input.maxBuffer ?? 1024 * 1024; // 1MB default

        // Enforce allowedCommands constraint
        const allowed = ctx.constraints?.allowedCommands;
        if (allowed && !allowed.includes(command)) {
            return {
                kind: "fail",
                error: {
                    message: `Command "${command}" is not in the allowed commands list`,
                },
            };
        }

        return new Promise((resolve) => {
            execFile(
                command,
                args,
                {
                    cwd,
                    maxBuffer,
                    encoding: "utf8",
                    signal: ctx.signal,
                },
                (error, stdout, stderr) => {
                    if (!error) {
                        resolve({
                            kind: "ok",
                            output: { stdout, stderr, exitCode: 0 },
                        });
                        return;
                    }
                    // Abort / kill
                    if (error.name === "AbortError" || (error as any).killed) {
                        resolve({
                            kind: "fail",
                            error: { message: "Command cancelled or killed" },
                        });
                        return;
                    }
                    // Non-zero exit: process ran but returned non-zero
                    if (typeof error.code === "number") {
                        resolve({
                            kind: "ok",
                            output: {
                                stdout: stdout ?? "",
                                stderr: stderr ?? "",
                                exitCode: error.code,
                            },
                        });
                        return;
                    }
                    // Spawn failure (ENOENT, EACCES, etc.)
                    resolve({
                        kind: "fail",
                        error: { message: error.message },
                    });
                },
            );
        });
    },
};

export const llmGenerate: TaskDefinition<
    { prompt: string; endpoint?: string },
    string
> = {
    ...taskSchema("llm.generate"),
    sideEffects: true,
    async execute(input, ctx) {
        ctx?.signal?.throwIfAborted();
        let model;
        try {
            model = openai.createChatModel(input.endpoint);
        } catch (err) {
            return {
                kind: "fail",
                error: {
                    message: err instanceof Error ? err.message : String(err),
                },
            };
        }
        const result = await model.complete(input.prompt);
        if (!result.success) {
            return {
                kind: "fail",
                error: { message: result.message },
            };
        }
        return { kind: "ok", output: result.data };
    },
};

export const llmGenerateJson: GenericTaskDefinition<
    { prompt: string; endpoint?: string },
    unknown
> = {
    ...genericTaskSchema("llm.generateJson"),
    sideEffects: true,
    async execute(input, ctx) {
        ctx?.signal?.throwIfAborted();
        let model;
        try {
            model = openai.createJsonChatModel(input.endpoint);
        } catch (err) {
            return {
                kind: "fail",
                error: {
                    message: err instanceof Error ? err.message : String(err),
                },
            };
        }
        // Derive structured output schema from the node's outputSchema if
        // it declares a non-opaque schema.
        const outSchema = ctx.outputSchema;
        const jsonSchema =
            outSchema &&
                typeof outSchema !== "boolean" &&
                Object.keys(outSchema).length > 0
                ? {
                    name: "response",
                    strict: true as const,
                    schema: sealObjects(outSchema) as Record<string, unknown>,
                }
                : undefined;
        const result = await model.complete(
            input.prompt,
            undefined,
            jsonSchema,
        );
        if (!result.success) {
            return {
                kind: "fail",
                error: { message: result.message },
            };
        }
        try {
            const value = JSON.parse(result.data);
            return { kind: "ok", output: value };
        } catch (parseErr) {
            return {
                kind: "fail",
                error: {
                    message: `Failed to parse LLM JSON response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
                },
            };
        }
    },
};

// ---- Utility tasks ----

export const textTemplate: TaskDefinition<
    { template: string; vars: Record<string, unknown> },
    string
> = {
    ...taskSchema("text.template"),
    sideEffects: false,
    async execute(input) {
        let text = input.template;
        for (const [key, value] of Object.entries(input.vars)) {
            text = text.replaceAll(`{{${key}}}`, String(value));
        }
        return { kind: "ok", output: text };
    },
};

export const stringJoin: TaskDefinition<
    { list: string[]; delimiter: string },
    string
> = {
    ...taskSchema("string.join"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.list.join(input.delimiter) };
    },
};

export const stringSplit: TaskDefinition<
    { text: string; delimiter: string; keepEmpty?: boolean },
    string[]
> = {
    ...taskSchema("string.split"),
    sideEffects: false,
    async execute(input) {
        const list = input.text.split(input.delimiter);
        return {
            kind: "ok",
            output: input.keepEmpty ? list : list.filter((s) => s.length > 0),
        };
    },
};

export const httpGet: TaskDefinition<
    {
        url: string;
        headers?: Record<string, string>;
        maxResponseBytes?: number;
    },
    { body: string; status: number }
> = {
    ...taskSchema("http.get"),
    sideEffects: true,
    async execute(input, ctx) {
        const maxBytes = input.maxResponseBytes ?? 10 * 1024 * 1024; // 10MB
        try {
            // Validate URL to prevent SSRF against internal services.
            const parsed = new URL(input.url);
            const hostname = parsed.hostname?.toLowerCase();
            if (
                hostname === "localhost" ||
                hostname === "127.0.0.1" ||
                hostname === "::1" ||
                hostname === "0.0.0.0" ||
                hostname === "169.254.169.254" ||
                hostname === "[::1]" ||
                hostname?.startsWith("10.") ||
                hostname?.startsWith("192.168.") ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(hostname ?? "") ||
                hostname?.endsWith(".internal") ||
                parsed.protocol === "file:"
            ) {
                return {
                    kind: "fail",
                    error: {
                        message: `URL "${input.url}" references a private or reserved address`,
                    },
                };
            }

            // Enforce caller-supplied blockedHosts
            const blocked = ctx.constraints?.blockedHosts;
            if (
                blocked &&
                hostname &&
                blocked.some(
                    (h) =>
                        hostname === h.toLowerCase() ||
                        hostname.endsWith("." + h.toLowerCase()),
                )
            ) {
                return {
                    kind: "fail",
                    error: {
                        message: `Host "${hostname}" is blocked by caller constraints`,
                    },
                };
            }

            // Enforce caller-supplied allowedHosts (allowlist overrides)
            const allowedHosts = ctx.constraints?.allowedHosts;
            if (allowedHosts && hostname) {
                const isAllowed = allowedHosts.some(
                    (h) =>
                        hostname === h.toLowerCase() ||
                        hostname.endsWith("." + h.toLowerCase()),
                );
                if (!isAllowed) {
                    return {
                        kind: "fail",
                        error: {
                            message: `Host "${hostname}" is not in the allowed hosts list`,
                        },
                    };
                }
            }

            const resp = await fetch(input.url, {
                ...(input.headers ? { headers: input.headers } : {}),
                signal: ctx.signal,
            });
            // Stream the body to enforce the size limit.
            const reader = resp.body?.getReader();
            if (!reader) {
                const body = await resp.text();
                return { kind: "ok", output: { body, status: resp.status } };
            }
            const chunks: Uint8Array[] = [];
            let totalBytes = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                totalBytes += value.byteLength;
                if (totalBytes > maxBytes) {
                    reader.cancel();
                    return {
                        kind: "fail",
                        error: {
                            message: `Response exceeded maximum size of ${maxBytes} bytes`,
                        },
                    };
                }
                chunks.push(value);
            }
            const decoder = new TextDecoder();
            const body =
                chunks
                    .map((c) => decoder.decode(c, { stream: true }))
                    .join("") + decoder.decode();
            return {
                kind: "ok",
                output: { body, status: resp.status },
            };
        } catch (err) {
            return {
                kind: "fail",
                error: {
                    message: err instanceof Error ? err.message : String(err),
                },
            };
        }
    },
};

// ---- File path safety ----

/** Allowed roots for file operations. Confines access to cwd, home, or tmpdir. */
function validateFilePath(filePath: string): string {
    // Reject null bytes which can truncate paths in C-based fs layers
    if (filePath.includes("\0")) {
        throw new Error("Path contains null bytes");
    }
    // Normalize separators for cross-platform consistency
    const normalized = filePath.replace(/\\/g, "/");
    const resolved = resolve(normalized);
    const allowedRoots = [process.cwd(), homedir(), tmpdir()];
    const isAllowed = allowedRoots.some((root) => {
        const rel = relative(root, resolved);
        return !rel.startsWith("..") && !isAbsolute(rel);
    });
    if (!isAllowed) {
        throw new Error(
            `Path "${filePath}" is outside allowed directories (cwd, home, or tmpdir)`,
        );
    }
    return resolved;
}

const DEFAULT_MAX_FILE_READ_BYTES = 10 * 1024 * 1024; // 10 MB

export const fileRead: TaskDefinition<
    { path: string; maxBytes?: number },
    string
> = {
    ...taskSchema("file.read"),
    sideEffects: true,
    async execute(input) {
        const maxBytes = input.maxBytes ?? DEFAULT_MAX_FILE_READ_BYTES;
        try {
            const safePath = validateFilePath(input.path);
            const content = await readFile(safePath, "utf8");
            if (Buffer.byteLength(content, "utf8") > maxBytes) {
                return {
                    kind: "fail",
                    error: {
                        message: `File exceeds the ${maxBytes} byte limit`,
                    },
                };
            }
            return { kind: "ok", output: content };
        } catch (err) {
            return {
                kind: "fail",
                error: {
                    message: err instanceof Error ? err.message : String(err),
                },
            };
        }
    },
};

export const fileWrite: TaskDefinition<
    { path: string; content: string },
    string
> = {
    ...taskSchema("file.write"),
    sideEffects: true,
    async execute(input) {
        try {
            const safePath = validateFilePath(input.path);
            await mkdir(dirname(safePath), { recursive: true });
            await writeFile(safePath, input.content, "utf8");
            return { kind: "ok", output: safePath };
        } catch (err) {
            return {
                kind: "fail",
                error: {
                    message: err instanceof Error ? err.message : String(err),
                },
            };
        }
    },
};

// ---- compare tasks ----

export const compareEquals: TaskDefinition<
    { left: unknown; right: unknown },
    boolean
> = {
    ...taskSchema("compare.equals"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.left === input.right };
    },
};

export const compareNotEquals: TaskDefinition<
    { left: unknown; right: unknown },
    boolean
> = {
    ...taskSchema("compare.notEquals"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.left !== input.right };
    },
};

export const compareGreaterThan: TaskDefinition<
    { left: number; right: number },
    boolean
> = {
    ...taskSchema("compare.greaterThan"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.left > input.right };
    },
};

export const compareLessThan: TaskDefinition<
    { left: number; right: number },
    boolean
> = {
    ...taskSchema("compare.lessThan"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.left < input.right };
    },
};

export const compareGreaterOrEqual: TaskDefinition<
    { left: number; right: number },
    boolean
> = {
    ...taskSchema("compare.greaterOrEqual"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.left >= input.right };
    },
};

export const compareLessOrEqual: TaskDefinition<
    { left: number; right: number },
    boolean
> = {
    ...taskSchema("compare.lessOrEqual"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.left <= input.right };
    },
};

// ---- bool tasks ----

export const boolNot: TaskDefinition<{ value: boolean }, boolean> = {
    ...taskSchema("bool.not"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: !input.value };
    },
};

// ---- math tasks ----

export const mathAdd: GenericTaskDefinition<
    { left: number; right: number },
    number
> = {
    ...genericTaskSchema("math.add"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.left + input.right };
    },
};

export const mathSubtract: TaskDefinition<
    { left: number; right: number },
    number
> = {
    ...genericTaskSchema("math.subtract"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.left - input.right };
    },
};

export const mathMultiply: TaskDefinition<
    { left: number; right: number },
    number
> = {
    ...genericTaskSchema("math.multiply"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.left * input.right };
    },
};

export const mathDivide: TaskDefinition<
    { left: number; right: number },
    number
> = {
    ...taskSchema("math.divide"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.left / input.right };
    },
};

export const mathModulo: TaskDefinition<
    { left: number; right: number },
    number
> = {
    ...genericTaskSchema("math.modulo"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.left % input.right };
    },
};

export const mathNegate: TaskDefinition<{ value: number }, number> = {
    ...genericTaskSchema("math.negate"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: -input.value };
    },
};

export const mathFloor: TaskDefinition<{ value: number }, number> = {
    ...taskSchema("math.floor"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: Math.floor(input.value) };
    },
};

export const mathRound: TaskDefinition<{ value: number }, number> = {
    ...taskSchema("math.round"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: Math.round(input.value) };
    },
};

export const mathCeil: TaskDefinition<{ value: number }, number> = {
    ...taskSchema("math.ceil"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: Math.ceil(input.value) };
    },
};

// ---- noop (merge/join point for branches) ----

export const noop: TaskDefinition<
    Record<string, never>,
    Record<string, never>
> = {
    ...taskSchema("noop"),
    sideEffects: false,
    async execute() {
        return { kind: "ok", output: {} };
    },
};

// ---- identity (pass-through for literal values in branches) ----

export const identity: TaskDefinition<{ value: unknown }, unknown> = {
    ...taskSchema("identity"),
    sideEffects: false,
    async execute(input) {
        return { kind: "ok", output: input.value };
    },
};

// ---- error tasks ----

export const errorFail: TaskDefinition<{ message: unknown }, never> = {
    ...taskSchema("error.fail"),
    sideEffects: false,
    async execute(input) {
        return {
            kind: "fail",
            error: {
                message:
                    typeof input.message === "string"
                        ? input.message
                        : JSON.stringify(input.message),
                data: input.message,
            },
        };
    },
};

/** Standard-library tasks (pure, no IO). */
export const standardLibraryTasks: TaskDefinition[] = [
    listLength,
    listElementAt,
    listAppend,
    compareEquals,
    compareNotEquals,
    compareGreaterThan,
    compareLessThan,
    compareGreaterOrEqual,
    compareLessOrEqual,
    boolNot,
    mathAdd,
    mathSubtract,
    mathMultiply,
    mathDivide,
    mathModulo,
    mathNegate,
    mathFloor,
    mathRound,
    mathCeil,
    errorFail,
    noop,
    identity,
];

/** All builtin tasks: stdlib + IO + utility. */
export const allBuiltinTasks: TaskDefinition[] = [
    ...standardLibraryTasks,
    boolToLabel,
    shellExec,
    llmGenerate,
    llmGenerateJson,
    httpGet,
    fileRead,
    fileWrite,
    textTemplate,
    stringJoin,
    stringSplit,
];
