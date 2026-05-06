// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    WorkflowIR,
    validateWorkflowIR,
    TaskDefinition,
    ValidationError,
} from "workflow-model";

export interface DiscoveryResult {
    workflows: Map<string, WorkflowIR>;
    /** Errors encountered while loading or validating workflows. */
    errors: Array<{ file: string; errors: ValidationError[] | string }>;
}

/**
 * Scan a directory for workflow JSON files, parse and validate each.
 * Invalid files are skipped and reported in the returned errors array.
 * Returns a map from workflow name to parsed IR, plus any errors.
 */
export async function discoverWorkflows(
    dir: string,
    tasks: ReadonlyMap<string, TaskDefinition>,
): Promise<DiscoveryResult> {
    const workflows = new Map<string, WorkflowIR>();
    const errors: DiscoveryResult["errors"] = [];
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch {
        // Directory doesn't exist or is unreadable.
        return { workflows, errors };
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
                errors.push({ file: entry, errors: result.errors });
                continue;
            }
            workflows.set(ir.name, ir);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push({ file: entry, errors: msg });
        }
    }
    return { workflows, errors };
}
