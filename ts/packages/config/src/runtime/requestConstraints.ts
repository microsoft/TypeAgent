// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ConfigTree, FlatEnv } from "../types.js";

/** Configured per-request limits, not throttling or application work budgets. */
export interface ModelRequestConstraints {
    readonly contextTokens?: number | undefined;
    readonly inputTokens?: number | undefined;
    readonly outputTokens?: number | undefined;
    readonly embeddingItemTokens?: number | undefined;
}

export const MODEL_REQUEST_CONSTRAINTS_KEY =
    "TYPEAGENT_MODEL_REQUEST_CONSTRAINTS";

export function parseModelRequestConstraints(
    value: unknown,
): ReadonlyMap<string, ModelRequestConstraints> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("modelRequestConstraints must be a map");
    const result = new Map<string, ModelRequestConstraints>();
    for (const [key, entry] of Object.entries(value)) {
        if (!/^(azure|openai):(chat|embedding):[^:]*$/i.test(key))
            throw new Error(
                "modelRequestConstraints keys must be provider:chat|embedding:deployment (empty deployment for the default)",
            );
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
            throw new Error(`modelRequestConstraints '${key}' must be a map`);
        for (const [field, bound] of Object.entries(entry)) {
            if (
                ![
                    "contextTokens",
                    "inputTokens",
                    "outputTokens",
                    "embeddingItemTokens",
                ].includes(field) ||
                typeof bound !== "number" ||
                !Number.isSafeInteger(bound) ||
                bound < 1
            )
                throw new Error(
                    `Invalid positive request constraint '${key}.${field}'`,
                );
            if (
                (key.toLowerCase().includes(":chat:") &&
                    field === "embeddingItemTokens") ||
                (key.toLowerCase().includes(":embedding:") &&
                    ["contextTokens", "outputTokens"].includes(field))
            )
                throw new Error(
                    `Request constraint '${key}.${field}' has the wrong model type`,
                );
        }
        const normalized = key.toLowerCase();
        if (result.has(normalized))
            throw new Error(
                `Duplicate modelRequestConstraints '${normalized}'`,
            );
        result.set(normalized, { ...entry });
    }
    return result;
}

export function modelRequestConstraintsToTree(
    constraints: ReadonlyMap<string, ModelRequestConstraints>,
): ConfigTree {
    const tree: ConfigTree = {};
    for (const [key, value] of constraints) {
        const entry: ConfigTree = {};
        for (const [field, bound] of Object.entries(value))
            if (bound !== undefined) entry[field] = bound;
        tree[key] = entry;
    }
    return tree;
}

export function modelRequestConstraintsToFlat(value: unknown): FlatEnv {
    return {
        [MODEL_REQUEST_CONSTRAINTS_KEY]: JSON.stringify(
            modelRequestConstraintsToTree(parseModelRequestConstraints(value)),
        ),
    };
}
