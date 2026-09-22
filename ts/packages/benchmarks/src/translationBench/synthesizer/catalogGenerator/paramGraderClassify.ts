// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

import { parseLlmJsonWithZod } from "../llmJson.js";
import {
    loadTranslationBenchParameterGraderPromptPack,
    renderTranslationBenchPromptTemplate,
    type TranslationBenchParameterGraderPromptPack,
} from "../synthesizerPrompts.js";
import { paramSpecKind, type ParamSpec } from "./paramTypes.js";
import type { TranslationBenchPolicyVerifyMode } from "../../policy/loadPolicy.js";
import {
    isDateName,
    isFreeTextName,
    isIdentifierName,
    isIdentityListName,
    isLlmJudgePayloadName,
    isLooseCollectionElementName,
    isOriginalRequestEchoName,
    isTimeName,
    isUnitOrModeName,
} from "./paramGraderNameHeuristics.js";
import {
    CREATE_SET,
    HARDCODE_RULE_SET,
    LEGACY_RULE_RE,
    nestedParamSpecEqual,
    parameterGraderLlmDecisionSchema,
    parameterGraderLlmVerifierSchema,
    type ActionParameterFieldGrader,
    type ActionParamVerifyMode,
    type FieldGraderDecision,
    type ParameterGraderLlm,
    type ParameterGraderLlmDecision,
} from "./paramGraderTypes.js";
function wrapArrayDecision(item: FieldGraderDecision): FieldGraderDecision {
    const looseVerify = loosenArrayVerifyMode(item);
    return {
        // Top-level create mirrors the element (creator mints element values).
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

function classifyObjectFieldHardcode(
    spec: Extract<ParamSpec, { kind: "object" }>,
): FieldGraderDecision {
    // Soft-leaf-only objects use nonempty; mixed leaves stay exact.
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

function classifyStringFieldHardcode(
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
    // Identity token lists (not *Name) stay identifier/exact before free-text.
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
    // Free-text before generic *Name identifier so trackName/location stay soft.
    if (isFreeTextName(name)) {
        return {
            create: "free_text",
            verify: "nonempty",
            rule: "string-free-text-nonempty",
            source: "hardcode",
        };
    }
    if (isDateName(name)) {
        // NL relative dates dominate synthesis ("next Tuesday", "this week").
        // Exact string match is unfair at eval; align with time -> nonempty.
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
    // Unmatched open strings fall through to the LLM fallback.
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
            // Classify element; container mode depends on element strictness.
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
            return classifyObjectFieldHardcode(spec);

        case "union":
            // Union: all-any -> opaque/ignore; else record/exact.
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
            return classifyStringFieldHardcode(name, spec, optional);
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

export function tryReusePriorFieldGraderDecision(
    prior: ActionParameterFieldGrader | undefined,
    spec: ParamSpec,
    optional?: boolean,
): FieldGraderDecision | undefined {
    if (prior === undefined) return undefined;
    // Hardcode priors must re-resolve after rules bumps / heuristic edits.
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
        // Nested item from an LLM prior must also be llm-sourced.
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
        // Arrays: classify the element first (hardcode -> reuse -> LLM), then wrap.
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
        // If item path already produced an array wrapper (shouldn't), unwrap.
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

export function defaultCreateForOverride(
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

    const hardcode = tryClassifyActionParameterFieldHardcode(
        fieldName,
        spec,
        optional,
    );
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
    // exact element policy: only loosen free_text-style soft content
    if (create === "free_text" || create === "temporal") {
        return "nonempty";
    }
    // number[] / boolean[] / enum[] / identifier[] / object[] -> exact container
    return "exact";
}
