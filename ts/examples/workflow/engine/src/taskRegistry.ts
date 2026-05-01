// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import AjvModule from "ajv";
import { TaskDefinition } from "workflow-model";

const AjvConstructor = (AjvModule as any).default ?? AjvModule;

/**
 * In-memory registry for task definitions.
 */
export class TaskRegistry {
    private tasks = new Map<string, TaskDefinition>();
    private ajv = new AjvConstructor({ strict: false });

    register(task: TaskDefinition): void {
        if (this.tasks.has(task.name)) {
            throw new Error(`Task "${task.name}" is already registered.`);
        }
        try {
            this.ajv.compile(task.inputSchema as object);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(
                `Task "${task.name}" has an invalid inputSchema: ${msg}`,
            );
        }
        try {
            this.ajv.compile(task.outputSchema as object);
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
