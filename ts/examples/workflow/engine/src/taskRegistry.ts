// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TaskDefinition } from "workflow-model";

/**
 * In-memory registry for task definitions.
 */
export class TaskRegistry {
    private tasks = new Map<string, TaskDefinition>();

    register(task: TaskDefinition): void {
        if (this.tasks.has(task.name)) {
            throw new Error(`Task "${task.name}" is already registered.`);
        }
        this.tasks.set(task.name, task);
    }

    get(name: string): TaskDefinition | undefined {
        return this.tasks.get(name);
    }

    has(name: string): boolean {
        return this.tasks.has(name);
    }

    all(): Map<string, TaskDefinition> {
        return new Map(this.tasks);
    }
}
