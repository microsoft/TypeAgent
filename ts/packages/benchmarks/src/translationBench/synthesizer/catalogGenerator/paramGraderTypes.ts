// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";

import { z } from "zod";

import {
    canonicalizeParamSpec,
    isParamSpec,
    type ParamSpec,
} from "./paramTypes.js";
import {
    getPackagedActionEligibilityPolicy,
    type LoadedActionEligibilityPolicy,
} from "../../policy/loadPolicy.js";
import { isLlmJudgePayloadName } from "./paramGraderNameHeuristics.js";
export const GRADER_RULES_VERSION = 7;

export const HARDCODE_RULE_IDS = [
    "empty-name",
    "type-any",
    "type-boolean",
    "type-number",
    "type-object-exact",
    "type-object-soft-nonempty",
    "type-union-any",
    "type-union-structural",
    "string-enum-exact",
    "string-enum-unit-optional-ignore",
    "string-enum-unit-required-exact",
    "string-unit-ignore",
    "string-collection-element-nonempty",
    "string-free-text-nonempty",
    "string-date-nonempty",
    "string-time-nonempty",
    "string-identifier-exact",
    "string-original-request-ignore",
    "string-llm-as-a-judge",
] as const;

/** Runner soft-score modes (must stay aligned with runner.ts). */
export type ActionParamVerifyMode =
    | "exact"
    | "exists"
    | "nonempty"
    | "ignore"
    | "llmAsAJudge";

export type ActionParamCreatePolicy =
    | "enum_literal"
    | "typed_literal"
    | "free_text"
    | "identifier"
    | "temporal"
    | "unit_or_mode"
    | "record"
    | "opaque";

export type ActionParamClassifySource = "regex" | "hardcode" | "llm";

export interface ActionParameterFieldGrader {
    optional: boolean;
    type: ParamSpec;
    typeKind: string;
    create: ActionParamCreatePolicy;
    verify: ActionParamVerifyMode;
    rule: string;
    source: ActionParamClassifySource;
    item?: Omit<ActionParameterFieldGrader, "type" | "typeKind" | "optional">;
}

export interface ActionParametersGraderEntry {
    schemaName: string;
    actionName: string;
    paramSpec: ParamSpec;

    sourceFingerprint: string;
    fields: Record<string, ActionParameterFieldGrader>;
    parameterScore: {
        defaultMode: ActionParamVerifyMode;
        fields: Record<string, ActionParamVerifyMode>;
    };
}

export interface ActionParametersGraderDiff {
    added: string[];
    updated: string[];
    removed: string[];
    unchanged: string[];
}

export interface ActionParametersGraderCatalog {
    version: 1;
    description: string;
    catalogVersion: string;
    generatedAt: string;
    rulesFingerprint?: string;
    modes: Record<ActionParamVerifyMode, string>;
    createPolicies: Record<ActionParamCreatePolicy, string>;
    byAction: Record<string, ActionParametersGraderEntry>;
    llmFallbackCount: number;
    hardcodeMatchCount: number;

    lastDiff?: ActionParametersGraderDiff;
}

export interface CatalogActionRow {
    schemaName: string;
    actionName: string;
    paramSpec: unknown;
    parameters?: string;
    description?: string;
}

export interface GeneratedActionCatalog {
    catalogVersion: string;
    actions: CatalogActionRow[];
}

export const ACTION_PARAM_VERIFY_MODE_DOCS: Record<
    ActionParamVerifyMode,
    string
> = {
    exact: "Chosen value must deep-equal expected",
    exists: "Key must be present; value ignored (hand-authored seeds; not emitted by hardcode gen)",
    nonempty: "Key must be present and non-empty string/array",
    ignore: "Field not scored",
    llmAsAJudge:
        "Semantic equivalence needs an LLM judge (code/script/program payloads; many surface forms can be correct)",
};

export const ACTION_PARAM_CREATE_POLICY_DOCS: Record<
    ActionParamCreatePolicy,
    string
> = {
    enum_literal: "Mint a value from the field's string enum",
    typed_literal: "Mint a concrete boolean/number matching the type",
    free_text: "Mint natural-language text; soft-scored at verify",
    identifier: "Mint a stable name/id/path-like token; exact verify",
    temporal: "Mint a date/time string; verify mode depends on field role",
    unit_or_mode: "Mint a unit/mode/kind token; often ignored at soft verify",
    record: "Mint a nested object. Runner scores the top-level key only: pure soft-leaf objects use nonempty; mixed/exact leaves use deep-equal exact. Nested free-text (e.g. lookup.site[]) is not dotted-scored until the runner supports nested paths.",
    opaque: "Type is any/unknown; avoid relying on exact structure",
};

export interface FieldGraderDecision {
    create: ActionParamCreatePolicy;
    verify: ActionParamVerifyMode;
    rule: string;
    source: ActionParamClassifySource;

    item?: FieldGraderDecision;
}

export function activePolicy(
    override?: LoadedActionEligibilityPolicy,
): LoadedActionEligibilityPolicy {
    return override ?? getPackagedActionEligibilityPolicy();
}

/** Paths with verify=llmAsAJudge in the active policy (observational). */
export function listLlmJudgeParameterPaths(
    policy?: LoadedActionEligibilityPolicy,
): string[] {
    return [...activePolicy(policy).parameterOverrides.entries()]
        .filter(([, o]) => o.verify === "llmAsAJudge")
        .map(([path]) => path)
        .sort();
}

export function heuristicSourceHash(
    policy?: LoadedActionEligibilityPolicy,
): string {
    const loaded = activePolicy(policy);
    return createHash("sha256")
        .update(
            JSON.stringify({
                rules: [...HARDCODE_RULE_IDS].sort(),
                policyHash: loaded.contentHash,
            }),
        )
        .digest("hex")
        .slice(0, 16);
}

const LLM_JUDGE_SOFT_CREATE = new Set<ActionParamCreatePolicy>([
    "free_text",
    "opaque",
]);

export interface LlmJudgeFieldContext {
    create?: ActionParamCreatePolicy;
    actionId?: string;
    siblingFieldNames?: readonly string[];
}

function isLlmJudgeSoftCreate(
    create: ActionParamCreatePolicy | undefined,
): boolean {
    return create === undefined || LLM_JUDGE_SOFT_CREATE.has(create);
}

export function parameterRequiresLlmJudge(
    fieldName: string,
    createOrContext?: ActionParamCreatePolicy | LlmJudgeFieldContext,
    policy?: LoadedActionEligibilityPolicy,
): boolean {
    let ctx: LlmJudgeFieldContext;
    if (createOrContext === undefined) {
        ctx = {};
    } else if (typeof createOrContext === "string") {
        ctx = { create: createOrContext };
    } else {
        ctx = createOrContext;
    }
    const name = fieldName.trim();
    if (!name || !isLlmJudgeSoftCreate(ctx.create)) {
        return false;
    }
    if (isLlmJudgePayloadName(name)) {
        return true;
    }
    const actionId = ctx.actionId?.trim();
    if (!actionId) {
        return false;
    }
    const full = `${actionId}.${name}`;
    const ov = activePolicy(policy).parameterOverrides.get(full);
    return ov?.verify === "llmAsAJudge";
}

export function applyLlmAsAJudgeVerify(
    fieldName: string,
    decision: FieldGraderDecision,
    context?: Omit<LlmJudgeFieldContext, "create">,
    policy?: LoadedActionEligibilityPolicy,
): FieldGraderDecision {
    let item = decision.item;
    if (item !== undefined) {
        item = applyLlmAsAJudgeVerify(fieldName, item, context, policy);
    }
    const needs = parameterRequiresLlmJudge(
        fieldName,
        {
            create: decision.create,
            ...(context?.actionId !== undefined
                ? { actionId: context.actionId }
                : {}),
            ...(context?.siblingFieldNames !== undefined
                ? { siblingFieldNames: context.siblingFieldNames }
                : {}),
        },
        policy,
    );
    const itemNeeds = item?.verify === "llmAsAJudge";
    if (!needs && !itemNeeds) {
        if (item === decision.item) {
            return decision;
        }
        if (item === undefined) {
            const { item: _drop, ...rest } = decision;
            return rest;
        }
        return { ...decision, item };
    }
    if (itemNeeds && item !== undefined) {
        return {
            create: decision.create,
            verify: "llmAsAJudge",
            rule: `array-items:string-llm-as-a-judge`,
            source: decision.source,
            item,
        };
    }
    if (item !== undefined) {
        return {
            create: decision.create,
            verify: "llmAsAJudge",
            rule: "string-llm-as-a-judge",
            source: decision.source,
            item,
        };
    }
    return {
        create: decision.create,
        verify: "llmAsAJudge",
        rule: "string-llm-as-a-judge",
        source: decision.source,
    };
}

export interface ParameterGraderLlm {
    model: string;
    complete(prompt: string): Promise<string>;
}

const CREATE_POLICIES = [
    "enum_literal",
    "typed_literal",
    "free_text",
    "identifier",
    "temporal",
    "unit_or_mode",
    "record",
    "opaque",
] as const satisfies readonly ActionParamCreatePolicy[];

const VERIFY_MODES = [
    "exact",
    "exists",
    "nonempty",
    "ignore",
    "llmAsAJudge",
] as const satisfies readonly ActionParamVerifyMode[];

export const CREATE_SET = new Set<string>(CREATE_POLICIES);
export const VERIFY_SET = new Set<string>(VERIFY_MODES);
export const HARDCODE_RULE_SET = new Set<string>(HARDCODE_RULE_IDS);

/** Retired / invented rule ids that must never be reused. */
export const LEGACY_RULE_RE =
    /(?:^|:)(?:string-default[\w-]*|type-array-exact|default[\w-]*)(?:$|:)/i;

export const parameterGraderLlmDecisionSchema = z
    .object({
        create: z.enum(CREATE_POLICIES),
        verify: z.enum(VERIFY_MODES),
        rule: z
            .string()
            .trim()
            .min(1)
            .regex(
                /^[a-z][a-z0-9_]*$/,
                "rule must be snake_case (llm-authored reason id)",
            ),
    })
    .strict();

export type ParameterGraderLlmDecision = z.infer<
    typeof parameterGraderLlmDecisionSchema
>;

export const parameterGraderLlmVerifierSchema = z
    .object({
        decision: z.enum(["approve", "reject"]),
        scores: z
            .object({
                typeConsistency: z.number(),
                createVerifyCoherence: z.number(),
                scoreModeSoundness: z.number(),
                ruleSpecificity: z.number(),
            })
            .passthrough(),
        issues: z.array(z.unknown()).optional(),
        summary: z.string().optional(),
    })
    .passthrough();

/**
 * Stable identity of an action's parameter schema only.
 * Does NOT include rules/heuristic versions - those live on
 * catalog.rulesFingerprint so policy PRs do not rewrite every entry.
 */
export function actionParameterSourceFingerprint(
    paramSpec: ParamSpec,
    _parametersSummary?: string,
): string {
    return createHash("sha256")
        .update(JSON.stringify(canonicalizeParamSpec(paramSpec)))
        .digest("hex")
        .slice(0, 16);
}

/** Catalog-level policy code identity (rules version + heuristic bodies). */
export function graderRulesFingerprint(
    policy?: LoadedActionEligibilityPolicy,
): string {
    return createHash("sha256")
        .update(
            JSON.stringify({
                rulesVersion: GRADER_RULES_VERSION,
                heuristicSourceHash: heuristicSourceHash(policy),
            }),
        )
        .digest("hex")
        .slice(0, 16);
}

export function actionId(schemaName: string, actionName: string): string {
    return `${schemaName}.${actionName}`;
}

/** Fail if a policy override path does not exist on the catalog. */
export function assertParameterOverridesMatchCatalog(
    catalog: GeneratedActionCatalog,
    policy?: LoadedActionEligibilityPolicy,
): void {
    const loaded = activePolicy(policy);
    const fieldPaths = new Set<string>();
    for (const action of catalog.actions) {
        const id = actionId(action.schemaName, action.actionName);
        if (
            !isParamSpec(action.paramSpec) ||
            action.paramSpec.kind !== "object"
        ) {
            continue;
        }
        for (const name of Object.keys(action.paramSpec.fields)) {
            fieldPaths.add(`${id}.${name}`);
        }
    }
    const missing = [...loaded.parameterOverrides.keys()]
        .filter((path) => !fieldPaths.has(path))
        .sort();
    if (missing.length > 0) {
        throw new Error(
            `action-eligibility parameterOverrides paths missing from catalog: ${missing.join(", ")}`,
        );
    }
}

/** Canonical JSON equality for nested paramSpecs. */
export function nestedParamSpecEqual(a: ParamSpec, b: ParamSpec): boolean {
    return (
        JSON.stringify(canonicalizeParamSpec(a)) ===
        JSON.stringify(canonicalizeParamSpec(b))
    );
}
