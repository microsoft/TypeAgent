// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Thin wrapper around the engine's schemas-only export so feature
 * code never imports `workflow-engine` directly (keeps the LSP free
 * of any transitive runtime deps like `aiclient`).
 */

import { getBuiltinTaskSchemas } from "workflow-engine/schemas";
import type { BuiltinTaskSchema } from "workflow-engine/schemas";

export type TaskSchema = BuiltinTaskSchema;

let cached: TaskSchema[] | undefined;

export function loadTaskSchemas(): TaskSchema[] {
    if (!cached) {
        cached = getBuiltinTaskSchemas();
    }
    return cached;
}
