// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// jsdoc lever — rewrite the comment block above an action's interface (for
// .ts-source agents) or the description field in .pas.json (for PAS-only
// agents). The first lever shipped — moved forward from Phase 4 to Phase 2
// so the explore smoke test can run real hypotheses end-to-end.
//
// The propose prompt is built around `schemaGuidelines` and the case's
// current JSDoc/description. The load-bearing instruction is "WORK WITH
// THE LLM'S INTENT, NOT AGAINST IT": widen the right action to absorb the
// misrouted intent rather than scolding the LLM away from the wrong one.

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
import { replaceJSDoc, replacePasActionDescription } from "../apply.js";

const debug = registerDebug("typeagent:collision:optimize:jsdoc");

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

interface JsdocPayload {
    /** Schema name of the action whose JSDoc is being rewritten. */
    targetSchema: string;
    /** Action name within the schema. */
    targetAction: string;
    /** Whether the target schema source is .ts (JSDoc rewrite) or .pas.json
     *  (description-field rewrite). */
    targetSourceKind: "ts" | "pas";
    /** Action type name as declared in the .ts source (e.g.
     *  "PlayTrackAction"). Only required when targetSourceKind === "ts". */
    targetActionTypeName?: string;
    /** The new comment block text (for ts) or new description text (for
     *  pas). For ts, callers should produce a full comment block with
     *  line or block comment markers already in place. */
    newText: string;
}

/**
 * LLM response shape. K hypotheses come back in one call; the lever
 * extracts and validates each.
 */
interface JsdocLLMResponse {
    hypotheses: {
        targetSchema: string;
        targetAction: string;
        newText: string;
        mechanism: string;
        guidelineHook: string | null;
        rationale: string;
    }[];
}

export const jsdocLever: LeverPlugin = {
    name: "jsdoc",
    description:
        "Rewrite the JSDoc/comment block (or PAS description) for an action involved in the case. Widen identity to absorb misrouted intent.",
    consumes: ["neighborhoods", "translation"],
    probeType: "translator",

    async proposeHypotheses(
        caseDesc: CaseDescription,
        priorAttempts: AttemptRecord[],
        ctx: ProposeContext,
    ): Promise<Hypothesis[]> {
        const k = 3; // K=3 default per plan; corpusLoop overrides if needed.
        const model = ctx.createModel("propose");
        const prompt = buildProposePrompt(
            caseDesc,
            priorAttempts,
            k,
            ctx.schemaGuidelines,
        );

        debug(
            `jsdoc.proposeHypotheses: case=${caseDesc.neighborhoodId} k=${k} depth=${
                priorAttempts.length > 0 ? "N>0" : "0"
            }`,
        );
        const result = await model.complete(prompt);
        if (!result.success) {
            throw new Error(
                `jsdoc lever LLM call failed: ${result.message}`,
            );
        }
        const parsed = extractJSON<JsdocLLMResponse>(result.data);
        if (!parsed || !Array.isArray(parsed.hypotheses)) {
            throw new Error(
                `jsdoc lever: failed to parse LLM response (${result.data.slice(0, 200)}…)`,
            );
        }

        const hypotheses: Hypothesis[] = [];
        for (let i = 0; i < parsed.hypotheses.length; i++) {
            const raw = parsed.hypotheses[i]!;
            const targetSourceKind = sourceKindFor(caseDesc, raw.targetSchema);
            const targetActionTypeName =
                targetSourceKind === "ts"
                    ? `${capitalize(raw.targetAction)}Action`
                    : undefined;

            const payload: JsdocPayload = {
                targetSchema: raw.targetSchema,
                targetAction: raw.targetAction,
                targetSourceKind,
                newText: raw.newText,
                ...(targetActionTypeName && { targetActionTypeName }),
            };

            const mechanism = coerceMechanism(raw.mechanism);
            const guidelineHook = coerceGuidelineHook(raw.guidelineHook);
            const diffSummary = computeDiffSummary(caseDesc, payload);

            hypotheses.push({
                id: `h${String(i + 1).padStart(2, "0")}-jsdoc`,
                lever: "jsdoc",
                depth: priorAttempts.length > 0 ? 1 : 0,
                rationale: { free: raw.rationale ?? "" },
                mechanism,
                guidelineHook,
                diffSummary,
                payload,
            });
        }
        return hypotheses;
    },

    async applyToSandbox(
        hypothesis: Hypothesis,
        ctx: ApplyContext,
    ): Promise<ApplyResult> {
        const payload = hypothesis.payload as JsdocPayload;
        const checksumKey = `${payload.targetSchema}:schema`;

        if (payload.targetSourceKind === "ts") {
            if (!payload.targetActionTypeName) {
                throw new Error(
                    `jsdoc lever apply: missing targetActionTypeName for ts schema`,
                );
            }
            const originalChecksum = findChecksumOrThrow(
                ctx,
                checksumKey,
                payload.targetSchema,
            );
            return replaceJSDoc({
                sandboxDir: ctx.sandboxDir,
                schemaName: payload.targetSchema,
                actionTypeName: payload.targetActionTypeName,
                newCommentBlock: payload.newText,
                originalChecksum,
            });
        }
        const originalChecksum = findChecksumOrThrow(
            ctx,
            checksumKey,
            payload.targetSchema,
        );
        return replacePasActionDescription({
            sandboxDir: ctx.sandboxDir,
            schemaName: payload.targetSchema,
            actionName: payload.targetAction,
            newDescription: payload.newText,
            originalChecksum,
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
    // currentJSDoc is populated for .ts-source agents; currentPasDescriptions
    // for PAS-only. Use that signal to pick the apply path.
    const hasJSDoc = Object.keys(caseDesc.currentJSDoc).some((k) =>
        k.startsWith(`${schemaName}.`),
    );
    if (hasJSDoc) return "ts";
    const hasPas = Object.keys(caseDesc.currentPasDescriptions).some((k) =>
        k.startsWith(`${schemaName}.`),
    );
    if (hasPas) return "pas";
    // Default to .ts; the apply step will surface a clearer error if the
    // sandbox layout disagrees.
    return "ts";
}

function coerceMechanism(raw: unknown): Mechanism {
    if (
        typeof raw === "string" &&
        (ALLOWED_MECHANISMS as string[]).includes(raw)
    ) {
        return raw as Mechanism;
    }
    return "other";
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

function computeDiffSummary(
    caseDesc: CaseDescription,
    payload: JsdocPayload,
): DiffSummary {
    const oldKey = `${payload.targetSchema}.${payload.targetAction}`;
    const old =
        payload.targetSourceKind === "ts"
            ? (caseDesc.currentJSDoc[oldKey] ?? "")
            : (caseDesc.currentPasDescriptions[oldKey] ?? "");
    const oldLines = old.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const newLines = payload.newText
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
    return {
        addedLines: Math.max(0, newLines.length - oldLines.length),
        removedLines: Math.max(0, oldLines.length - newLines.length),
        // Identity line is the LAST non-blank line of the comment block per
        // schemaGuidelines convention.
        touchesIdentityLine:
            oldLines[oldLines.length - 1] !==
            newLines[newLines.length - 1],
        addsAntiExample: /\b(DO NOT|don't use|do not use)\b/i.test(
            payload.newText,
        ),
    };
}

function findChecksumOrThrow(
    ctx: ApplyContext,
    key: string,
    schemaName: string,
): string {
    const checksum = ctx.checksums[key];
    if (!checksum) {
        throw new Error(
            `jsdoc lever apply: missing originalChecksum for ${schemaName} (key ${key}). ` +
                `The case loop must populate ctx.checksums from CaseDescription.originalChecksum before calling applyToSandbox.`,
        );
    }
    return checksum;
}

function capitalize(s: string): string {
    return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

// =============================================================================
// Prompt builder
// =============================================================================

function buildProposePrompt(
    caseDesc: CaseDescription,
    priorAttempts: AttemptRecord[],
    k: number,
    schemaGuidelines: string,
): string {
    const memberLines = caseDesc.members
        .map((m) => `  - ${m.schemaName}.${m.actionName}`)
        .join("\n");
    const misrouteSamples = caseDesc.misroutePhrases
        .slice(0, 8)
        .map(
            (p) =>
                `  - "${p.phraseText}" expected=${p.expectedSchema}.${p.expectedAction} chose=${p.chosenSchema ?? "?"}.${p.chosenAction ?? "?"}`,
        )
        .join("\n");
    const cleanSamples = caseDesc.cleanPhrases
        .slice(0, 4)
        .map(
            (p) =>
                `  - "${p.phraseText}" expected=${p.expectedSchema}.${p.expectedAction}`,
        )
        .join("\n");
    const currentDocs = Object.entries(caseDesc.currentJSDoc)
        .concat(Object.entries(caseDesc.currentPasDescriptions))
        .map(([key, text]) => `### ${key}\n${text}`)
        .join("\n\n");

    const priorBlock =
        priorAttempts.length > 0
            ? `\n\nDepth ${priorAttempts[0]!.hypothesis.depth + 1} retry. Mechanisms that already regressed: ${priorAttempts
                  .map((a) => `'${a.hypothesis.mechanism}' (regressed ${a.evaluation.regressions} phrases)`)
                  .join(", ")}. Try a DIFFERENT mechanism this time.`
            : "";

    return `${schemaGuidelines}

You are proposing fixes for a translator-collision case. ${k} hypotheses are needed.

CASE:
  failurePattern: ${caseDesc.failurePattern}  (heuristic: ${caseDesc.failurePatternHeuristic})
  severityTier: ${caseDesc.severityTier}
  members:
${memberLines}

Current action documentation (JSDoc or PAS description):
${currentDocs}

Misroute samples (expected vs. chose):
${misrouteSamples}

Clean phrases that already work (do not break these):
${cleanSamples}${priorBlock}

Generate ${k} hypotheses. For each, pick ONE member action to rewrite (typically the action the misroutes were EXPECTED to hit -- widen it to absorb the intent, per the WORK WITH THE LLM INTENT guideline above). Return JSON only:

{
  "hypotheses": [
    {
      "targetSchema": "<schema name, e.g. player>",
      "targetAction": "<action name, e.g. playTrack>",
      "newText": "<the new comment block — for .ts, use // line comments; for PAS, plain text. Must include a one-sentence identity line as the LAST line.>",
      "mechanism": "<one of: ${ALLOWED_MECHANISMS.join(", ")}>",
      "guidelineHook": "<one of: ${ALLOWED_GUIDELINE_HOOKS.join(", ")}, or null>",
      "rationale": "<1-2 sentence reason — why this rewrite addresses the misroutes>"
    }
  ]
}`;
}
