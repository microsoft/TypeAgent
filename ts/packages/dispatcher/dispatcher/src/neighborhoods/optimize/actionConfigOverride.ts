// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Sandbox-side per-action filter wrapper. The `prune` lever's mechanism is to
// hide an action from the translator's prompt without removing it from the
// underlying schema source — the durable artifact is the operator-applied
// `@deprecated` JSDoc (or `[DEPRECATED]` description prefix for PAS-only).
// This wrapper handles the sandbox-only "drop from getActionConfigs()
// reporting" half of the mechanism.
//
// The wrapper composes with `loadSandboxProvider`: load the base sandbox
// provider, then wrap with this. Production `ActionConfigProvider` paths
// are unchanged — no new infrastructure on the live agents.

import type {
    ActionConfigProvider,
    ActionSchemaFile,
} from "../../translation/actionConfigProvider.js";
import type { ActionConfig } from "../../translation/actionConfig.js";
import type { ActionConfigOverride } from "./types.js";
import { ParsedActionSchema } from "@typeagent/action-schema";

/**
 * A snapshot of action-config overrides keyed by schema name. Each schema's
 * override lists action names to hide. Values come from
 * `sandbox/overrides/<schema>.actionConfig.json`.
 */
export interface ActionConfigOverrideMap {
    /** Key: schema name (e.g. "player"). Value: actions to hide for that
     *  schema. Missing key = no overrides for that schema. */
    [schemaName: string]: ActionConfigOverride;
}

/**
 * Wrap an `ActionConfigProvider` with an override layer that hides actions
 * listed in `overrides[<schemaName>].droppedActions` from:
 *
 *   - `getActionSchemaFileForConfig(config)` — returned `ActionSchemaFile`'s
 *     `parsedActionSchema.actionSchemas` map has the dropped entries removed
 *
 * `getActionConfig` / `tryGetActionConfig` / `getActionConfigs` are not
 * modified — the per-schema configs themselves still exist (a schema isn't
 * pruned, only individual actions within it are). The translator builds its
 * prompt from `ActionSchemaFile.parsedActionSchema.actionSchemas`, so
 * filtering at that layer is sufficient to hide an action from the LLM.
 */
export function withActionConfigOverride(
    base: ActionConfigProvider,
    overrides: ActionConfigOverrideMap,
): ActionConfigProvider {
    // Quick shortcut: if no overrides have any drops, pass through.
    const hasAnyDrops = Object.values(overrides).some(
        (o) => o.droppedActions.length > 0,
    );
    if (!hasAnyDrops) return base;

    // Per-config memoization. The filtered ActionSchemaFile is immutable from
    // our point of view — same input config → same filtered output.
    const cache = new WeakMap<ActionConfig, ActionSchemaFile>();

    return {
        tryGetActionConfig(schemaName: string) {
            return base.tryGetActionConfig(schemaName);
        },
        getActionConfig(schemaName: string) {
            return base.getActionConfig(schemaName);
        },
        getActionConfigs() {
            return base.getActionConfigs();
        },
        getActionSchemaFileForConfig(config: ActionConfig): ActionSchemaFile {
            const dropped = overrides[config.schemaName]?.droppedActions;
            if (!dropped || dropped.length === 0) {
                return base.getActionSchemaFileForConfig(config);
            }
            const cached = cache.get(config);
            if (cached) return cached;
            const original = base.getActionSchemaFileForConfig(config);
            const filtered = filterActionSchemaFile(original, dropped);
            cache.set(config, filtered);
            return filtered;
        },
    };
}

function filterActionSchemaFile(
    original: ActionSchemaFile,
    droppedActions: string[],
): ActionSchemaFile {
    const dropSet = new Set(droppedActions);
    const originalActions = original.parsedActionSchema.actionSchemas;
    const filteredActions = new Map<string, any>();
    for (const [name, def] of originalActions) {
        if (dropSet.has(name)) continue;
        filteredActions.set(name, def);
    }
    // Identical hash if no actions were actually dropped — preserves
    // downstream cache validity when the override file lists actions that
    // don't exist in the schema.
    if (filteredActions.size === originalActions.size) {
        return original;
    }
    const filteredParsed: ParsedActionSchema = {
        ...original.parsedActionSchema,
        actionSchemas: filteredActions,
    };
    return {
        ...original,
        // Tag the source hash so any downstream cache treats the filtered
        // file as distinct from the original.
        sourceHash: `${original.sourceHash}+drop:${[...dropSet].sort().join(",")}`,
        parsedActionSchema: filteredParsed,
    };
}
