// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs/promises";
import { WebTask, TaskFile, FileMetadata } from "./types.js";

export interface TaskFilter {
    categories?: string[];
    difficulties?: string[];
    taskIds?: string[];
    benchmark?: string;
    limit?: number;
}

export class TaskLoader {
    private tasks: WebTask[] = [];
    private metadata: FileMetadata | null = null;

    /**
     * Load tasks from JSON file
     */
    async loadFromJSON(filePath: string): Promise<void> {
        const content = await fs.readFile(filePath, "utf-8");
        const taskFile: TaskFile = JSON.parse(content);

        this.metadata = taskFile.metadata;
        this.tasks = taskFile.tasks;

        console.log(`Loaded ${this.tasks.length} tasks from ${filePath}`);
        if (this.metadata.benchmark) {
            console.log(`Benchmark: ${this.metadata.benchmark}`);
        }
    }

    /**
     * Get all tasks with optional filtering
     */
    getTasks(filter?: TaskFilter): WebTask[] {
        let filtered = this.tasks;

        if (filter?.categories) {
            filtered = filtered.filter(t =>
                filter.categories!.includes(t.category)
            );
        }

        if (filter?.difficulties) {
            filtered = filtered.filter(t =>
                filter.difficulties!.includes(t.difficulty)
            );
        }

        if (filter?.taskIds) {
            const idSet = new Set(filter.taskIds);
            filtered = filtered.filter(t => idSet.has(t.id));
        }

        if (filter?.benchmark) {
            filtered = filtered.filter(t =>
                t.metadata?.benchmark === filter.benchmark
            );
        }

        if (filter?.limit) {
            filtered = filtered.slice(0, filter.limit);
        }

        return filtered;
    }

    /**
     * Get statistics about loaded tasks
     */
    getStatistics() {
        const byCategory = new Map<string, number>();
        const byDifficulty = new Map<string, number>();

        for (const task of this.tasks) {
            byCategory.set(
                task.category,
                (byCategory.get(task.category) || 0) + 1
            );
            byDifficulty.set(
                task.difficulty,
                (byDifficulty.get(task.difficulty) || 0) + 1
            );
        }

        return {
            total: this.tasks.length,
            byCategory: Object.fromEntries(byCategory),
            byDifficulty: Object.fromEntries(byDifficulty),
            benchmark: this.metadata?.benchmark,
        };
    }

    /**
     * Get file metadata
     */
    getMetadata(): FileMetadata | null {
        return this.metadata;
    }
}
