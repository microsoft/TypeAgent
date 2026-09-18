// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    TranslationBenchParameterScoreSpec,
    TranslationBenchParamFieldMode,
} from "../benchmark.js";
import { isParamSpec, paramSpecKind, type ParamSpec } from "./paramTypes.js";
import type { LoadedActionEligibilityPolicy } from "../../policy/loadPolicy.js";
import {
    ACTION_PARAM_CREATE_POLICY_DOCS,
    ACTION_PARAM_VERIFY_MODE_DOCS,
    LEGACY_RULE_RE,
    actionId,
    actionParameterSourceFingerprint,
    activePolicy,
    assertParameterOverridesMatchCatalog,
    graderRulesFingerprint,
    nestedParamSpecEqual,
    type ActionParameterFieldGrader,
    type ActionParamVerifyMode,
    type ActionParametersGraderCatalog,
    type ActionParametersGraderDiff,
    type ActionParametersGraderEntry,
    type CatalogActionRow,
    type FieldGraderDecision,
    type GeneratedActionCatalog,
    type ParameterGraderLlm,
} from "./paramGraderTypes.js";
import {
    classifyActionParameterFieldWithFallback,
    defaultCreateForOverride,
} from "./paramGraderClassify.js";
function fieldGraderFromDecision(
    optional: boolean,
    type: ParamSpec,
    decision: FieldGraderDecision,
): ActionParameterFieldGrader {
    const base: ActionParameterFieldGrader = {
        optional,
        type,
        typeKind: paramSpecKind(type),
        create: decision.create,
        verify: decision.verify,
        rule: decision.rule,
        source: decision.source,
    };
    if (decision.item !== undefined) {
        base.item = {
            create: decision.item.create,
            verify: decision.item.verify,
            rule: decision.item.rule,
            source: decision.item.source,
            ...(decision.item.item !== undefined
                ? {
                      item: {
                          create: decision.item.item.create,
                          verify: decision.item.item.verify,
                          rule: decision.item.item.rule,
                          source: decision.item.item.source,
                      },
                  }
                : {}),
        };
    }
    return base;
}

export async function buildActionParametersGraderEntry(
    schemaName: string,
    actionName: string,
    paramSpec: ParamSpec,
    options?: {
        parametersSummary?: string;
        description?: string;
        llm?: ParameterGraderLlm;
        /** Prior grader entry for this action (field-level reuse). */
        previousEntry?: ActionParametersGraderEntry;
        policy?: LoadedActionEligibilityPolicy;
    },
): Promise<ActionParametersGraderEntry> {
    const fields: Record<string, ActionParameterFieldGrader> = {};
    const scoreFields: Record<string, ActionParamVerifyMode> = {};
    const policy = activePolicy(options?.policy);

    if (paramSpec.kind === "object") {
        for (const [name, field] of Object.entries(paramSpec.fields)) {
            const id = actionId(schemaName, actionName);
            const fullName = `${id}.${name}`;
            const override = policy.parameterOverrides.get(fullName);

            let judged: FieldGraderDecision;
            if (override !== undefined) {
                judged = defaultCreateForOverride(
                    name,
                    field.spec,
                    field.optional,
                    override.verify,
                );
            } else {
                judged = await classifyActionParameterFieldWithFallback(
                    name,
                    field.spec,
                    field.optional,
                    {
                        schemaName,
                        actionName,
                        ...(options?.parametersSummary !== undefined
                            ? { parametersSummary: options.parametersSummary }
                            : {}),
                        ...(options?.description !== undefined
                            ? { description: options.description }
                            : {}),
                        ...(options?.llm !== undefined
                            ? { llm: options.llm }
                            : {}),
                        ...(options?.previousEntry?.fields[name] !== undefined
                            ? { priorField: options.previousEntry.fields[name] }
                            : {}),
                    },
                );
            }
            fields[name] = fieldGraderFromDecision(
                field.optional,
                field.spec,
                judged,
            );
            scoreFields[name] = judged.verify;
        }
    }

    return {
        schemaName,
        actionName,
        paramSpec,
        sourceFingerprint: actionParameterSourceFingerprint(paramSpec),
        fields,
        parameterScore: {
            defaultMode: "exact",
            fields: scoreFields,
        },
    };
}

function countFieldSources(
    fields: Record<string, ActionParameterFieldGrader>,
    actionLabel: string,
    pathPrefix = "",
): { llm: number; hardcode: number } {
    let llm = 0;
    let hardcode = 0;
    for (const [name, field] of Object.entries(fields)) {
        const label = pathPrefix ? `${pathPrefix}.${name}` : name;
        if (field.source === "llm") {
            llm += 1;
        } else if (field.source === "regex" || field.source === "hardcode") {
            hardcode += 1;
        } else {
            throw new Error(`Field '${actionLabel}.${label}' missing source`);
        }
        if (LEGACY_RULE_RE.test(field.rule) || /default/i.test(field.rule)) {
            throw new Error(
                `Field '${actionLabel}.${label}' has legacy/default rule '${field.rule}'`,
            );
        }
        if (field.item !== undefined) {
            // item is not a full field grader; check rule/source only.
            if (field.item.source === "llm") {
                llm += 1;
            } else if (
                field.item.source === "regex" ||
                field.item.source === "hardcode"
            ) {
                hardcode += 1;
            } else {
                throw new Error(
                    `Field '${actionLabel}.${label}.item' missing source`,
                );
            }
            if (
                LEGACY_RULE_RE.test(field.item.rule) ||
                /default/i.test(field.item.rule)
            ) {
                throw new Error(
                    `Field '${actionLabel}.${label}.item' has legacy/default rule '${field.item.rule}'`,
                );
            }
        }
    }
    return { llm, hardcode };
}

export function emptyActionParametersGraderDiff(): ActionParametersGraderDiff {
    return { added: [], updated: [], removed: [], unchanged: [] };
}

export function diffActionParametersGrader(
    catalog: GeneratedActionCatalog,
    previous: ActionParametersGraderCatalog | undefined,
): ActionParametersGraderDiff {
    const diff = emptyActionParametersGraderDiff();
    const nextIds = new Set<string>();

    for (const action of catalog.actions) {
        if (!isParamSpec(action.paramSpec)) {
            throw new Error(
                `Invalid paramSpec for ${action.schemaName}.${action.actionName}`,
            );
        }
        const id = actionId(action.schemaName, action.actionName);
        nextIds.add(id);
        const fingerprint = actionParameterSourceFingerprint(action.paramSpec);
        const prior = previous?.byAction[id];
        if (prior === undefined) {
            diff.added.push(id);
        } else if (prior.sourceFingerprint !== fingerprint) {
            diff.updated.push(id);
        } else {
            diff.unchanged.push(id);
        }
    }

    if (previous !== undefined) {
        for (const id of Object.keys(previous.byAction)) {
            if (!nextIds.has(id)) {
                diff.removed.push(id);
            }
        }
    }

    diff.added.sort();
    diff.updated.sort();
    diff.removed.sort();
    diff.unchanged.sort();
    return diff;
}

function priorEntryStillValid(
    entry: ActionParametersGraderEntry,
    catalogRow: CatalogActionRow,
): boolean {
    if (!isParamSpec(catalogRow.paramSpec)) {
        throw new Error(
            `Invalid paramSpec for ${entry.schemaName}.${entry.actionName}`,
        );
    }
    // Catalog paramSpec must still canonicalize-equal stored paramSpec.
    if (!nestedParamSpecEqual(catalogRow.paramSpec, entry.paramSpec)) {
        return false;
    }
    // Re-verify schema fingerprint only (rules drift handled at catalog level).
    const liveFp = actionParameterSourceFingerprint(catalogRow.paramSpec);
    if (
        entry.sourceFingerprint !== liveFp ||
        actionParameterSourceFingerprint(entry.paramSpec) !==
            entry.sourceFingerprint
    ) {
        return false;
    }
    if (entry.paramSpec.kind !== "object") {
        return true;
    }
    const expected = new Set(Object.keys(entry.paramSpec.fields));
    const actual = new Set(Object.keys(entry.fields));
    if (
        expected.size !== actual.size ||
        [...expected].some((k) => !actual.has(k))
    ) {
        return false;
    }
    // parameterScore must stay in lockstep with fields.verify
    for (const name of expected) {
        if (entry.parameterScore.fields[name] !== entry.fields[name]?.verify) {
            return false;
        }
    }
    return true;
}

function keepUnchangedGraderEntries(
    previous: ActionParametersGraderCatalog | undefined,
    unchangedIds: string[],
    actionsById: Map<string, CatalogActionRow>,
    rebuildIds: Set<string>,
): Record<string, ActionParametersGraderEntry> {
    const byAction: Record<string, ActionParametersGraderEntry> = {};
    if (previous === undefined) {
        return byAction;
    }
    for (const id of unchangedIds) {
        const entry = previous.byAction[id];
        const catalogRow = actionsById.get(id);
        if (entry === undefined || catalogRow === undefined) {
            rebuildIds.add(id);
            continue;
        }
        if (!priorEntryStillValid(entry, catalogRow)) {
            rebuildIds.add(id);
            continue;
        }
        byAction[id] = entry;
    }
    return byAction;
}

async function rebuildGraderEntries(
    rebuildIds: string[],
    actionsById: Map<string, CatalogActionRow>,
    previous: ActionParametersGraderCatalog | undefined,
    options?: {
        llm?: ParameterGraderLlm;
        onProgress?: (done: number, total: number) => void;
        policy?: LoadedActionEligibilityPolicy;
    },
): Promise<Record<string, ActionParametersGraderEntry>> {
    const byAction: Record<string, ActionParametersGraderEntry> = {};
    let done = 0;
    for (const id of rebuildIds) {
        const action = actionsById.get(id);
        if (action === undefined) {
            throw new Error(`Missing catalog action for '${id}'`);
        }
        if (!isParamSpec(action.paramSpec)) {
            throw new Error(`Invalid paramSpec for ${id}`);
        }
        byAction[id] = await buildActionParametersGraderEntry(
            action.schemaName,
            action.actionName,
            action.paramSpec,
            {
                ...(action.parameters !== undefined
                    ? { parametersSummary: action.parameters }
                    : {}),
                ...(action.description !== undefined
                    ? { description: action.description }
                    : {}),
                ...(options?.llm !== undefined ? { llm: options.llm } : {}),
                ...(previous?.byAction[id] !== undefined
                    ? { previousEntry: previous.byAction[id] }
                    : {}),
                ...(options?.policy !== undefined
                    ? { policy: options.policy }
                    : {}),
            },
        );
        done += 1;
        options?.onProgress?.(done, rebuildIds.length);
    }
    return byAction;
}

function countCatalogFieldSources(
    byAction: Record<string, ActionParametersGraderEntry>,
): { llm: number; hardcode: number } {
    let llm = 0;
    let hardcode = 0;
    for (const entry of Object.values(byAction)) {
        const counts = countFieldSources(
            entry.fields,
            `${entry.schemaName}.${entry.actionName}`,
        );
        llm += counts.llm;
        hardcode += counts.hardcode;
    }
    return { llm, hardcode };
}

function attachLastDiff(
    result: ActionParametersGraderCatalog,
    catalog: GeneratedActionCatalog,
    previous: ActionParametersGraderCatalog | undefined,
    effectiveRebuild: string[],
): void {
    // Refresh diff counts after integrity-driven rebuilds.
    const refreshed = diffActionParametersGrader(catalog, previous);
    for (const id of effectiveRebuild) {
        if (
            refreshed.unchanged.includes(id) ||
            (!refreshed.added.includes(id) && !refreshed.updated.includes(id))
        ) {
            refreshed.unchanged = refreshed.unchanged.filter((x) => x !== id);
            // Mark integrity rebuilds as updated if they were previously unchanged.
            if (
                !refreshed.updated.includes(id) &&
                !refreshed.added.includes(id)
            ) {
                refreshed.updated.push(id);
                refreshed.updated.sort();
            }
        }
    }
    result.lastDiff = refreshed;
}

export async function buildActionParametersGraderCatalog(
    catalog: GeneratedActionCatalog,
    options?: {
        generatedAt?: string;
        llm?: ParameterGraderLlm;
        /** Prior grader output for incremental merge. Omit or pass forceFull to rebuild all. */
        previous?: ActionParametersGraderCatalog;
        forceFull?: boolean;
        onProgress?: (done: number, total: number) => void;
        /** When true, attach lastDiff on the returned object (default true for callers). */
        includeLastDiff?: boolean;
        policy?: LoadedActionEligibilityPolicy;
        assertOverridesMatchCatalog?: boolean;
    },
): Promise<ActionParametersGraderCatalog> {
    const policy = activePolicy(options?.policy);
    if (options?.assertOverridesMatchCatalog !== false) {
        assertParameterOverridesMatchCatalog(catalog, policy);
    }
    const rulesFp = graderRulesFingerprint(policy);
    // Rules/heuristic/policy change -> full reclassify; keep per-action
    // sourceFingerprint as paramSpec-only so schema-stable rows stay stable.
    const previous =
        options?.forceFull === true ||
        (options?.previous !== undefined &&
            options.previous.rulesFingerprint !== rulesFp)
            ? undefined
            : options?.previous;
    const diff = diffActionParametersGrader(catalog, previous);
    const rebuildIds = new Set([...diff.added, ...diff.updated]);

    const actionsById = new Map<string, CatalogActionRow>();
    for (const action of catalog.actions) {
        actionsById.set(actionId(action.schemaName, action.actionName), action);
    }
    // Keep unchanged entries only after integrity checks vs live catalog.
    const byAction = keepUnchangedGraderEntries(
        previous,
        diff.unchanged,
        actionsById,
        rebuildIds,
    );
    // Drop ids moved from unchanged to rebuild.
    for (const id of rebuildIds) {
        delete byAction[id];
    }
    // Recompute added/updated labels for progress when integrity forced rebuild.
    const effectiveRebuild = [...rebuildIds].sort();
    Object.assign(
        byAction,
        await rebuildGraderEntries(effectiveRebuild, actionsById, previous, {
            ...(options?.llm !== undefined ? { llm: options.llm } : {}),
            ...(options?.onProgress !== undefined
                ? { onProgress: options.onProgress }
                : {}),
            policy,
        }),
    );

    const counts = countCatalogFieldSources(byAction);
    const result: ActionParametersGraderCatalog = {
        version: 1,
        description:
            "Create+verify policies per action parameter. " +
            "sourceFingerprint is paramSpec-only (stable across policy edits). " +
            "rulesFingerprint is catalog-level; when it drifts, all actions reclassify. " +
            "Incremental: only added/updated actions are reclassified; unchanged fingerprints are kept. " +
            "Hardcode name sets first, LLM prior reuse, LLM+verifier fallback. " +
            "Open strings without a name heuristic fall to the LLM+verifier fallback. " +
            "`create` guides the synthesizer; `verify` / `parameterScore` drive runner soft matching. `llmAsAJudge` marks code/script params that need semantic LLM scoring. " +
            "Object containers with only soft leaves use nonempty; mixed objects stay exact (no nested dotted paths yet).",
        catalogVersion: catalog.catalogVersion,
        generatedAt: options?.generatedAt ?? new Date().toISOString(),
        rulesFingerprint: rulesFp,
        modes: { ...ACTION_PARAM_VERIFY_MODE_DOCS },
        createPolicies: { ...ACTION_PARAM_CREATE_POLICY_DOCS },
        byAction,
        llmFallbackCount: counts.llm,
        hardcodeMatchCount: counts.hardcode,
    };
    if (options?.includeLastDiff !== false) {
        attachLastDiff(result, catalog, previous, effectiveRebuild);
    }
    return result;
}

export function toRecommendedByActionVerifyMap(
    catalog: ActionParametersGraderCatalog,
): Record<string, Record<string, ActionParamVerifyMode>> {
    const out: Record<string, Record<string, ActionParamVerifyMode>> = {};
    for (const [id, entry] of Object.entries(catalog.byAction)) {
        if (Object.keys(entry.parameterScore.fields).length === 0) {
            continue;
        }
        out[id] = { ...entry.parameterScore.fields };
    }
    return out;
}

function toRunnerParamFieldMode(
    mode: ActionParamVerifyMode,
): TranslationBenchParamFieldMode {
    return mode === "llmAsAJudge" ? "ignore" : mode;
}

export function parameterScoreSpecsForExpectedActions(
    grader: ActionParametersGraderCatalog,
    expectedActions: ReadonlyArray<{
        schemaName: string;
        actionName: string;
        parameters?: Record<string, unknown>;
    }>,
): Array<TranslationBenchParameterScoreSpec | undefined> {
    return expectedActions.map((action) => {
        const entry =
            grader.byAction[actionId(action.schemaName, action.actionName)];
        if (
            entry === undefined ||
            Object.keys(entry.parameterScore.fields).length === 0
        ) {
            return undefined;
        }
        return {
            defaultMode: toRunnerParamFieldMode(
                entry.parameterScore.defaultMode,
            ),
            fields: Object.fromEntries(
                Object.entries(entry.parameterScore.fields).map(
                    ([name, mode]) => [name, toRunnerParamFieldMode(mode)],
                ),
            ),
        };
    });
}

/** True when at least one expected action has a non-empty parameterScore map. */
export function hasUsableParameterScoreSpecs(
    specs: ReadonlyArray<TranslationBenchParameterScoreSpec | undefined>,
): boolean {
    return specs.some((spec) => spec !== undefined);
}
