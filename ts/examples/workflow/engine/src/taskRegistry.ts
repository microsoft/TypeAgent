// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { JSONSchema, TaskDefinition, isGenericTask } from "workflow-model";
import { resolveTypeParams } from "workflow-dsl";
import { createAjv } from "./ajv.js";

/**
 * Get the effective input/output schemas for a task definition.
 * For generic tasks, resolves templates using default type arguments.
 */
function getSchemas(task: TaskDefinition): {
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
} {
    if (isGenericTask(task)) {
        const defaults = task.typeParameters.map((p) => p.default ?? {});
        return {
            inputSchema: resolveTypeParams(
                task.inputSchemaTemplate,
                task.typeParameters,
                defaults,
            ),
            outputSchema: resolveTypeParams(
                task.outputSchemaTemplate,
                task.typeParameters,
                defaults,
            ),
        };
    }
    return { inputSchema: task.inputSchema, outputSchema: task.outputSchema };
}

/**
 * In-memory registry for task definitions.
 */
export class TaskRegistry {
    private tasks = new Map<string, TaskDefinition>();
    private ajv = createAjv();

    register(task: TaskDefinition): void {
        if (this.tasks.has(task.name)) {
            throw new Error(`Task "${task.name}" is already registered.`);
        }
        const { inputSchema, outputSchema } = getSchemas(task);
        try {
            this.ajv.compile(inputSchema);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(
                `Task "${task.name}" has an invalid inputSchema: ${msg}`,
            );
        }
        try {
            this.ajv.compile(outputSchema);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(
                `Task "${task.name}" has an invalid outputSchema: ${msg}`,
            );
        }
        this.tasks.set(task.name, task);
    }

    get(name: string): TaskDefinition | undefined {
        return this.tasks.get(name);
    }

    has(name: string): boolean {
        return this.tasks.has(name);
    }

    all(): ReadonlyMap<string, TaskDefinition> {
        return this.tasks;
    }
}
