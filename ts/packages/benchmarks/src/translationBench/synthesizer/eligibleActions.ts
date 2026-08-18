// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Thin helpers for synth scheduling + coverage validation.
 * Kept free of benchmark/prompt imports to avoid circular module init.
 */

const require = createRequire(import.meta.url);

let cachedPackagedLlmJudgeExcludedActions: ReadonlySet<string> | undefined;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldTreeIsLlmAsAJudge(field: unknown): boolean {
    if (!isPlainObject(field)) return false;
    if (field.verify === "llmAsAJudge") return true;
    return fieldTreeIsLlmAsAJudge(field.item);
}

function listLlmAsAJudgeExcludedActionIds(
    byAction: Record<string, unknown>,
): string[] {
    const out: string[] = [];
    for (const id of Object.keys(byAction).sort()) {
        const entry = byAction[id];
        if (!isPlainObject(entry) || !isPlainObject(entry.fields)) continue;
        if (
            Object.values(entry.fields).some((f) => fieldTreeIsLlmAsAJudge(f))
        ) {
            out.push(id);
        }
    }
    return out;
}

/** Packaged grader exclusions used by synth scheduling and coverage validation. */
export function getPackagedLlmJudgeExcludedActions(): ReadonlySet<string> {
    if (cachedPackagedLlmJudgeExcludedActions === undefined) {
        const graderPath = require.resolve(
            "../action-parameters-grader.generated.json",
        );
        if (!existsSync(graderPath)) {
            throw new Error(
                `Missing packaged action-parameters grader at ${graderPath}`,
            );
        }
        const raw = JSON.parse(readFileSync(graderPath, "utf8")) as unknown;
        if (
            !isPlainObject(raw) ||
            raw.version !== 1 ||
            !isPlainObject(raw.byAction)
        ) {
            throw new Error(
                `Unsupported or corrupt packaged action-parameters grader at ${graderPath}`,
            );
        }
        cachedPackagedLlmJudgeExcludedActions = new Set(
            listLlmAsAJudgeExcludedActionIds(raw.byAction),
        );
    }
    return cachedPackagedLlmJudgeExcludedActions;
}

export function clearPackagedLlmJudgeExcludedActionsCacheForTests(): void {
    cachedPackagedLlmJudgeExcludedActions = undefined;
}

/** Eligible = catalog actions minus llmAsAJudge-excluded action ids. */
export function countEligibleTranslationBenchActions(
    schemas: ReadonlyArray<{
        schemaName: string;
        tools: ReadonlyArray<{ function: { name: string } }>;
    }>,
    excludedActionIds: ReadonlySet<string>,
): number {
    let count = 0;
    for (const schema of schemas) {
        for (const tool of schema.tools) {
            if (
                !excludedActionIds.has(
                    `${schema.schemaName}.${tool.function.name}`,
                )
            ) {
                count += 1;
            }
        }
    }
    return count;
}
