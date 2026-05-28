// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// fewshot lever — source-only. Appends `// User: …` / `// Agent: …`
// example pairs to the action's comment block (.ts) or to the action's
// description (PAS). v1 removed the prompt-overlay mode that earlier
// drafts of this plan carried — that was a runtime crutch, not a
// root-cause fix.
//
// The propose prompt asks the LLM to invent user/agent pairs that
// reinforce the action's positive identity (per SCHEMA_GUIDELINES:
// "positive parameters channel priors; anti-examples are a last
// resort"). Examples are inserted at the TOP of the existing comment
// block so they sit furthest from the identity line — broader context
// up, specific rules closer.

import registerDebug from "debug";

import type {
    AttemptRecord,
    CaseDescription,
    DiffSummary,
    GuidelineHook,
    Hypothesis,
    Mechanism,
} from "../types.js";
import type {
    ApplyContext,
    ApplyResult,
    LeverPlugin,
    ProposeContext,
} from "../registry.js";
import { extractJSON } from "../util.js";
import { appendExampleTag } from "../apply.js";
import { formatMembersBlock, isValidMemberReference } from "./promptUtils.js";

const debug = registerDebug("typeagent:collision:optimize:fewshot");

const ALLOWED_MECHANISMS: Mechanism[] = [
    "widen-identity",
    "add-important-line",
    "add-wrong-right-example",
    "add-positive-example",
    "rename-action-suggestion",
    "deprecate",
    "tighten-parameter-type",
    "other",
];

const ALLOWED_GUIDELINE_HOOKS: Exclude<GuidelineHook, null>[] = [
    "schema-shape-work-with-llm-intent",
    "critical-constraint-format",
    "identity-line-closest",
    "property-comment-ordering",
    "enum-like-properties",
];

interface FewShotExample {
    user: string;
    agent: string;
}

interface FewShotPayload {
    /** Schema of the action getting new examples. */
    targetSchema: string;
    /** Action name to attach examples to. */
    targetAction: string;
    /** "ts" → schema.ts JSDoc; "pas" → schema.pas.json comments. */
    targetSourceKind: "ts" | "pas";
    /** For .ts: the action's interface name (e.g. "PlayTrackAction"). */
    targetActionTypeName?: string;
    /** The example pairs to append. */
    examples: FewShotExample[];
}

interface FewShotLLMResponse {
    hypotheses: {
        targetSchema: string;
        targetAction: string;
        examples: FewShotExample[];
        mechanism: string;
        guidelineHook: string | null;
        rationale: string;
    }[];
}

export const fewshotLever: LeverPlugin = {
    name: "fewshot",
    description:
        "Append positive user/agent example pairs to an action's documentation. Source-only — examples persist in the schema.",
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
            `fewshot.proposeHypotheses: case=${caseDesc.neighborhoodId} k=${k}`,
        );
        const result = await model.complete(prompt);
        if (!result.success) {
            throw new Error(`fewshot lever LLM call failed: ${result.message}`);
        }
        const parsed = extractJSON<FewShotLLMResponse>(result.data);
        if (!parsed || !Array.isArray(parsed.hypotheses)) {
            throw new Error(
                `fewshot lever: failed to parse LLM response (${result.data.slice(0, 200)})`,
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
            const examples = Array.isArray(raw.examples)
                ? raw.examples
                      .filter(
                          (e): e is FewShotExample =>
                              typeof e?.user === "string" &&
                              typeof e?.agent === "string",
                      )
                      .slice(0, 6)
                : [];
            if (examples.length === 0) continue;

            const targetActionTypeName =
                targetSourceKind === "ts"
                    ? `${capitalize(raw.targetAction)}Action`
                    : undefined;
            const payload: FewShotPayload = {
                targetSchema: raw.targetSchema,
                targetAction: raw.targetAction,
                targetSourceKind,
                examples,
                ...(targetActionTypeName && { targetActionTypeName }),
            };
            hypotheses.push({
                id: `h${String(i + 1).padStart(2, "0")}-fewshot`,
                lever: "fewshot",
                depth: priorAttempts.length > 0 ? 1 : 0,
                rationale: { free: raw.rationale ?? "" },
                mechanism: coerceMechanism(raw.mechanism),
                guidelineHook: coerceGuidelineHook(raw.guidelineHook),
                diffSummary: computeDiffSummary(payload),
                payload,
            });
        }
        return hypotheses;
    },

    async applyToSandbox(
        hypothesis: Hypothesis,
        ctx: ApplyContext,
    ): Promise<ApplyResult> {
        const payload = hypothesis.payload as FewShotPayload;
        const key = `${payload.targetSchema}:schema`;
        const originalChecksum = ctx.checksums[key];
        if (!originalChecksum) {
            throw new Error(
                `fewshot lever apply: missing originalChecksum for ${payload.targetSchema} (key ${key}).`,
            );
        }
        if (payload.targetSourceKind === "ts") {
            if (!payload.targetActionTypeName) {
                throw new Error(
                    "fewshot lever apply: missing targetActionTypeName for ts schema",
                );
            }
            return appendExampleTag({
                sandboxDir: ctx.sandboxDir,
                schemaName: payload.targetSchema,
                target: payload.targetActionTypeName,
                examples: payload.examples,
                originalChecksum,
                sourceKind: "ts",
            });
        }
        return appendExampleTag({
            sandboxDir: ctx.sandboxDir,
            schemaName: payload.targetSchema,
            target: payload.targetAction,
            examples: payload.examples,
            originalChecksum,
            sourceKind: "pas",
            pasActionName: payload.targetAction,
        });
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

function coerceMechanism(raw: unknown): Mechanism {
    if (
        typeof raw === "string" &&
        (ALLOWED_MECHANISMS as string[]).includes(raw)
    ) {
        return raw as Mechanism;
    }
    return "add-positive-example";
}

function coerceGuidelineHook(raw: unknown): GuidelineHook {
    if (raw === null || raw === undefined) return null;
    if (
        typeof raw === "string" &&
        (ALLOWED_GUIDELINE_HOOKS as string[]).includes(raw)
    ) {
        return raw as GuidelineHook;
    }
    return null;
}

function computeDiffSummary(payload: FewShotPayload): DiffSummary {
    return {
        addedLines: payload.examples.length * 2,
        removedLines: 0,
        // Examples sit above the identity line — they don't replace it.
        touchesIdentityLine: false,
        // Few-shot lever produces POSITIVE examples by design. If the LLM
        // sneaks a "DO NOT" example in here it'd show up in this flag.
        addsAntiExample: payload.examples.some(
            (e) =>
                /\b(DO NOT|do not use|don't use)\b/i.test(e.user) ||
                /\b(DO NOT|do not use|don't use)\b/i.test(e.agent),
        ),
    };
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
        .slice(0, 10)
        .map(
            (p) =>
                `  - "${p.phraseText}" expected=${p.expectedSchema}.${p.expectedAction} chose=${p.chosenSchema ?? "?"}.${p.chosenAction ?? "?"}`,
        )
        .join("\n");
    const clean = caseDesc.cleanPhrases
        .slice(0, 4)
        .map((p) => `  - "${p.phraseText}"`)
        .join("\n");

    const priorBlock =
        priorAttempts.length > 0
            ? `\n\nRetry depth ${priorAttempts[0]!.hypothesis.depth + 1}. Prior examples regressed; try a different style.`
            : "";

    return `${schemaGuidelines}

You are proposing POSITIVE example user/agent pairs for a translator-collision case. ${k} hypotheses are needed.

Examples must be POSITIVE — phrases the action SHOULD absorb. Never write "DO NOT" or anti-examples (per SCHEMA_GUIDELINES). The translator reads these examples before the identity line; they should reinforce the action's scope.

CASE:
  failurePattern: ${caseDesc.failurePattern}

${memberBlock}

Misroute samples (you want these to start landing on the RIGHT action):
${misroute}

Clean phrases that already work:
${clean}${priorBlock}

Generate ${k} hypotheses. For each, pick ONE member action — typically the action that SHOULD have absorbed the misroutes — and propose 2-4 example pairs. Return JSON only:

{
  "hypotheses": [
    {
      "targetSchema": "<copy verbatim from one of the Member lines above>",
      "targetAction": "<the matching actionName from that Member line>",
      "examples": [
        { "user": "<user phrasing — short, natural>", "agent": "<concise agent reply showing the action fired>" }
      ],
      "mechanism": "add-positive-example",
      "guidelineHook": "schema-shape-work-with-llm-intent",
      "rationale": "<1 sentence reason>"
    }
  ]
}`;
}
