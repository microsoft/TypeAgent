// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

/**
 * Phase 1 schema. Intentionally permissive — the full structured
 * schema for `azure.openai.deployments[]`, agent-specific blocks, etc.
 * lands with the `.env` importer in Phase 2.7. For now we only enforce
 * that:
 *
 * - The top-level document is a map (not a scalar or array).
 * - Leaf values are strings, numbers, booleans, or null.
 * - Arrays are allowed, but only as arrays of objects (used for
 *   `azureOpenAI.deployments.<name>[].endpoints`).
 */
const scalarSchema: z.ZodType<string | number | boolean | null> = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
]);

const treeSchema: z.ZodType<unknown> = z.lazy(() =>
    z.record(z.union([scalarSchema, treeSchema, z.array(treeSchema)])),
);

export const configTreeSchema = treeSchema;

/**
 * Validate a parsed YAML document against the Phase 1 schema.
 *
 * @param data Parsed YAML (typically the output of `yaml.load`).
 * @param sourceLabel A human-readable label (file path) used in error
 *   messages.
 * @throws An aggregated Error if validation fails.
 */
export function validateConfigTree(data: unknown, sourceLabel: string): void {
    const result = configTreeSchema.safeParse(data);
    if (result.success) {
        return;
    }
    const issues = result.error.issues
        .map((i) => {
            const path = i.path.length > 0 ? i.path.join(".") : "<root>";
            return `  - ${path}: ${i.message}`;
        })
        .join("\n");
    throw new Error(`Invalid TypeAgent config in ${sourceLabel}:\n${issues}`);
}
