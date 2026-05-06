// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { WorkflowIR, validateWorkflowIR, TaskDefinition } from "workflow-model";

/**
 * Scan a directory for workflow JSON files, parse and validate each.
 * Invalid files are skipped with a warning logged to stderr.
 * Returns a map from workflow name to parsed IR.
 */
export async function discoverWorkflows(
    dir: string,
    tasks: ReadonlyMap<string, TaskDefinition>,
): Promise<Map<string, WorkflowIR>> {
    const workflows = new Map<string, WorkflowIR>();
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch {
        // Directory doesn't exist or is unreadable.
        return workflows;
    }
    for (const entry of entries) {
        if (!entry.endsWith(".json")) {
            continue;
        }
        const filePath = join(dir, entry);
        try {
            const raw = await readFile(filePath, "utf-8");
            const ir: WorkflowIR = JSON.parse(raw);
            const result = validateWorkflowIR(ir, tasks);
            if (!result.valid) {
                const msgs = result.errors
                    .map((e) => `${e.path}: ${e.message}`)
                    .join("; ");
                console.warn(`Skipping ${entry}: ${msgs}`);
                continue;
            }
            workflows.set(ir.name, ir);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`Skipping ${entry}: ${msg}`);
        }
    }
    return workflows;
}
