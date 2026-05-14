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
import { JSONSchema, TaskDefinition } from "workflow-model";
import { openai } from "aiclient";

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

export const listLength: TaskDefinition<
    { list: unknown[] },
    { length: number }
> = {
    name: "list.length",
    sideEffects: false,
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
    sideEffects: false,
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
        if (input.index < 0 || input.index >= input.list.length) {
            return {
                kind: "fail",
                error: {
                    message: `Index ${input.index} out of bounds for list of length ${input.list.length}`,
                },
            };
        }
        return { kind: "ok", output: { element: input.list[input.index] } };
    },
};

export const listAppend: TaskDefinition<
    { list: unknown[]; item: unknown },
    { list: unknown[] }
> = {
    name: "list.append",
    sideEffects: false,
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
    sideEffects: false,
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
    name: "shell.exec",
    sideEffects: true,
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
    { text: string }
> = {
    name: "llm.generate",
    sideEffects: true,
    inputSchema: {
        type: "object",
        required: ["prompt"],
        properties: {
            prompt: { type: "string" },
            endpoint: { type: "string" },
        },
    },
    outputSchema: {
        type: "object",
        required: ["text"],
        properties: { text: { type: "string" } },
    },
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
        return { kind: "ok", output: { text: result.data } };
    },
};

export const llmGenerateJson: TaskDefinition<
    { prompt: string; endpoint?: string },
    { value: unknown }
> = {
    name: "llm.generateJson",
    sideEffects: true,
    inputSchema: {
        type: "object",
        required: ["prompt"],
        properties: {
            prompt: { type: "string" },
            endpoint: { type: "string" },
        },
    },
    outputSchema: {
        type: "object",
        required: ["value"],
        properties: { value: {} },
    },
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
        // it declares a "value" property with a non-opaque schema.
        const valueSchema = ctx.outputSchema?.properties?.value;
        const jsonSchema =
            valueSchema &&
            typeof valueSchema !== "boolean" &&
            Object.keys(valueSchema).length > 0
                ? {
                      name: "response",
                      strict: true as const,
                      schema: sealObjects(valueSchema) as Record<
                          string,
                          unknown
                      >,
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
            return { kind: "ok", output: { value } };
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
    { text: string }
> = {
    name: "text.template",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["template", "vars"],
        properties: {
            template: { type: "string" },
            vars: { type: "object" },
        },
    },
    outputSchema: {
        type: "object",
        required: ["text"],
        properties: { text: { type: "string" } },
    },
    async execute(input) {
        let text = input.template;
        for (const [key, value] of Object.entries(input.vars)) {
            text = text.replaceAll(`{{${key}}}`, String(value));
        }
        return { kind: "ok", output: { text } };
    },
};

export const stringJoin: TaskDefinition<
    { list: string[]; delimiter: string },
    { text: string }
> = {
    name: "string.join",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["list", "delimiter"],
        properties: {
            list: { type: "array", items: { type: "string" } },
            delimiter: { type: "string" },
        },
    },
    outputSchema: {
        type: "object",
        required: ["text"],
        properties: { text: { type: "string" } },
    },
    async execute(input) {
        return {
            kind: "ok",
            output: { text: input.list.join(input.delimiter) },
        };
    },
};

export const stringSplit: TaskDefinition<
    { text: string; delimiter: string; keepEmpty?: boolean },
    { list: string[] }
> = {
    name: "string.split",
    sideEffects: false,
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
    outputSchema: {
        type: "object",
        required: ["list"],
        properties: { list: { type: "array", items: { type: "string" } } },
    },
    async execute(input) {
        const list = input.text.split(input.delimiter);
        return {
            kind: "ok",
            output: {
                list: input.keepEmpty ? list : list.filter((s) => s.length > 0),
            },
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
    name: "http.get",
    sideEffects: true,
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
    { content: string }
> = {
    name: "file.read",
    sideEffects: true,
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
    outputSchema: {
        type: "object",
        required: ["content"],
        properties: { content: { type: "string" } },
    },
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
            return { kind: "ok", output: { content } };
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
    { path: string }
> = {
    name: "file.write",
    sideEffects: true,
    inputSchema: {
        type: "object",
        required: ["path", "content"],
        properties: {
            path: { type: "string" },
            content: { type: "string" },
        },
    },
    outputSchema: {
        type: "object",
        required: ["path"],
        properties: { path: { type: "string" } },
    },
    async execute(input) {
        try {
            const safePath = validateFilePath(input.path);
            await mkdir(dirname(safePath), { recursive: true });
            await writeFile(safePath, input.content, "utf8");
            return { kind: "ok", output: { path: safePath } };
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

/** The 5 standard-library tasks (pure, no IO). */
export const standardLibraryTasks: TaskDefinition[] = [
    listLength,
    listElementAt,
    listAppend,
];

// ---- v2 compare tasks ----

export const compareEquals: TaskDefinition<
    { left: unknown; right: unknown },
    { result: boolean }
> = {
    name: "compare.equals",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["left", "right"],
        properties: { left: {}, right: {} },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "boolean" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.left === input.right } };
    },
};

export const compareNotEquals: TaskDefinition<
    { left: unknown; right: unknown },
    { result: boolean }
> = {
    name: "compare.notEquals",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["left", "right"],
        properties: { left: {}, right: {} },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "boolean" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.left !== input.right } };
    },
};

export const compareGreaterThan: TaskDefinition<
    { left: number; right: number },
    { result: boolean }
> = {
    name: "compare.greaterThan",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["left", "right"],
        properties: { left: { type: "number" }, right: { type: "number" } },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "boolean" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.left > input.right } };
    },
};

export const compareLessThan: TaskDefinition<
    { left: number; right: number },
    { result: boolean }
> = {
    name: "compare.lessThan",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["left", "right"],
        properties: { left: { type: "number" }, right: { type: "number" } },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "boolean" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.left < input.right } };
    },
};

export const compareGreaterOrEqual: TaskDefinition<
    { left: number; right: number },
    { result: boolean }
> = {
    name: "compare.greaterOrEqual",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["left", "right"],
        properties: { left: { type: "number" }, right: { type: "number" } },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "boolean" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.left >= input.right } };
    },
};

export const compareLessOrEqual: TaskDefinition<
    { left: number; right: number },
    { result: boolean }
> = {
    name: "compare.lessOrEqual",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["left", "right"],
        properties: { left: { type: "number" }, right: { type: "number" } },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "boolean" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.left <= input.right } };
    },
};

// ---- v2 bool tasks ----

export const boolAnd: TaskDefinition<
    { left: boolean; right: boolean },
    { result: boolean }
> = {
    name: "bool.and",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["left", "right"],
        properties: {
            left: { type: "boolean" },
            right: { type: "boolean" },
        },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "boolean" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.left && input.right } };
    },
};

export const boolOr: TaskDefinition<
    { left: boolean; right: boolean },
    { result: boolean }
> = {
    name: "bool.or",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["left", "right"],
        properties: {
            left: { type: "boolean" },
            right: { type: "boolean" },
        },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "boolean" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.left || input.right } };
    },
};

export const boolNot: TaskDefinition<{ value: boolean }, { result: boolean }> =
    {
        name: "bool.not",
        sideEffects: false,
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "boolean" } },
        },
        outputSchema: {
            type: "object",
            required: ["result"],
            properties: { result: { type: "boolean" } },
        },
        async execute(input) {
            return { kind: "ok", output: { result: !input.value } };
        },
    };

// ---- v2 math tasks ----

export const mathAdd: TaskDefinition<
    { left: number; right: number },
    { result: number }
> = {
    name: "math.add",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["left", "right"],
        properties: { left: { type: "number" }, right: { type: "number" } },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "number" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.left + input.right } };
    },
};

export const mathSubtract: TaskDefinition<
    { left: number; right: number },
    { result: number }
> = {
    name: "math.subtract",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["left", "right"],
        properties: { left: { type: "number" }, right: { type: "number" } },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "number" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.left - input.right } };
    },
};

export const mathMultiply: TaskDefinition<
    { left: number; right: number },
    { result: number }
> = {
    name: "math.multiply",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["left", "right"],
        properties: { left: { type: "number" }, right: { type: "number" } },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "number" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.left * input.right } };
    },
};

export const mathDivide: TaskDefinition<
    { left: number; right: number },
    { result: number }
> = {
    name: "math.divide",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["left", "right"],
        properties: { left: { type: "number" }, right: { type: "number" } },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "number" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.left / input.right } };
    },
};

export const mathModulo: TaskDefinition<
    { left: number; right: number },
    { result: number }
> = {
    name: "math.modulo",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["left", "right"],
        properties: { left: { type: "number" }, right: { type: "number" } },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "number" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: input.left % input.right } };
    },
};

export const mathNegate: TaskDefinition<{ value: number }, { result: number }> =
    {
        name: "math.negate",
        sideEffects: false,
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "number" } },
        },
        outputSchema: {
            type: "object",
            required: ["result"],
            properties: { result: { type: "number" } },
        },
        async execute(input) {
            return { kind: "ok", output: { result: -input.value } };
        },
    };

export const mathFloor: TaskDefinition<{ value: number }, { result: number }> =
    {
        name: "math.floor",
        sideEffects: false,
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "number" } },
        },
        outputSchema: {
            type: "object",
            required: ["result"],
            properties: { result: { type: "integer" } },
        },
        async execute(input) {
            return { kind: "ok", output: { result: Math.floor(input.value) } };
        },
    };

export const mathRound: TaskDefinition<{ value: number }, { result: number }> =
    {
        name: "math.round",
        sideEffects: false,
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "number" } },
        },
        outputSchema: {
            type: "object",
            required: ["result"],
            properties: { result: { type: "integer" } },
        },
        async execute(input) {
            return { kind: "ok", output: { result: Math.round(input.value) } };
        },
    };

export const mathCeil: TaskDefinition<{ value: number }, { result: number }> = {
    name: "math.ceil",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["value"],
        properties: { value: { type: "number" } },
    },
    outputSchema: {
        type: "object",
        required: ["result"],
        properties: { result: { type: "integer" } },
    },
    async execute(input) {
        return { kind: "ok", output: { result: Math.ceil(input.value) } };
    },
};

// ---- noop (merge/join point for branches) ----

export const noop: TaskDefinition<
    Record<string, never>,
    Record<string, never>
> = {
    name: "noop",
    sideEffects: false,
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    async execute() {
        return { kind: "ok", output: {} };
    },
};

// ---- identity (pass-through for literal values in branches) ----

export const identity: TaskDefinition<{ value: unknown }, { result: unknown }> =
    {
        name: "identity",
        sideEffects: false,
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: {} },
        },
        outputSchema: {
            type: "object",
            required: ["result"],
            properties: { result: {} },
        },
        async execute(input) {
            return { kind: "ok", output: { result: input.value } };
        },
    };

// ---- v2 error tasks ----

export const errorFail: TaskDefinition<{ value: unknown }, never> = {
    name: "error.fail",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["value"],
        properties: { value: {} },
    },
    outputSchema: { type: "object" },
    async execute(input) {
        return {
            kind: "fail",
            error: {
                message:
                    typeof input.value === "string"
                        ? input.value
                        : JSON.stringify(input.value),
                data: input.value,
            },
        };
    },
};

/** v2 standard-library tasks (compare, bool, math, error, list). */
export const v2StandardLibraryTasks: TaskDefinition[] = [
    compareEquals,
    compareNotEquals,
    compareGreaterThan,
    compareLessThan,
    compareGreaterOrEqual,
    compareLessOrEqual,
    boolAnd,
    boolOr,
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

/** All builtin tasks: stdlib + v2 stdlib + IO + utility + legacy. */
export const allBuiltinTasks: TaskDefinition[] = [
    ...standardLibraryTasks,
    ...v2StandardLibraryTasks,
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
