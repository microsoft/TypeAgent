// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Markdown renderer for the distiller's output. Produces
// `schemaGuidelines.candidates.md` — the human-reviewable artifact the
// operator promotes from. v1 layout mirrors the example in the planning
// doc.

import type {
    GuidelineCandidate,
    GuidelineCandidatesReport,
} from "./guidelineDistiller.js";

export function buildCandidatesMarkdown(
    report: GuidelineCandidatesReport,
): string {
    if (report.status === "not-enough-data") {
        return [
            `# schemaGuidelines candidates`,
            ``,
            `**Status:** not-enough-data`,
            ``,
            report.statusReason ?? "(no reason recorded)",
            ``,
            `Generated at ${report.builtAt} from ${report.inputs.patternsFile}.`,
            `Run more \`@collision optimize explore\` cycles and re-run \`distill\`.`,
            ``,
        ].join("\n");
    }

    const lines: string[] = [];
    lines.push(`# Candidate additions to schemaGuidelines`);
    lines.push(``);
    lines.push(
        `Generated at ${report.builtAt} from ${report.totalWinners} winner(s) across ${report.totalAttempts} attempt(s). Distilled ${report.candidates.length} candidate(s).`,
    );
    lines.push(``);
    lines.push(
        `Review each candidate below and promote selected entries into the canonical \`schemaGuidelines\` constant by hand. The next \`@collision optimize explore\` run will pick up the new guideline text automatically — every lever's propose prompt and the case analyzer's LLM-refinement step import the same constant.`,
    );
    lines.push(``);

    for (let i = 0; i < report.candidates.length; i++) {
        const candidate = report.candidates[i]!;
        lines.push(formatCandidate(i + 1, candidate));
        lines.push(``);
    }

    return lines.join("\n");
}

function formatCandidate(
    idx: number,
    candidate: GuidelineCandidate,
): string {
    const block: string[] = [];
    block.push(`## Candidate ${idx} — ${candidate.title}`);
    block.push(``);
    block.push(
        `**Evidence**: ${candidate.evidence.winnerCount} winner(s) across ${candidate.evidence.distinctNeighborhoods} distinct neighborhood(s).`,
    );
    block.push(
        `**Mechanism**: \`${candidate.mechanism}\`. **Guideline hook**: \`${candidate.guidelineHook ?? "(none)"}\`. **Extends section**: \`${candidate.extendsSection}\`.`,
    );
    block.push(``);
    block.push(`**Proposed text:**`);
    block.push(``);
    // Quote the proposed text so it stands out from the metadata. Lines
    // inside the proposed text are preserved as-is (the LLM may include
    // its own example code blocks).
    for (const line of candidate.proposedText.split("\n")) {
        block.push(`> ${line}`);
    }
    block.push(``);
    if (candidate.evidence.samplePaths.length > 0) {
        block.push(`**Sample winning attempts:**`);
        for (const p of candidate.evidence.samplePaths) {
            block.push(`- \`${p}\``);
        }
    }
    return block.join("\n");
}
