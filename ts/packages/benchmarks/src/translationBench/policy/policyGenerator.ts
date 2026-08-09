// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { z } from "zod";

import { parseLlmJsonWithZod } from "../synthesizer/llmJson.js";
import type {
    TranslationBenchParameterScoreSpec,
    TranslationBenchParamFieldMode,
} from "../synthesizer/benchmark.js";
import {
    loadTranslationBenchParameterGraderPromptPack,
    renderTranslationBenchPromptTemplate,
    type TranslationBenchParameterGraderPromptPack,
} from "../synthesizer/synthesizerPrompts.js";
import {
    canonicalizeParamSpec,
    isParamSpec,
    paramSpecKind,
    type ParamSpec,
} from "./paramTypes.js";
import {
    getPackagedActionEligibilityPolicy,
    type LoadedActionEligibilityPolicy,
    type TranslationBenchPolicyVerifyMode,
} from "./loadPolicy.js";

export { fieldTreeIsLlmAsAJudge, listActionsWithLlmJudgeFields } from "./graderInspect.js";

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

export type ActionParamClassifySource = "hardcode" | "llm";

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


function activePolicy(
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

const CREATE_SET = new Set<string>(CREATE_POLICIES);
const VERIFY_SET = new Set<string>(VERIFY_MODES);
const HARDCODE_RULE_SET = new Set<string>(HARDCODE_RULE_IDS);

/** Retired / invented rule ids that must never be reused. */
const LEGACY_RULE_RE =
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

const parameterGraderLlmVerifierSchema = z
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
        if (!isParamSpec(action.paramSpec) || action.paramSpec.kind !== "object") {
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


function wrapArrayDecision(item: FieldGraderDecision): FieldGraderDecision {
    const looseVerify = loosenArrayVerifyMode(item);
    return {
        create: item.create,
        verify: looseVerify,
        rule: `array-items:${stripReusedPrefix(item.rule)}`,
        source: item.source,
        item: {
            ...item,
        },
    };
}

function isSoftVerify(mode: ActionParamVerifyMode): boolean {
    return mode === "nonempty" || mode === "ignore" || mode === "exists";
}

function classifyObjectFieldRegex(
    spec: Extract<ParamSpec, { kind: "object" }>,
): FieldGraderDecision {
    const fieldEntries = Object.entries(spec.fields);
    if (fieldEntries.length === 0) {
        return {
            create: "record",
            verify: "exact",
            rule: "type-object-exact",
            source: "hardcode",
        };
    }
    for (const [n, f] of fieldEntries) {
        const leaf = tryClassifyActionParameterFieldHardcode(
            n,
            f.spec,
            f.optional,
        );
        if (leaf === undefined || !isSoftVerify(leaf.verify)) {
            return {
                create: "record",
                verify: "exact",
                rule: "type-object-exact",
                source: "hardcode",
            };
        }
    }
    return {
        create: "record",
        verify: "nonempty",
        rule: "type-object-soft-nonempty",
        source: "hardcode",
    };
}

function classifyStringFieldRegex(
    name: string,
    spec: Extract<ParamSpec, { kind: "string" }>,
    optional: boolean,
): FieldGraderDecision | undefined {
    if (spec.enum !== undefined && spec.enum.length > 0) {
        if (isUnitOrModeName(name)) {
            return {
                create: "unit_or_mode",
                verify: optional ? "ignore" : "exact",
                rule: optional
                    ? "string-enum-unit-optional-ignore"
                    : "string-enum-unit-required-exact",
                source: "hardcode",
            };
        }
        return {
            create: "enum_literal",
            verify: "exact",
            rule: "string-enum-exact",
            source: "hardcode",
        };
    }

    if (isUnitOrModeName(name)) {
        return {
            create: "unit_or_mode",
            verify: "ignore",
            rule: "string-unit-ignore",
            source: "hardcode",
        };
    }
    if (isOriginalRequestEchoName(name)) {
        return {
            create: "free_text",
            verify: "ignore",
            rule: "string-original-request-ignore",
            source: "hardcode",
        };
    }
    if (isLlmJudgePayloadName(name)) {
        return {
            create: "free_text",
            verify: "llmAsAJudge",
            rule: "string-llm-as-a-judge",
            source: "hardcode",
        };
    }
    if (isIdentityListName(name)) {
        return {
            create: "identifier",
            verify: "exact",
            rule: "string-identifier-exact",
            source: "hardcode",
        };
    }
    if (isLooseCollectionElementName(name)) {
        return {
            create: "free_text",
            verify: "nonempty",
            rule: "string-collection-element-nonempty",
            source: "hardcode",
        };
    }
    if (isFreeTextName(name)) {
        return {
            create: "free_text",
            verify: "nonempty",
            rule: "string-free-text-nonempty",
            source: "hardcode",
        };
    }
    if (isDateName(name)) {
        return {
            create: "temporal",
            verify: "nonempty",
            rule: "string-date-nonempty",
            source: "hardcode",
        };
    }
    if (isTimeName(name)) {
        return {
            create: "temporal",
            verify: "nonempty",
            rule: "string-time-nonempty",
            source: "hardcode",
        };
    }
    if (isIdentifierName(name)) {
        return {
            create: "identifier",
            verify: "exact",
            rule: "string-identifier-exact",
            source: "hardcode",
        };
    }
    return undefined;
}

export function tryClassifyActionParameterFieldHardcode(
    fieldName: string,
    spec: ParamSpec,
    optional: boolean,
): FieldGraderDecision | undefined {
    const name = fieldName.trim();
    if (!name) {
        return {
            create: "opaque",
            verify: "ignore",
            rule: "empty-name",
            source: "hardcode",
        };
    }

    switch (spec.kind) {
        case "any":
            return {
                create: "opaque",
                verify: "ignore",
                rule: "type-any",
                source: "hardcode",
            };

        case "boolean":
        case "number":
            return {
                create: "typed_literal",
                verify: "exact",
                rule: `type-${spec.kind}`,
                source: "hardcode",
            };

        case "array": {
            const item = tryClassifyActionParameterFieldHardcode(
                name,
                spec.item,
                optional,
            );
            if (item === undefined) {
                return undefined;
            }
            return wrapArrayDecision(item);
        }

        case "object":
            return classifyObjectFieldRegex(spec);

        case "union":
            if (spec.arms.every((a) => a.kind === "any")) {
                return {
                    create: "opaque",
                    verify: "ignore",
                    rule: "type-union-any",
                    source: "hardcode",
                };
            }
            return {
                create: "record",
                verify: "exact",
                rule: "type-union-structural",
                source: "hardcode",
            };

        case "string":
            return classifyStringFieldRegex(name, spec, optional);
    }
}

function stripReusedPrefix(rule: string): string {
    return rule.replace(/^(?:reused:)+/, "");
}

function isLiveReusableRule(rule: string): boolean {
    const bare = stripReusedPrefix(rule);
    if (!bare || LEGACY_RULE_RE.test(bare) || /default/i.test(bare)) {
        return false;
    }
    // Live hardcode rule ids or llm:snake_case
    if (bare.startsWith("llm:")) {
        return /^llm:[a-z][a-z0-9_]*$/.test(bare);
    }
    if (bare.startsWith("array-items:")) {
        return isLiveReusableRule(bare.slice("array-items:".length));
    }
    return HARDCODE_RULE_SET.has(bare) || bare.startsWith("array-items:");
}

function enumSetsEqual(a: ParamSpec, b: ParamSpec): boolean {
    if (a.kind !== "string" || b.kind !== "string") return true;
    const ae = a.enum;
    const be = b.enum;
    if (ae === undefined && be === undefined) return true;
    if (ae === undefined || be === undefined) return false;
    if (ae.length !== be.length) return false;
    const as = [...ae].sort();
    const bs = [...be].sort();
    return as.every((v, i) => v === bs[i]);
}

function nestedParamSpecEqual(a: ParamSpec, b: ParamSpec): boolean {
    return (
        JSON.stringify(canonicalizeParamSpec(a)) ===
        JSON.stringify(canonicalizeParamSpec(b))
    );
}

export function tryReusePriorFieldGraderDecision(
    prior: ActionParameterFieldGrader | undefined,
    spec: ParamSpec,
    optional?: boolean,
): FieldGraderDecision | undefined {
    if (prior === undefined) return undefined;
    if (prior.source !== "llm") return undefined;
    if (paramSpecKind(spec) !== prior.typeKind) return undefined;
    if (optional !== undefined && prior.optional !== optional) return undefined;
    if (prior.create === "opaque" && spec.kind !== "any") return undefined;
    if (!isLiveReusableRule(prior.rule)) return undefined;
    if (!enumSetsEqual(spec, prior.type)) return undefined;
    if (
        (spec.kind === "object" ||
            spec.kind === "array" ||
            spec.kind === "union") &&
        !nestedParamSpecEqual(spec, prior.type)
    ) {
        return undefined;
    }
    if (spec.kind === "array" && prior.item === undefined) {
        return undefined;
    }

    const decision: FieldGraderDecision = {
        create: prior.create,
        verify: prior.verify,
        rule: prior.rule.startsWith("reused:")
            ? prior.rule
            : `reused:${prior.rule}`,
        source: prior.source,
    };
    if (prior.item !== undefined) {
        if (!isLiveReusableRule(prior.item.rule)) return undefined;
        if (prior.item.source !== "llm") return undefined;
        decision.item = {
            create: prior.item.create,
            verify: prior.item.verify,
            rule: prior.item.rule.startsWith("reused:")
                ? prior.item.rule
                : `reused:${prior.item.rule}`,
            source: prior.item.source,
        };
    }
    return decision;
}

export async function classifyActionParameterFieldWithFallback(
    fieldName: string,
    spec: ParamSpec,
    optional: boolean,
    context: {
        schemaName: string;
        actionName: string;
        parametersSummary?: string;
        description?: string;
        llm?: ParameterGraderLlm;
        priorField?: ActionParameterFieldGrader;
    },
): Promise<FieldGraderDecision> {
    if (spec.kind === "array") {
        const itemPrior =
            context.priorField?.item !== undefined
                ? {
                      optional,
                      type: spec.item,
                      typeKind: paramSpecKind(spec.item),
                      create: context.priorField.item.create,
                      verify: context.priorField.item.verify,
                      rule: context.priorField.item.rule,
                      source: context.priorField.item.source,
                  }
                : undefined;
        const itemDecision = await classifyActionParameterFieldWithFallback(
            fieldName,
            spec.item,
            optional,
            {
                schemaName: context.schemaName,
                actionName: context.actionName,
                ...(context.parametersSummary !== undefined
                    ? { parametersSummary: context.parametersSummary }
                    : {}),
                ...(context.description !== undefined
                    ? { description: context.description }
                    : {}),
                ...(context.llm !== undefined ? { llm: context.llm } : {}),
                ...(itemPrior !== undefined ? { priorField: itemPrior } : {}),
            },
        );
        const leaf =
            itemDecision.item !== undefined &&
            itemDecision.rule.startsWith("array-items:")
                ? itemDecision.item
                : itemDecision;
        return wrapArrayDecision(leaf);
    }

    const hardcode = tryClassifyActionParameterFieldHardcode(
        fieldName,
        spec,
        optional,
    );
    if (hardcode !== undefined) {
        return hardcode;
    }
    const reused = tryReusePriorFieldGraderDecision(
        context.priorField,
        spec,
        optional,
    );
    if (reused !== undefined) {
        return reused;
    }
    if (context.llm === undefined) {
        throw new Error(
            `Parameter '${context.schemaName}.${context.actionName}.${fieldName}' ` +
                `has no hardcode rule; provide an LLM fallback (--model) instead of defaulting`,
        );
    }
    return classifyActionParameterFieldWithLlm(fieldName, spec, optional, {
        ...context,
        llm: context.llm,
    });
}

type ParameterGraderLlmContext = {
    schemaName: string;
    actionName: string;
    parametersSummary?: string;
    description?: string;
    llm: ParameterGraderLlm;
    promptPack?: TranslationBenchParameterGraderPromptPack;
};

function buildClassifierPrompt(
    pack: TranslationBenchParameterGraderPromptPack,
    fieldName: string,
    spec: ParamSpec,
    optional: boolean,
    context: ParameterGraderLlmContext,
    verifierFeedback: string,
): string {
    const baseSummary = context.parametersSummary?.trim() || "(none)";
    return renderTranslationBenchPromptTemplate(
        pack.policyClassifier.template,
        {
            schema_name: context.schemaName,
            action_name: context.actionName,
            action_description_block:
                context.description !== undefined && context.description.trim()
                    ? `Action description: ${context.description.trim()}`
                    : "Action description: (none)",
            field_name: fieldName,
            optional: optional ? "true" : "false",
            field_type_json: JSON.stringify(spec, null, 2),
            parameters_summary: verifierFeedback
                ? `${baseSummary}\n\nPrior verifier feedback (fix):\n${verifierFeedback}`
                : baseSummary,
            create_policies: pack.policyClassifier.createPolicies
                .filter((p) => CREATE_SET.has(p))
                .join(", "),
            verify_modes: pack.policyClassifier.verifyModes.join(", "),
        },
    );
}

function isVerifierApproved(
    verdict: z.infer<typeof parameterGraderLlmVerifierSchema>,
    threshold: number,
): boolean {
    const scores = verdict.scores;
    const scoresOk =
        scores.typeConsistency >= threshold &&
        scores.createVerifyCoherence >= threshold &&
        scores.scoreModeSoundness >= threshold &&
        scores.ruleSpecificity >= threshold;
    const issuesEmpty =
        verdict.issues === undefined || verdict.issues.length === 0;
    return verdict.decision === "approve" && scoresOk && issuesEmpty;
}

async function runPolicyVerifier(
    pack: TranslationBenchParameterGraderPromptPack,
    fieldName: string,
    spec: ParamSpec,
    optional: boolean,
    context: ParameterGraderLlmContext,
    decision: ParameterGraderLlmDecision,
    attempt: number,
): Promise<{ ok: true } | { ok: false; feedback: string; error: string }> {
    const candidate = {
        create: decision.create,
        verify: decision.verify,
        rule: decision.rule,
    };
    const verifierPrompt = renderTranslationBenchPromptTemplate(
        pack.policyVerifier.template,
        {
            schema_name: context.schemaName,
            action_name: context.actionName,
            field_name: fieldName,
            optional: optional ? "true" : "false",
            field_type_json: JSON.stringify(spec, null, 2),
            candidate_policy_json: JSON.stringify(candidate, null, 2),
            approve_score_threshold: String(
                pack.policyVerifier.approveScoreThreshold,
            ),
            issue_codes: pack.policyVerifier.issueCodes.join(", "),
        },
    );
    const verifierText = await context.llm.complete(verifierPrompt);
    let verdict: z.infer<typeof parameterGraderLlmVerifierSchema>;
    try {
        verdict = parseLlmJsonWithZod(
            verifierText,
            parameterGraderLlmVerifierSchema,
            `Parameter-grader verifier (${context.schemaName}.${context.actionName}.${fieldName} attempt ${attempt})`,
        );
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { ok: false, feedback: msg, error: msg };
    }

    if (
        isVerifierApproved(verdict, pack.policyVerifier.approveScoreThreshold)
    ) {
        return { ok: true };
    }

    const issuesEmpty =
        verdict.issues === undefined || verdict.issues.length === 0;
    const error = `Verifier ${verdict.decision} (issues=${issuesEmpty ? 0 : verdict.issues?.length}): ${verdict.summary ?? ""}`;
    return {
        ok: false,
        error,
        feedback: JSON.stringify(
            {
                decision: verdict.decision,
                scores: verdict.scores,
                issues: verdict.issues ?? [],
                summary: verdict.summary,
            },
            null,
            2,
        ),
    };
}

function toLlmFieldDecision(
    decision: ParameterGraderLlmDecision,
): FieldGraderDecision {
    return {
        create: decision.create,
        verify: decision.verify,
        rule: `llm:${decision.rule}`,
        source: "llm",
    };
}

export async function classifyActionParameterFieldWithLlm(
    fieldName: string,
    spec: ParamSpec,
    optional: boolean,
    context: ParameterGraderLlmContext,
): Promise<FieldGraderDecision> {
    const pack =
        context.promptPack ?? loadTranslationBenchParameterGraderPromptPack();
    const maxAttempts = Math.max(1, pack.acceptance.maxClassifierAttempts);
    const requireVerifier = pack.acceptance.requireVerifierApproveForLlm;

    let lastError: string | undefined;
    let verifierFeedback = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const prompt = buildClassifierPrompt(
            pack,
            fieldName,
            spec,
            optional,
            context,
            verifierFeedback,
        );
        const text = await context.llm.complete(prompt);
        let decision: ParameterGraderLlmDecision;
        try {
            decision = parseLlmJsonWithZod(
                text,
                parameterGraderLlmDecisionSchema,
                `Parameter-grader classifier (${context.schemaName}.${context.actionName}.${fieldName} attempt ${attempt})`,
            );
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            verifierFeedback = lastError;
            continue;
        }

        if (/default/i.test(decision.rule)) {
            lastError = `LLM rule id '${decision.rule}' looks like a default; rejected`;
            verifierFeedback = lastError;
            continue;
        }

        if (!requireVerifier) {
            return toLlmFieldDecision(decision);
        }

        const verified = await runPolicyVerifier(
            pack,
            fieldName,
            spec,
            optional,
            context,
            decision,
            attempt,
        );
        if (verified.ok) {
            return toLlmFieldDecision(decision);
        }
        lastError = verified.error;
        verifierFeedback = verified.feedback;
    }

    throw new Error(
        `Parameter-grader LLM failed closed for ` +
            `${context.schemaName}.${context.actionName}.${fieldName} ` +
            `after ${maxAttempts} attempt(s)` +
            (lastError ? `: ${lastError}` : ""),
    );
}

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

function defaultCreateForOverride(
    fieldName: string,
    spec: ParamSpec,
    optional: boolean,
    verify: TranslationBenchPolicyVerifyMode,
): FieldGraderDecision {
    if (spec.kind === "array") {
        const item = defaultCreateForOverride(
            fieldName,
            spec.item,
            optional,
            verify,
        );
        return wrapArrayDecision({ ...item, verify });
    }

    const hardcode = tryClassifyActionParameterFieldHardcode(fieldName, spec, optional);
    if (hardcode !== undefined) {
        let item = hardcode.item;
        if (item !== undefined) {
            item = { ...item, verify };
        }
        return {
            create: hardcode.create,
            verify,
            rule: `policy-override:${hardcode.rule}`,
            source: "hardcode",
            ...(item !== undefined ? { item } : {}),
        };
    }
    if (spec.kind === "string") {
        return {
            create: "free_text",
            verify,
            rule: "policy-override:structural",
            source: "hardcode",
        };
    }
    if (spec.kind === "boolean" || spec.kind === "number") {
        return {
            create: "typed_literal",
            verify,
            rule: "policy-override:structural",
            source: "hardcode",
        };
    }
    if (spec.kind === "object") {
        return {
            create: "record",
            verify,
            rule: "policy-override:structural",
            source: "hardcode",
        };
    }
    return {
        create: "opaque",
        verify,
        rule: "policy-override:structural",
        source: "hardcode",
    };
}

export async function buildActionParametersGraderEntry(
    schemaName: string,
    actionName: string,
    paramSpec: ParamSpec,
    options?: {
        parametersSummary?: string;
        description?: string;
        llm?: ParameterGraderLlm;
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
                        ...(options?.llm !== undefined ? { llm: options.llm } : {}),
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
        } else if (field.source === "hardcode") {
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
            if (field.item.source === "llm") {
                llm += 1;
            } else if (field.item.source === "hardcode") {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateItemGrader(
    fieldName: string,
    item: unknown,
    actionIdLabel: string,
): void {
    if (!isPlainObject(item)) {
        throw new Error(
            `Invalid item grader for ${actionIdLabel}.${fieldName}: not an object`,
        );
    }
    if (typeof item.create !== "string" || !CREATE_SET.has(item.create)) {
        throw new Error(
            `Invalid item grader for ${actionIdLabel}.${fieldName}: create`,
        );
    }
    if (typeof item.verify !== "string" || !VERIFY_SET.has(item.verify)) {
        throw new Error(
            `Invalid item grader for ${actionIdLabel}.${fieldName}: verify`,
        );
    }
    if (typeof item.rule !== "string" || !item.rule.trim()) {
        throw new Error(
            `Invalid item grader for ${actionIdLabel}.${fieldName}: rule`,
        );
    }
    if (LEGACY_RULE_RE.test(item.rule) || /default/i.test(item.rule)) {
        throw new Error(
            `Invalid item grader for ${actionIdLabel}.${fieldName}: legacy/default rule '${item.rule}'`,
        );
    }
    if (item.source !== "hardcode" && item.source !== "llm") {
        throw new Error(
            `Invalid item grader for ${actionIdLabel}.${fieldName}: source must be hardcode|llm`,
        );
    }
    if (item.item !== undefined) {
        validateItemGrader(`${fieldName}.item`, item.item, actionIdLabel);
    }
}

function validateFieldGrader(
    fieldName: string,
    field: unknown,
    actionIdLabel: string,
): asserts field is ActionParameterFieldGrader {
    if (!isPlainObject(field)) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: not an object`,
        );
    }
    if (typeof field.optional !== "boolean") {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: optional`,
        );
    }
    if (!isParamSpec(field.type)) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: type`,
        );
    }
    if (typeof field.typeKind !== "string" || !field.typeKind) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: typeKind`,
        );
    }
    if (typeof field.create !== "string" || !CREATE_SET.has(field.create)) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: create`,
        );
    }
    if (typeof field.verify !== "string" || !VERIFY_SET.has(field.verify)) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: verify`,
        );
    }
    if (typeof field.rule !== "string" || !field.rule.trim()) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: rule`,
        );
    }
    if (LEGACY_RULE_RE.test(field.rule) || /default/i.test(field.rule)) {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: legacy/default rule '${field.rule}'`,
        );
    }
    if (field.source !== "hardcode" && field.source !== "llm") {
        throw new Error(
            `Invalid field grader for ${actionIdLabel}.${fieldName}: source must be hardcode|llm`,
        );
    }
    if (field.item !== undefined) {
        validateItemGrader(fieldName, field.item, actionIdLabel);
    }
}

function validateGraderEntry(
    id: string,
    entry: unknown,
): asserts entry is ActionParametersGraderEntry {
    if (!isPlainObject(entry)) {
        throw new Error(`Invalid grader entry for ${id}: not an object`);
    }
    if (typeof entry.schemaName !== "string" || !entry.schemaName) {
        throw new Error(`Invalid grader entry for ${id}: schemaName`);
    }
    if (typeof entry.actionName !== "string" || !entry.actionName) {
        throw new Error(`Invalid grader entry for ${id}: actionName`);
    }
    if (!isParamSpec(entry.paramSpec)) {
        throw new Error(`Invalid grader entry for ${id}: paramSpec`);
    }
    if (
        typeof entry.sourceFingerprint !== "string" ||
        !/^[0-9a-f]{16}$/.test(entry.sourceFingerprint)
    ) {
        throw new Error(`Invalid grader entry for ${id}: sourceFingerprint`);
    }
    // Load skips fingerprint recompute; build path force-rebuilds on rules/hash drift.
    if (!isPlainObject(entry.fields)) {
        throw new Error(`Invalid grader entry for ${id}: fields`);
    }
    for (const [name, field] of Object.entries(entry.fields)) {
        validateFieldGrader(name, field, id);
    }
    if (
        !isPlainObject(entry.parameterScore) ||
        !isPlainObject(entry.parameterScore.fields)
    ) {
        throw new Error(`Invalid grader entry for ${id}: parameterScore`);
    }
    const defaultMode = entry.parameterScore.defaultMode;
    if (typeof defaultMode !== "string" || !VERIFY_SET.has(defaultMode)) {
        throw new Error(
            `Invalid grader entry for ${id}: parameterScore.defaultMode`,
        );
    }
    const scoreFields = entry.parameterScore.fields as Record<string, unknown>;
    const fieldKeys = new Set(Object.keys(entry.fields));
    const scoreKeys = new Set(Object.keys(scoreFields));
    if (fieldKeys.size !== scoreKeys.size) {
        throw new Error(
            `Invalid grader entry for ${id}: parameterScore.fields key set ≠ fields`,
        );
    }
    for (const name of fieldKeys) {
        if (!scoreKeys.has(name)) {
            throw new Error(
                `Invalid grader entry for ${id}: parameterScore.fields missing '${name}'`,
            );
        }
        const mode = scoreFields[name];
        if (typeof mode !== "string" || !VERIFY_SET.has(mode)) {
            throw new Error(
                `Invalid grader entry for ${id}: parameterScore.fields.${name} mode`,
            );
        }
        const field = entry.fields[name] as ActionParameterFieldGrader;
        if (mode !== field.verify) {
            throw new Error(
                `Invalid grader entry for ${id}: parameterScore.fields.${name} !== fields.${name}.verify`,
            );
        }
    }
    // Object paramSpec field keys must match grader fields.
    if (entry.paramSpec.kind === "object") {
        const expected = new Set(Object.keys(entry.paramSpec.fields));
        if (
            expected.size !== fieldKeys.size ||
            [...expected].some((k) => !fieldKeys.has(k))
        ) {
            throw new Error(
                `Invalid grader entry for ${id}: fields keys ≠ paramSpec.fields`,
            );
        }
    }
}

export function loadActionParametersGraderCatalogFile(
    filePath: string,
): ActionParametersGraderCatalog | undefined {
    if (!existsSync(filePath)) {
        return undefined;
    }
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!isPlainObject(raw)) {
        throw new Error(`Invalid grader catalog at ${filePath}`);
    }
    if (raw.version !== 1 || !isPlainObject(raw.byAction)) {
        throw new Error(
            `Unsupported or corrupt grader catalog at ${filePath} (expected version 1 + byAction object)`,
        );
    }
    for (const [id, entry] of Object.entries(raw.byAction)) {
        validateGraderEntry(id, entry);
    }
    return raw as unknown as ActionParametersGraderCatalog;
}

const requireFromHere = createRequire(import.meta.url);
let cachedPackagedActionParametersGrader:
    | ActionParametersGraderCatalog
    | undefined;

/**
 * Packaged deterministic parameter grader, loaded from the generated JSON that
 * ships with the benchmark. Cached; used to derive per-case `parameterScore`
 * specs so the runner soft-matches params (e.g. free-text `nonempty`) instead
 * of exact-matching everything.
 */
export function getPackagedActionParametersGraderCatalog(): ActionParametersGraderCatalog {
    if (cachedPackagedActionParametersGrader === undefined) {
        const graderPath = requireFromHere.resolve(
            "../action-parameters-grader.generated.json",
        );
        const catalog = loadActionParametersGraderCatalogFile(graderPath);
        if (catalog === undefined) {
            throw new Error(
                `Missing packaged action-parameters grader at ${graderPath}`,
            );
        }
        cachedPackagedActionParametersGrader = catalog;
    }
    return cachedPackagedActionParametersGrader;
}

export function clearPackagedActionParametersGraderCacheForTests(): void {
    cachedPackagedActionParametersGrader = undefined;
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
    const refreshed = diffActionParametersGrader(catalog, previous);
    for (const id of effectiveRebuild) {
        if (
            refreshed.unchanged.includes(id) ||
            (!refreshed.added.includes(id) && !refreshed.updated.includes(id))
        ) {
            refreshed.unchanged = refreshed.unchanged.filter((x) => x !== id);
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
        previous?: ActionParametersGraderCatalog;
        forceFull?: boolean;
        onProgress?: (done: number, total: number) => void;
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
    const byAction = keepUnchangedGraderEntries(
        previous,
        diff.unchanged,
        actionsById,
        rebuildIds,
    );
    for (const id of rebuildIds) {
        delete byAction[id];
    }
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
            "Open strings without a name heuristic use structural free_text/nonempty. " +
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

export function loosenArrayVerifyMode(
    element: ActionParamVerifyMode | FieldGraderDecision,
): ActionParamVerifyMode {
    const elementVerify =
        typeof element === "string" ? element : element.verify;
    const create = typeof element === "string" ? undefined : element.create;

    if (
        elementVerify === "ignore" ||
        elementVerify === "exists" ||
        elementVerify === "nonempty" ||
        elementVerify === "llmAsAJudge"
    ) {
        return elementVerify;
    }
    if (create === "free_text" || create === "temporal") {
        return "nonempty";
    }
    return "exact";
}

function nameSet(names: readonly string[]): ReadonlySet<string> {
    return new Set(names);
}
const UNIT_OR_MODE_NAMES = nameSet([
    "editorPosition",
    "effort",
    "format",
    "kind",
    "mode",
    "precision",
    "scale",
    "state",
    "taskSelection",
    "unit",
    "units",
    "verbosity",
]);

const ORIGINAL_REQUEST_ECHO_NAMES = nameSet([
    "originalRequest",
    "original_request",
    "userUtterance",
    "user_utterance",
    "rawRequest",
    "raw_request",
]);

const LLM_JUDGE_PAYLOAD_NAMES = nameSet([
    "codeSnippet",
    "commandArgs",
    "commandToExecute",
    "declaration",
    "flowArgs",
    "flowParametersJson",
    "functionDeclaration",
    "generatedContent",
    "internetLookups",
    "recordedSteps",
    "script",
    "validationResults",
]);

const FREE_TEXT_NAMES = nameSet([
    "actionDescription",
    "adapter",
    "additionalMessage",
    "after",
    "allow",
    "app",
    "artifact",
    "assignee",
    "attemptedAction",
    "avatar",
    "avatar_url",
    "banner",
    "bcc",
    "before",
    "body",
    "caption",
    "cc",
    "cityQuery",
    "clarifyingQuestion",
    "color",
    "commit",
    "condition",
    "content",
    "context",
    "deny",
    "description",
    "docstring",
    "domain",
    "durationMinutes",
    "editPrompt",
    "emojiChar",
    "endpoint",
    "every",
    "extensionQuery",
    "feature",
    "field",
    "filterByUserQuery",
    "folderRelativeTo",
    "generatedText",
    "goal",
    "head",
    "hint",
    "hostname",
    "icon",
    "input",
    "instructions",
    "intent",
    "key",
    "label",
    "language",
    "leftWindow",
    "location",
    "mergeMethod",
    "mergedMontageTitle",
    "message",
    "messageRef",
    "metadata",
    "method",
    "model",
    "newTitle",
    "nick",
    "nonce",
    "notes",
    "outputDir",
    "params",
    "participant",
    "password",
    "phrase",
    "platform_username",
    "progressStatus",
    "prompt",
    "query",
    "question",
    "reason",
    "ref",
    "reference",
    "region",
    "relativeTo",
    "request",
    "returnType",
    "rightWindow",
    "schedule",
    "searchTerm",
    "selection",
    "severity",
    "shell",
    "site",
    "sizeOverride",
    "songs",
    "sourceImage",
    "specSource",
    "ssid",
    "startUrl",
    "status",
    "style",
    "subject",
    "suggestionItem",
    "tabDescription",
    "tag",
    "task",
    "text",
    "title",
    "to",
    "token",
    "topic",
    "url",
    "username",
    "value",
]);

const LOOSE_COLLECTION_ELEMENT_NAMES = nameSet([
    "access_tokens",
    "args",
    "artists",
    "attachFiles",
    "attachments",
    "contextEntities",
    "domains",
    "entries",
    "extensions",
    "fileTypes",
    "files",
    "generatedTextEntities",
    "ids",
    "items",
    "keywords",
    "labels",
    "nicks",
    "options",
    "phrasesPerAction",
    "relatedFiles",
    "screenshots",
    "search_filters",
    "sites",
    "tags",
    "titles",
    "userRequestEntities",
    "values",
]);

const IDENTITY_LIST_NAMES = nameSet([
    "agentNames",
    "allowedCmdlets",
    "allowedModules",
    "excludeActions",
    "existingActionNames",
    "forActions",
    "includeActions",
    "names",
    "possibleActionNames",
]);

const DATE_NAMES = nameSet([
    "date",
    "day",
    "days",
    "dueDate",
    "endDate",
    "startDate",
]);

const TIME_NAMES = nameSet([
    "dueTime",
    "endHour",
    "endTime",
    "hour",
    "minute",
    "seconds",
    "startHour",
    "startTime",
    "time",
    "timestamp",
    "when",
]);

const IDENTIFIER_NAMES = nameSet([
    "accessSetting",
    "access_token",
    "actionName",
    "agentName",
    "aiCommand",
    "alarmName",
    "alignment",
    "all",
    "alwaysShow",
    "amount",
    "apiType",
    "application_id",
    "args",
    "attachScreenshot",
    "attemptLimit",
    "author",
    "autoAccept",
    "autoReload",
    "auto_archive_duration",
    "base",
    "branch",
    "breakpointId",
    "brightnessLevel",
    "candidates",
    "caseSensitive",
    "channel_id",
    "classID",
    "columnCount",
    "command",
    "commandName",
    "commandRiskLevel",
    "commentStyle",
    "configurationName",
    "conversationLookupFilters",
    "count",
    "cursorPosition",
    "days",
    "desktopId",
    "deviceName",
    "direction",
    "displayName",
    "draft",
    "duration",
    "elevate",
    "enable",
    "enableAutoTimeSync",
    "enableBadging",
    "enableBluetooth",
    "enableColor",
    "enabled",
    "endHour",
    "endLine",
    "exactMatch",
    "excludeUntitled",
    "explanationMode",
    "file",
    "fileName",
    "filePath",
    "filter",
    "filterByCategory",
    "filterByKnownQuery",
    "filterEffect",
    "flowName",
    "focus",
    "focusExistingIfOpen",
    "folderName",
    "folderPath",
    "force",
    "fragments",
    "fromPhase",
    "genContent",
    "generatedTextEntities",
    "goto",
    "grammarPatterns",
    "groupBy",
    "guild_id",
    "guild_scheduled_event_id",
    "height",
    "hideWhenNotUsing",
    "hour",
    "htmlOutput",
    "id",
    "ids",
    "includeGenerated",
    "indices",
    "inferredActions",
    "integrationName",
    "invite_code",
    "isAsync",
    "isMuted",
    "isPartial",
    "isPartialQuery",
    "length",
    "level",
    "limit",
    "line",
    "listName",
    "logResult",
    "lookup",
    "matchBy",
    "matchStrategy",
    "maxDepth",
    "maxSteps",
    "maxTurns",
    "max_age",
    "max_uses",
    "messageNumber",
    "message_id",
    "minSearchScore",
    "minute",
    "name",
    "never_expires",
    "newMaxVolumeLevel",
    "newName",
    "newSession",
    "newSessionLocation",
    "newVolumeLevel",
    "newlineAfter",
    "newlineBefore",
    "nightLightScheduleDisabled",
    "noDebug",
    "nsfw",
    "numImages",
    "numResults",
    "number",
    "on",
    "onlyDirty",
    "openInEditor",
    "openInNewTab",
    "operation",
    "orientation",
    "outputPath",
    "overwriteIfExists",
    "overwrite_id",
    "owner",
    "parameterName",
    "parseJson",
    "path",
    "pattern",
    "phrasesPerAction",
    "platform_name",
    "play",
    "playlistNumber",
    "position",
    "powerMode",
    "primaryButton",
    "private",
    "promptUser",
    "provider",
    "public",
    "quantity",
    "recipient_id",
    "reduceSpeed",
    "refreshRate",
    "register",
    "registerAgent",
    "repo",
    "resolutionHint",
    "reuseExistingTerminal",
    "running",
    "saveChanges",
    "scope",
    "scopeType",
    "scriptParameters",
    "scrollLines",
    "seconds",
    "select",
    "selected",
    "selectedIndices",
    "service",
    "showErrorIfNoActiveEditor",
    "showToken",
    "shuffle",
    "size",
    "sizeAdjustment",
    "speed",
    "speedLevel",
    "startHour",
    "startLine",
    "startedAtMs",
    "stepType",
    "strategy",
    "tab",
    "tabIndex",
    "target",
    "targetVolume",
    "target_users_file",
    "template",
    "temporary",
    "theme",
    "themeName",
    "thresholdValue",
    "timeout",
    "traceId",
    "trackCount",
    "trackNumber",
    "tts",
    "type",
    "unique",
    "unstar",
    "untitled",
    "useRegex",
    "userRequestEntities",
    "user_id",
    "viewKind",
    "viewMode",
    "visibility",
    "volumeChangePercentage",
    "waitForCompletion",
    "web",
    "webhook_channel_id",
    "webhook_id",
    "webhook_token",
    "wholeWord",
    "width",
    "with_counts",
]);

function isUnitOrModeName(name: string): boolean {
    return UNIT_OR_MODE_NAMES.has(name);
}

/** User-utterance echo fields — ignore at score time. */
export function isOriginalRequestEchoName(name: string): boolean {
    return ORIGINAL_REQUEST_ECHO_NAMES.has(name.trim());
}

/**
 * Freeform code/script/program payloads where many surface forms implement the
 * same intent — verify with llmAsAJudge, not exact/nonempty string equality.
 */
export function isLlmJudgePayloadName(name: string): boolean {
    const n = name.trim();
    if (!n || isOriginalRequestEchoName(n)) return false;
    return LLM_JUDGE_PAYLOAD_NAMES.has(n);
}

function isFreeTextName(name: string): boolean {
    if (isOriginalRequestEchoName(name) || isLlmJudgePayloadName(name)) {
        return false;
    }
    return FREE_TEXT_NAMES.has(name);
}

function isLooseCollectionElementName(name: string): boolean {
    return LOOSE_COLLECTION_ELEMENT_NAMES.has(name);
}

function isIdentityListName(name: string): boolean {
    return IDENTITY_LIST_NAMES.has(name);
}

function isDateName(name: string): boolean {
    return DATE_NAMES.has(name);
}

function isTimeName(name: string): boolean {
    return TIME_NAMES.has(name);
}

function isIdentifierName(name: string): boolean {
    return IDENTIFIER_NAMES.has(name);
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

