// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TaskDefinition } from "workflow-model";
import { createAjv } from "./ajv.js";

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
        try {
            this.ajv.compile(task.inputSchema);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(
                `Task "${task.name}" has an invalid inputSchema: ${msg}`,
            );
        }
        try {
            this.ajv.compile(task.outputSchema);
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
