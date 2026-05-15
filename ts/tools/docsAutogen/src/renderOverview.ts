// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CompactDecision } from "./compactMode.js";
import type { PackageInputs } from "./packageInputs.js";

/**
 * Render the `## Overview` section of an AUTOGEN block.
 *
 * Phase 2 has no LLM integration: this either preserves any
 * existing Overview verbatim (so we don't churn user-edited prose
 * before the LLM is wired up), or emits a clearly marked placeholder
 * built from the package description.
 *
 * When the LLM is wired up in Phase 3, this function is replaced /
 * augmented but its output contract stays the same: a `## Overview`
 * section terminated by a single trailing newline.
 */
export function renderOverviewSection(
    inputs: PackageInputs,
    decision: CompactDecision,
    llmBody?: string,
): string {
    if (llmBody !== undefined && llmBody.trim().length > 0) {
        const lines: string[] = [];
        lines.push("## Overview");
        lines.push("");
        lines.push(llmBody.trim());
        lines.push("");
        return lines.join("\n");
    }

    const preserved = extractExistingOverview(inputs.existingBlock);
    if (preserved !== null) {
        return ensureTrailingNewline(preserved);
    }

    const lines: string[] = [];
    lines.push("## Overview");
    lines.push("");
    if (inputs.description.length > 0) {
        lines.push(inputs.description);
    } else {
        lines.push(
            `\`${inputs.pkg.name}\` is a workspace package in the TypeAgent monorepo.`,
        );
    }
    lines.push("");
    lines.push(
        "> _Pending LLM-authored Overview. The Reference section below is generated deterministically and may already be useful._",
    );
    lines.push("");
    if (!decision.compact) {
        appendWhereToStartPlaceholder(lines, inputs);
    }
    return lines.join("\n").trimEnd() + "\n";
}

/**
 * Pull the existing `## Overview` section (and any sub-headings up to
 * the next `##`) out of a previously-generated AUTOGEN body, so the
 * renderer can preserve human edits across runs while the LLM is not
 * yet wired in.
 */
function extractExistingOverview(body: string | null): string | null {
    if (body === null) return null;
    const lines = body.split(/\r?\n/u);
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^##\s+Overview\s*$/u.test(lines[i]!)) {
            start = i;
            break;
        }
    }
    if (start === -1) return null;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^##\s+\S/u.test(lines[i]!)) {
            end = i;
            break;
        }
    }
    return lines.slice(start, end).join("\n");
}

function appendWhereToStartPlaceholder(
    out: string[],
    inputs: PackageInputs,
): void {
    out.push("### Where to start");
    out.push("");
    const eps = inputs.entryPoints.filter((ep) => ep.exists).slice(0, 3);
    if (eps.length === 0) {
        out.push(
            "_The LLM-authored Overview will populate this section. Until then, see the Reference section below for files of interest._",
        );
    } else {
        out.push(
            "_Until the LLM-authored Overview is populated, the most likely entry points are:_",
        );
        out.push("");
        for (const ep of eps) {
            out.push(`- [${ep.resolved}](${ep.resolved})`);
        }
    }
    out.push("");
}

function ensureTrailingNewline(s: string): string {
    return s.endsWith("\n") ? s : s + "\n";
}
