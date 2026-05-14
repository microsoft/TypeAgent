// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// manifest lever — rewrite the agent manifest's `schema.description`. The
// translator includes this string in its system prompt as the schema's
// top-level identity; widening it is a complementary lever to `jsdoc`
// (which targets per-action JSDoc/PAS-description) for cases where the
// schema-level boundary is the load-bearing signal.
//
// Manifest edits are format-agnostic — both .ts-source and PAS-only
// agents share the same JSON manifest. The patch artifact is
// `manifest.patch` (Phase 4 ships the apply; Phase 4+ ships .patch
// production alongside it as a follow-up).

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
import { replaceManifestDescription } from "../apply.js";

const debug = registerDebug("typeagent:collision:optimize:manifest");

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

interface ManifestPayload {
    /** Schema whose manifest description is being rewritten. */
    targetSchema: string;
    /** The new schema.description text. */
    newDescription: string;
}

interface ManifestLLMResponse {
    hypotheses: {
        targetSchema: string;
        newDescription: string;
        mechanism: string;
        guidelineHook: string | null;
        rationale: string;
    }[];
}

export const manifestLever: LeverPlugin = {
    name: "manifest",
    description:
        "Rewrite the agent manifest's schema.description. Widens the schema-level identity that the translator sees in its system prompt.",
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
            `manifest.proposeHypotheses: case=${caseDesc.neighborhoodId} k=${k}`,
        );
        const result = await model.complete(prompt);
        if (!result.success) {
            throw new Error(
                `manifest lever LLM call failed: ${result.message}`,
            );
        }
        const parsed = extractJSON<ManifestLLMResponse>(result.data);
        if (!parsed || !Array.isArray(parsed.hypotheses)) {
            throw new Error(
                `manifest lever: failed to parse LLM response (${result.data.slice(0, 200)})`,
            );
        }

        const hypotheses: Hypothesis[] = [];
        for (let i = 0; i < parsed.hypotheses.length; i++) {
            const raw = parsed.hypotheses[i]!;
            const payload: ManifestPayload = {
                targetSchema: raw.targetSchema,
                newDescription: raw.newDescription,
            };
            hypotheses.push({
                id: `h${String(i + 1).padStart(2, "0")}-manifest`,
                lever: "manifest",
                depth: priorAttempts.length > 0 ? 1 : 0,
                rationale: { free: raw.rationale ?? "" },
                mechanism: coerceMechanism(raw.mechanism),
                guidelineHook: coerceGuidelineHook(raw.guidelineHook),
                diffSummary: computeDiffSummary(caseDesc, payload),
                payload,
            });
        }
        return hypotheses;
    },

    async applyToSandbox(
        hypothesis: Hypothesis,
        ctx: ApplyContext,
    ): Promise<ApplyResult> {
        const payload = hypothesis.payload as ManifestPayload;
        const key = `${payload.targetSchema}:manifest`;
        const originalChecksum = ctx.checksums[key];
        if (!originalChecksum) {
            throw new Error(
                `manifest lever apply: missing originalChecksum for ${payload.targetSchema} (key ${key}). ` +
                    `The case loop must populate ctx.checksums for manifest files.`,
            );
        }
        return replaceManifestDescription({
            sandboxDir: ctx.sandboxDir,
            schemaName: payload.targetSchema,
            newDescription: payload.newDescription,
            originalChecksum,
        });
    },
};

// =============================================================================
// Helpers
// =============================================================================

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
    payload: ManifestPayload,
): DiffSummary {
    const old =
        caseDesc.currentManifestDescriptions[payload.targetSchema] ?? "";
    const oldLines = old.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const newLines = payload.newDescription
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
    return {
        addedLines: Math.max(0, newLines.length - oldLines.length),
        removedLines: Math.max(0, oldLines.length - newLines.length),
        // Manifest description IS the identity line at the schema level.
        touchesIdentityLine: true,
        addsAntiExample: /\b(DO NOT|do not use|don't use)\b/i.test(
            payload.newDescription,
        ),
    };
}

function buildProposePrompt(
    caseDesc: CaseDescription,
    priorAttempts: AttemptRecord[],
    k: number,
    schemaGuidelines: string,
): string {
    const memberLines = caseDesc.members
        .map((m) => `  - ${m.schemaName}.${m.actionName}`)
        .join("\n");
    const misroute = caseDesc.misroutePhrases
        .slice(0, 8)
        .map(
            (p) =>
                `  - "${p.phraseText}" expected=${p.expectedSchema}.${p.expectedAction} chose=${p.chosenSchema ?? "?"}.${p.chosenAction ?? "?"}`,
        )
        .join("\n");
    const clean = caseDesc.cleanPhrases
        .slice(0, 4)
        .map((p) => `  - "${p.phraseText}"`)
        .join("\n");
    const currentDescs = Object.entries(caseDesc.currentManifestDescriptions)
        .map(([schema, desc]) => `### ${schema} (manifest)\n${desc}`)
        .join("\n\n");

    const priorBlock =
        priorAttempts.length > 0
            ? `\n\nRetry depth ${priorAttempts[0]!.hypothesis.depth + 1}. Prior mechanisms regressed: ${priorAttempts
                  .map((a) => `${a.hypothesis.mechanism} (${a.evaluation.regressions} regressed)`)
                  .join(", ")}. Pick a different mechanism.`
            : "";

    return `${schemaGuidelines}

You are proposing fixes to AGENT MANIFEST descriptions for a translator-collision case. ${k} hypotheses are needed.

The manifest's schema.description is the schema-level identity line the translator sees. Widening it (per "WORK WITH THE LLM INTENT") is most effective when one of the schemas in the case should be absorbing intent that currently routes to a neighbor.

CASE:
  failurePattern: ${caseDesc.failurePattern} (heuristic: ${caseDesc.failurePatternHeuristic})
  severityTier: ${caseDesc.severityTier}
  members:
${memberLines}

Current manifest descriptions:
${currentDescs}

Misroute samples:
${misroute}

Clean phrases that already work (do not break these):
${clean}${priorBlock}

Generate ${k} hypotheses. For each, pick ONE schema's manifest to widen — typically the schema whose actions were EXPECTED to receive the misroutes. Return JSON only:

{
  "hypotheses": [
    {
      "targetSchema": "<schema name, e.g. player>",
      "newDescription": "<the new schema.description text — 1-3 sentences, plain text (no comment markers)>",
      "mechanism": "<one of: ${ALLOWED_MECHANISMS.join(", ")}>",
      "guidelineHook": "<one of: ${ALLOWED_GUIDELINE_HOOKS.join(", ")}, or null>",
      "rationale": "<1-2 sentence reason>"
    }
  ]
}`;
}
