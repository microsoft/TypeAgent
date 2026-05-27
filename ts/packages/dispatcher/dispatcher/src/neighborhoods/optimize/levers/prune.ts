// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// prune lever — deprecate a member action. For .ts schemas, adds an
// `// @deprecated <reason>` line at the top of the action's JSDoc block.
// For PAS schemas, prepends `[DEPRECATED] ` to the action's description
// (idempotent). In both cases, ALSO writes a sandbox-only
// `overrides/<schemaName>.actionConfig.json` that drops the action from
// `getActionConfigs()` / `getActionSchemaFileForConfig()` reporting —
// when the sandbox provider is loaded with the override layer, the
// translator never sees the deprecated action in its prompt.
//
// The durable artifact (what the operator git-applies) is the
// schema-source edit only; the override file is sandbox-only. The
// operator's manual follow-up is to either remove the action from the
// schema (a separate refactor) or accept the deprecation in place.

import registerDebug from "debug";

import type {
    AttemptRecord,
    CaseDescription,
    GuidelineHook,
    Hypothesis,
} from "../types.js";
import type {
    ApplyContext,
    ApplyResult,
    LeverPlugin,
    ProposeContext,
} from "../registry.js";
import { extractJSON } from "../util.js";
import { markDeprecated, writeActionConfigOverride } from "../apply.js";
import { formatMembersBlock, isValidMemberReference } from "./promptUtils.js";

const debug = registerDebug("typeagent:collision:optimize:prune");

interface PrunePayload {
    /** Schema containing the action to deprecate. */
    targetSchema: string;
    /** Action name (camelCase). */
    targetAction: string;
    /** "ts" → schema.ts JSDoc edit; "pas" → schema.pas.json comments edit. */
    targetSourceKind: "ts" | "pas";
    /** For .ts: the interface name (e.g. "PlayTrackAction"). */
    targetActionTypeName?: string;
    /** Reason for deprecation — surfaced to the LLM via `@deprecated
     *  <reason>` so the model knows WHY the action is gone. */
    reason: string;
}

interface PruneLLMResponse {
    hypotheses: {
        targetSchema: string;
        targetAction: string;
        reason: string;
        mechanism?: string;
        guidelineHook?: string | null;
        rationale: string;
    }[];
}

const GUIDELINE_HOOKS: Exclude<GuidelineHook, null>[] = [
    "schema-shape-work-with-llm-intent",
    "critical-constraint-format",
    "identity-line-closest",
    "property-comment-ordering",
    "enum-like-properties",
];

export const pruneLever: LeverPlugin = {
    name: "prune",
    description:
        "Deprecate a redundant member action: add `@deprecated` (ts) or `[DEPRECATED]` (PAS) plus a sandbox override that hides the action from getActionConfigs().",
    consumes: ["neighborhoods", "translation"],
    probeType: "translator",

    async proposeHypotheses(
        caseDesc: CaseDescription,
        priorAttempts: AttemptRecord[],
        ctx: ProposeContext,
    ): Promise<Hypothesis[]> {
        const k = 3;
        const model = ctx.createModel("propose");
        const prompt = buildProposePrompt(
            caseDesc,
            priorAttempts,
            k,
            ctx.schemaGuidelines,
        );

        debug(
            `prune.proposeHypotheses: case=${caseDesc.neighborhoodId} k=${k}`,
        );
        const result = await model.complete(prompt);
        if (!result.success) {
            throw new Error(`prune lever LLM call failed: ${result.message}`);
        }
        const parsed = extractJSON<PruneLLMResponse>(result.data);
        if (!parsed || !Array.isArray(parsed.hypotheses)) {
            throw new Error(
                `prune lever: failed to parse LLM response (${result.data.slice(0, 200)})`,
            );
        }

        const hypotheses: Hypothesis[] = [];
        for (let i = 0; i < parsed.hypotheses.length; i++) {
            const raw = parsed.hypotheses[i]!;
            if (
                !isValidMemberReference(
                    caseDesc.members,
                    raw.targetSchema,
                    raw.targetAction,
                )
            ) {
                continue;
            }
            const targetSourceKind = sourceKindFor(caseDesc, raw.targetSchema);
            const targetActionTypeName =
                targetSourceKind === "ts"
                    ? `${capitalize(raw.targetAction)}Action`
                    : undefined;
            const payload: PrunePayload = {
                targetSchema: raw.targetSchema,
                targetAction: raw.targetAction,
                targetSourceKind,
                reason: raw.reason,
                ...(targetActionTypeName && { targetActionTypeName }),
            };
            hypotheses.push({
                id: `h${String(i + 1).padStart(2, "0")}-prune`,
                lever: "prune",
                depth: priorAttempts.length > 0 ? 1 : 0,
                rationale: { free: raw.rationale ?? "" },
                mechanism: "deprecate",
                guidelineHook: coerceGuidelineHook(raw.guidelineHook),
                diffSummary: {
                    addedLines: 1,
                    removedLines: 0,
                    touchesIdentityLine: false,
                    addsAntiExample: false,
                },
                payload,
            });
        }
        return hypotheses;
    },

    async applyToSandbox(
        hypothesis: Hypothesis,
        ctx: ApplyContext,
    ): Promise<ApplyResult> {
        const payload = hypothesis.payload as PrunePayload;
        const key = `${payload.targetSchema}:schema`;
        const originalChecksum = ctx.checksums[key];
        if (!originalChecksum) {
            throw new Error(
                `prune lever apply: missing originalChecksum for ${payload.targetSchema} (key ${key}).`,
            );
        }
        // 1) Mark the action deprecated in the source.
        let writtenFiles: string[] = [];
        if (payload.targetSourceKind === "ts") {
            if (!payload.targetActionTypeName) {
                throw new Error(
                    "prune lever apply: missing targetActionTypeName for ts schema",
                );
            }
            const r = markDeprecated({
                sandboxDir: ctx.sandboxDir,
                schemaName: payload.targetSchema,
                sourceKind: "ts",
                target: payload.targetActionTypeName,
                reason: payload.reason,
                originalChecksum,
            });
            writtenFiles = [...writtenFiles, ...r.filesWritten];
        } else {
            const r = markDeprecated({
                sandboxDir: ctx.sandboxDir,
                schemaName: payload.targetSchema,
                sourceKind: "pas",
                target: payload.targetAction,
                pasActionName: payload.targetAction,
                reason: payload.reason,
                originalChecksum,
            });
            writtenFiles = [...writtenFiles, ...r.filesWritten];
        }
        // 2) Sandbox-only override that drops the action from the
        //    translator's view. The durable artifact for the operator is
        //    the source edit above; the override is sandbox-only.
        const override = writeActionConfigOverride({
            sandboxDir: ctx.sandboxDir,
            schemaName: payload.targetSchema,
            droppedActions: [payload.targetAction],
        });
        writtenFiles = [...writtenFiles, ...override.filesWritten];

        return { filesWritten: writtenFiles };
    },
};

// =============================================================================
// Helpers
// =============================================================================

function sourceKindFor(
    caseDesc: CaseDescription,
    schemaName: string,
): "ts" | "pas" {
    const hasJSDoc = Object.keys(caseDesc.currentJSDoc).some((k) =>
        k.startsWith(`${schemaName}.`),
    );
    if (hasJSDoc) return "ts";
    const hasPas = Object.keys(caseDesc.currentPasDescriptions).some((k) =>
        k.startsWith(`${schemaName}.`),
    );
    if (hasPas) return "pas";
    return "ts";
}

function coerceGuidelineHook(raw: unknown): GuidelineHook {
    if (raw === null || raw === undefined) return null;
    if (
        typeof raw === "string" &&
        (GUIDELINE_HOOKS as string[]).includes(raw)
    ) {
        return raw as GuidelineHook;
    }
    return null;
}

function capitalize(s: string): string {
    return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function buildProposePrompt(
    caseDesc: CaseDescription,
    priorAttempts: AttemptRecord[],
    k: number,
    schemaGuidelines: string,
): string {
    const memberBlock = formatMembersBlock(caseDesc.members);
    const misroute = caseDesc.misroutePhrases
        .slice(0, 8)
        .map(
            (p) =>
                `  - "${p.phraseText}" expected=${p.expectedSchema}.${p.expectedAction} chose=${p.chosenSchema ?? "?"}.${p.chosenAction ?? "?"}`,
        )
        .join("\n");

    const priorBlock =
        priorAttempts.length > 0
            ? `\n\nRetry depth ${priorAttempts[0]!.hypothesis.depth + 1}. Prior prune targets did not improve scoring — pick a different member action this time.`
            : "";

    return `${schemaGuidelines}

You are proposing DEPRECATION targets for a translator-collision case. ${k} hypotheses are needed.

Deprecation is a LAST RESORT mechanism, used only when one of the case's member actions is genuinely redundant — its scope is fully absorbed by a sibling. If widening another member could absorb the intent (per "WORK WITH THE LLM INTENT"), that's a jsdoc/manifest lever job, not this one. Only propose deprecation when removal is the right call.

CASE:
  failurePattern: ${caseDesc.failurePattern}

${memberBlock}

Misroute samples:
${misroute}${priorBlock}

Generate ${k} hypotheses. Each picks ONE member action to deprecate, with a short reason the translator can read. Return JSON only:

{
  "hypotheses": [
    {
      "targetSchema": "<copy verbatim from one of the Member lines above>",
      "targetAction": "<the matching actionName from that Member line>",
      "reason": "<short reason — e.g. 'absorbed by playTrack'>",
      "guidelineHook": null,
      "rationale": "<1-2 sentence reason why this action is the right one to prune>"
    }
  ]
}`;
}
