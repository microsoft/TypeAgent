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
 * - Arrays of objects are allowed for structured sections.
 * - `copilot.fallbackModels` is the one supported scalar-array field.
 */
const scalarSchema: z.ZodType<string | number | boolean | null> = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
]);

const treeWithScalarArraysSchema: z.ZodType<unknown> = z.lazy(() =>
    z.record(
        z.union([
            scalarSchema,
            treeWithScalarArraysSchema,
            z.array(z.union([scalarSchema, treeWithScalarArraysSchema])),
        ]),
    ),
);

export const configTreeSchema = treeWithScalarArraysSchema.superRefine(
    (data, context) => {
        const unsupportedArrayPath = findUnsupportedScalarArray(data);
        if (unsupportedArrayPath !== undefined) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path:
                    unsupportedArrayPath === "<root>"
                        ? []
                        : unsupportedArrayPath.split("."),
                message: "Scalar arrays are not supported at this path",
            });
        }
    },
);

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
    if (result.success) return;
    const issues = result.error.issues
        .map((i) => {
            const path = i.path.length > 0 ? i.path.join(".") : "<root>";
            return `  - ${path}: ${i.message}`;
        })
        .join("\n");
    throw new Error(`Invalid TypeAgent config in ${sourceLabel}:\n${issues}`);
}

function findUnsupportedScalarArray(
    node: unknown,
    path: string[] = [],
): string | undefined {
    if (Array.isArray(node)) {
        const containsScalar = node.some(
            (item) => item === null || typeof item !== "object",
        );
        if (containsScalar && path.join(".") !== "copilot.fallbackModels") {
            return path.join(".") || "<root>";
        }
        for (let i = 0; i < node.length; i++) {
            const unsupported = findUnsupportedScalarArray(node[i], [
                ...path,
                String(i),
            ]);
            if (unsupported !== undefined) {
                return unsupported;
            }
        }
        return undefined;
    }
    if (node !== null && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
            const unsupported = findUnsupportedScalarArray(value, [
                ...path,
                key,
            ]);
            if (unsupported !== undefined) {
                return unsupported;
            }
        }
    }
    return undefined;
}
