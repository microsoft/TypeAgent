// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    expandRemovedActions,
    getPackagedActionEligibilityPolicy,
    clearPackagedActionEligibilityPolicyCacheForTests,
    type CatalogActionRef,
} from "../policy/loadPolicy.js";
import {
    ambiguousCrossSchemaActionIds,
    clearPackagedEligibleGoldActionsCacheForTests,
    getPackagedEligibleGoldActionIds,
    loadPackagedGraderForEligibility,
} from "../policy/actionQualityPicker.js";
import { listActionsWithLlmJudgeFields } from "../policy/graderInspect.js";

/**
 * Benign non-tool actions excluded from TB gold targeting and from scored
 * fires on empty-gold negatives. Single source of truth — runner imports this.
 */
export const HARDCODED_NON_EVAL_ACTION_IDS: ReadonlySet<string> = new Set([
    "chat.generateResponse",
    "utility.claudeTask",
]);

export {
    clearPackagedActionEligibilityPolicyCacheForTests,
    getPackagedActionEligibilityPolicy,
    clearPackagedEligibleGoldActionsCacheForTests,
    getPackagedEligibleGoldActionIds,
    ambiguousCrossSchemaActionIds,
};

function catalogRefsFromSchemas(
    schemas: ReadonlyArray<{
        schemaName: string;
        tools: ReadonlyArray<{ function: { name: string } }>;
    }>,
): CatalogActionRef[] {
    const actions: CatalogActionRef[] = [];
    for (const schema of schemas) {
        for (const tool of schema.tools) {
            actions.push({
                schemaName: schema.schemaName,
                actionName: tool.function.name,
            });
        }
    }
    return actions;
}

/** Human removedActions expanded against the catalog (no allowlist). */
export function getPackagedHumanRemovedActionIdsFromCatalog(
    schemas: ReadonlyArray<{
        schemaName: string;
        tools: ReadonlyArray<{ function: { name: string } }>;
    }>,
    options?: {
        allowMissingExactIds?: boolean;
    },
): ReadonlySet<string> {
    return expandRemovedActions(
        getPackagedActionEligibilityPolicy().policy,
        catalogRefsFromSchemas(schemas),
        {
            allowMissingExactIds: options?.allowMissingExactIds === true,
        },
    ).removedActionIds;
}

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

/**
 * Schedule exclusion lattice:
 * - allowlist on (default): hard bans ∪ ambiguous ∪ (catalog \ allowlist)
 * - allowlist off (tests): hard bans ∪ ambiguous ∪ live llmAsAJudge actions
 */
export function getPackagedScheduleExcludedActionIds(
    schemas: ReadonlyArray<{
        schemaName: string;
        tools: ReadonlyArray<{ function: { name: string } }>;
    }>,
    options?: {
        allowMissingExactIds?: boolean;
        applyEligibleGoldAllowlist?: boolean;
    },
): ReadonlySet<string> {
    const refs = catalogRefsFromSchemas(schemas);
    const human = getPackagedHumanRemovedActionIdsFromCatalog(schemas, {
        allowMissingExactIds: options?.allowMissingExactIds === true,
    });
    const ambiguous = ambiguousCrossSchemaActionIds(refs, human);
    const out = new Set<string>([...human, ...ambiguous]);

    if (options?.applyEligibleGoldAllowlist === false) {
        for (const id of listActionsWithLlmJudgeFields(
            loadPackagedGraderForEligibility(),
        )) {
            out.add(id);
        }
        return out;
    }

    const { allowlist } = getPackagedEligibleGoldActionIds();
    for (const schema of schemas) {
        for (const tool of schema.tools) {
            const id = `${schema.schemaName}.${tool.function.name}`;
            if (!allowlist.has(id)) out.add(id);
        }
    }
    return out;
}
