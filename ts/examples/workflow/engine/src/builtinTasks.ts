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
import { dirname } from "node:path";
import { TaskDefinition } from "workflow-model";
import { openai } from "aiclient";

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

// ---- IO tasks ----

export const shellExec: TaskDefinition<
    { command: string; args?: string[]; cwd?: string },
    { stdout: string; stderr: string; exitCode: number }
> = {
    name: "shell.exec",
    inputSchema: {
        type: "object",
        required: ["command"],
        properties: {
            command: { type: "string" },
            args: { type: "array", items: { type: "string" } },
            cwd: { type: "string" },
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
        return new Promise((resolve) => {
            execFile(
                command,
                args,
                {
                    cwd,
                    maxBuffer: 10 * 1024 * 1024,
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
    async execute(input) {
        const model = openai.createChatModel(input.endpoint);
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

// ---- Utility tasks ----

export const textTemplate: TaskDefinition<
    { template: string; vars: Record<string, unknown> },
    { text: string }
> = {
    name: "text.template",
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
    { text: string; delimiter: string },
    { list: string[] }
> = {
    name: "string.split",
    inputSchema: {
        type: "object",
        required: ["text", "delimiter"],
        properties: {
            text: { type: "string" },
            delimiter: { type: "string" },
        },
    },
    outputSchema: {
        type: "object",
        required: ["list"],
        properties: { list: { type: "array", items: { type: "string" } } },
    },
    async execute(input) {
        const list = input.text
            .split(input.delimiter)
            .filter((s) => s.length > 0);
        return { kind: "ok", output: { list } };
    },
};

export const httpGet: TaskDefinition<
    { url: string; headers?: Record<string, string> },
    { body: string; status: number }
> = {
    name: "http.get",
    inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
            url: { type: "string" },
            headers: { type: "object" },
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
        try {
            const resp = await fetch(input.url, {
                ...(input.headers ? { headers: input.headers } : {}),
                signal: ctx.signal,
            });
            const body = await resp.text();
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

export const fileRead: TaskDefinition<{ path: string }, { content: string }> = {
    name: "file.read",
    inputSchema: {
        type: "object",
        required: ["path"],
        properties: { path: { type: "string" } },
    },
    outputSchema: {
        type: "object",
        required: ["content"],
        properties: { content: { type: "string" } },
    },
    async execute(input) {
        try {
            const content = await readFile(input.path, "utf8");
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
            await mkdir(dirname(input.path), { recursive: true });
            await writeFile(input.path, input.content, "utf8");
            return { kind: "ok", output: { path: input.path } };
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

/** The 6 original standard-library tasks (pure, no IO). */
export const standardLibraryTasks: TaskDefinition[] = [
    intAdd,
    intLessThan,
    listLength,
    listElementAt,
    listAppend,
    boolToLabel,
];

/** All builtin tasks: stdlib + IO + utility. */
export const allBuiltinTasks: TaskDefinition[] = [
    ...standardLibraryTasks,
    shellExec,
    llmGenerate,
    httpGet,
    fileRead,
    fileWrite,
    textTemplate,
    stringJoin,
    stringSplit,
];
